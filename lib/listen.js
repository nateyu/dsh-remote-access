/**
 * Reverse-proxy listenPort onto local dsh web.
 * HTTP and WebSocket are forwarded; Host/Origin/Referer become 127.0.0.1:<dshPort>
 * so the harness treats the request as loopback.
 */

import { createServer, request as httpRequest } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { accessClass, clientIp, isHttps } from './origin.js'
import { isAuthenticated, requestKind, setSessionCookie, signCookie } from './session.js'
import { createRateLimiter } from './rate-limit.js'
import { deniedPageHtml, loginPageHtml } from './login-page.js'
import {
  attachLaunchToken,
  hasBrowserSessionCookie,
  hasLaunchTokenQuery,
  isHtmlDocument,
  rewriteHtmlDocument,
  rewriteLoopbackLocation,
  rewriteUpgradeHeaders,
  rewriteUpstreamHeaders,
  sanitizeDownstreamHeaders,
} from './page-patch.js'

const LOGIN_PATH = '/_remote/login'
const ACCESS_CLASS = Symbol('dsh-access-class')

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function samePin(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8')
  const right = Buffer.from(String(b ?? ''), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
function pathnameOf(req) {
  try {
    return new URL(req.url ?? '/', 'http://gateway.invalid').pathname
  } catch {
    return String(req.url ?? '/').split('?')[0]
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
function wantsHtml(req) {
  const path = pathnameOf(req)
  if (path.startsWith('/plugins/') || path.startsWith('/api')) return false
  if (/\.(js|mjs|css|map|json|woff2?|png|svg|ico|webp)$/i.test(path)) return false
  const accept = String(req.headers.accept ?? '')
  if (accept.includes('text/html')) return true
  return path === '/' || /\.html?$/i.test(path)
}

/**
 * Client bundles are not a capability; PIN-gated 401 JSON makes <script src> fail
 * with "bundle script failed to load". SSE and /api still require the cookie.
 *
 * @param {import('node:http').IncomingMessage} req
 */
function isAnonymousPluginBundle(req) {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') return false
  const path = pathnameOf(req)
  if (path === '/plugins/events' || path.startsWith('/plugins/events/')) return false
  return path.startsWith('/plugins/')
}

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 */
function isCompressed(headers) {
  return /(gzip|br|deflate)/i.test(String(headers['content-encoding'] ?? ''))
}

/**
 * @param {{
 *   listenHost: string
 *   listenPort: number
 *   dshPort: number
 *   getState: () => { cookieSecret: string, lanPin: string, publicPin: string, lanPinRequired: boolean, lanEnabled: boolean }
 *   publicOpen: () => boolean
 *   sshEntry?: () => import('./origin.js').SshEntry
 *   launchToken?: () => string
 * }} options
 */
export function createProxyServer(options) {
  const limiter = createRateLimiter()
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set()

  /**
   * @param {import('node:net').Socket | undefined} socket
   * @param {'loopback' | 'private' | 'public'} klass
   */
  function tagSocket(socket, klass) {
    if (!socket) return
    socket[ACCESS_CLASS] = klass
  }

  function ssh() {
    const extra = options.sshEntry?.() ?? {}
    return { open: false, host: '', port: 0, listenPort: options.listenPort, ...extra }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   */
  function pinFor(req) {
    const state = options.getState()
    return requestKind(req, ssh()) === 'public' ? state.publicPin : state.lanPin
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function gate(req, res) {
    const entry = ssh()
    const klass = accessClass(req, entry)
    tagSocket(req.socket, klass)
    const state = options.getState()
    if (klass === 'private' && !state.lanEnabled) {
      const message = 'LAN access is off. Turn it on in Settings → Remote access.'
      if (wantsHtml(req)) {
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(deniedPageHtml(message))
      } else {
        res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'lan-disabled' }))
      }
      return false
    }
    if (klass === 'public' && !options.publicOpen()) {
      const message = 'Public access is off. Start Cloudflare Tunnel or the SSH forward first.'
      if (wantsHtml(req)) {
        res.writeHead(403, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(deniedPageHtml(message))
      } else {
        res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'public-disabled' }))
      }
      return false
    }
    const needsPin = klass === 'public' || (klass !== 'loopback' && state.lanPinRequired)
    if (!needsPin) return true
    if (pathnameOf(req) === LOGIN_PATH && req.method === 'POST') {
      handleLogin(req, res)
      return false
    }
    if (isAuthenticated(req, state, entry)) return true
    if (isAnonymousPluginBundle(req)) return true
    if (wantsHtml(req)) {
      const ip = clientIp(req)
      const rl = limiter.status(ip)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(loginPageHtml({
        kind: klass === 'public' ? 'public' : 'lan',
        locked: rl.locked,
        retryAfter: rl.retryAfter,
      }))
    } else {
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
    }
    return false
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function handleLogin(req, res) {
    const ip = clientIp(req)
    const rl = limiter.status(ip)
    const kind = requestKind(req, ssh())
    if (rl.locked) {
      res.writeHead(429, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(rl.retryAfter),
      })
      res.end(loginPageHtml({ kind, locked: true, retryAfter: rl.retryAfter }))
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 2048) req.destroy()
    })
    req.on('end', () => {
      const submitted = String(new URLSearchParams(body).get('pin') ?? '').trim()
      const expected = pinFor(req)
      if (samePin(submitted, expected)) {
        limiter.clear(ip)
        const cookie = signCookie(options.getState().cookieSecret, kind, expected)
        setSessionCookie(res, cookie, kind === 'public' && isHttps(req))
        res.writeHead(302, { location: '/', 'cache-control': 'no-store' })
        res.end()
        return
      }
      const next = limiter.fail(ip)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(loginPageHtml({
        kind,
        failed: !next.locked,
        locked: next.locked,
        retryAfter: next.retryAfter,
      }))
    })
  }

  function launchToken() {
    try {
      const token = options.launchToken?.()
      return typeof token === 'string' && token.length > 0 ? token : ''
    } catch {
      // authenticatedUrl can throw on a malformed Connection URL; skip the
      // exchange rather than fail the whole hop. Upstream then returns 401.
      return ''
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   */
  function canExchangeLaunchToken(req) {
    return req.method === 'GET' && pathnameOf(req) === '/' && !hasLaunchTokenQuery(req.url)
  }

  /**
   * @param {import('node:http').IncomingHttpHeaders} headers
   * @param {{ dropContentLength?: boolean }} [extra]
   */
  function downstreamHeaders(headers, extra) {
    return rewriteLoopbackLocation(sanitizeDownstreamHeaders(headers, extra), options.dshPort)
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} path
   * @param {{ retryWithToken?: string }} [retry]
   */
  function sendUpstream(req, res, path, retry = {}) {
    const document = pathnameOf(req) === '/' || pathnameOf(req) === '/index.html'
    const headers = rewriteUpstreamHeaders(req.headers, options.dshPort, {
      passthroughEncoding: !document,
    })
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: options.dshPort,
      path,
      method: req.method,
      headers,
      agent: false,
    }, (incoming) => {
      if (incoming.statusCode === 401 && retry.retryWithToken) {
        incoming.resume()
        incoming.on('end', () => {
          if (res.headersSent) return
          sendUpstream(req, res, attachLaunchToken(req.url, retry.retryWithToken))
        })
        return
      }
      const html = isHtmlDocument(pathnameOf(req), req.headers)
        && String(incoming.headers['content-type'] ?? '').includes('text/html')
        && !isCompressed(incoming.headers)
      if (!html) {
        res.writeHead(incoming.statusCode ?? 502, downstreamHeaders(incoming.headers))
        incoming.pipe(res)
        return
      }
      /** @type {Buffer[]} */
      const chunks = []
      incoming.on('data', (chunk) => chunks.push(chunk))
      incoming.on('end', () => {
        const body = rewriteHtmlDocument(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(incoming.statusCode ?? 200, downstreamHeaders(incoming.headers, { dropContentLength: true }))
        res.end(body)
      })
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end('upstream unavailable')
    })
    if (req.method === 'GET' || req.method === 'HEAD') upstream.end()
    else req.pipe(upstream)
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function proxyHttp(req, res) {
    const token = canExchangeLaunchToken(req) ? launchToken() : ''
    const attachNow = Boolean(token) && !hasBrowserSessionCookie(req.headers)
    sendUpstream(
      req,
      res,
      attachNow ? attachLaunchToken(req.url, token) : (req.url ?? '/'),
      attachNow || !token ? {} : { retryWithToken: token },
    )
  }

  const server = createServer((req, res) => {
    if (!gate(req, res)) return
    proxyHttp(req, res)
  })
  server.on('connection', (socket) => {
    socket.setNoDelay(true)
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  server.on('upgrade', (req, socket, head) => {
    const entry = ssh()
    const klass = accessClass(req, entry)
    tagSocket(socket, klass)
    const state = options.getState()
    if (klass === 'private' && !state.lanEnabled) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (klass === 'public' && !options.publicOpen()) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const needsPin = klass === 'public' || (klass !== 'loopback' && state.lanPinRequired)
    if (needsPin && !isAuthenticated(req, state, entry)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const headers = rewriteUpgradeHeaders(req.headers, options.dshPort)
    const upstream = httpRequest({
      hostname: '127.0.0.1',
      port: options.dshPort,
      path: req.url,
      method: 'GET',
      headers,
      agent: false,
    })
    socket.setNoDelay(true)
    upstream.on('upgrade', (upRes, upSocket, upHead) => {
      upSocket.setNoDelay?.(true)
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`]
      for (const [key, value] of Object.entries(upRes.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) lines.push(`${key}: ${item}`)
        } else if (value !== undefined) {
          lines.push(`${key}: ${value}`)
        }
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upHead.length) socket.write(upHead)
      if (head.length) upSocket.write(head)
      socket.pipe(upSocket)
      upSocket.pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  })

  return {
    server,
    /**
     * @returns {Promise<void>}
     */
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.listenPort, options.listenHost, () => {
          server.off('error', reject)
          resolve()
        })
      })
    },
    /**
     * Drop keep-alive / WebSocket sockets last classified as `klass`.
     * @param {'loopback' | 'private' | 'public'} klass
     */
    dropClass(klass) {
      for (const socket of [...sockets]) {
        if (socket[ACCESS_CLASS] === klass) socket.destroy()
      }
    },
    /**
     * @returns {Promise<void>}
     */
    close() {
      for (const socket of [...sockets]) socket.destroy()
      server.closeAllConnections()
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
