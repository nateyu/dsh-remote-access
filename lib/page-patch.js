/**
 * 3090 → dsh web hop: rewrite request headers so upstream sees 127.0.0.1.
 * The index document also gets Connection's documented `ownsHost` flag:
 * Host settings (models, plugin config) persist only when isLoopback is true,
 * and the browser hostname on LAN or public URLs is not loopback.
 */

/**
 * @param {number} dshPort
 */
export function loopbackOrigin(dshPort) {
  return `http://127.0.0.1:${dshPort}`
}

/** Cookie name prefix used by dsh web Connection browser sessions. */
export const DSH_AUTH_COOKIE_PREFIX = 'dsh-auth-'

/**
 * Process launch token from Connection's authenticated root URL.
 * @param {(baseUrl: string) => string} authenticatedUrl
 * @param {number} dshPort
 * @returns {string}
 */
export function launchTokenFrom(authenticatedUrl, dshPort) {
  const href = authenticatedUrl(loopbackOrigin(dshPort))
  const tokens = new URL(href).searchParams.getAll('token')
  if (tokens.length !== 1 || !tokens[0]) {
    throw new Error('dsh-remote-access: authenticatedUrl must carry one token query')
  }
  return tokens[0]
}

/**
 * @param {string | undefined} url
 * @returns {boolean}
 */
export function hasLaunchTokenQuery(url) {
  try {
    return new URL(url ?? '/', 'http://gateway.invalid').searchParams.getAll('token').length > 0
  } catch {
    return false
  }
}

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @returns {boolean}
 */
export function hasBrowserSessionCookie(headers) {
  const cookie = String(headers.cookie ?? headers.Cookie ?? '')
  for (const part of cookie.split(';')) {
    if (part.trim().startsWith(DSH_AUTH_COOKIE_PREFIX)) return true
  }
  return false
}

/**
 * Attach the process token so authorizeIndex can mint the loopback cookie.
 * The browser URL is unchanged; only the upstream request carries the token.
 * @param {string | undefined} url
 * @param {string} token
 * @returns {string}
 */
export function attachLaunchToken(url, token) {
  const next = new URL(url ?? '/', 'http://gateway.invalid')
  next.searchParams.set('token', token)
  return `${next.pathname}${next.search}`
}

/**
 * Keep 303 Location on the public hop when upstream names the loopback origin.
 * @param {import('node:http').OutgoingHttpHeaders} headers
 * @param {number} dshPort
 * @returns {import('node:http').OutgoingHttpHeaders}
 */
export function rewriteLoopbackLocation(headers, dshPort) {
  const origin = loopbackOrigin(dshPort)
  const raw = headers.location ?? headers.Location
  if (typeof raw !== 'string' || (raw !== origin && !raw.startsWith(`${origin}/`))) return headers
  const next = { ...headers }
  delete next.Location
  next.location = raw.slice(origin.length) || '/'
  return next
}

export const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {number} dshPort
 * @param {{ passthroughEncoding?: boolean }} [options]
 * @returns {import('node:http').OutgoingHttpHeaders}
 */
export function rewriteUpstreamHeaders(headers, dshPort, options = {}) {
  const origin = loopbackOrigin(dshPort)
  const authority = `127.0.0.1:${dshPort}`
  const passthroughEncoding = options.passthroughEncoding !== false
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const next = {}
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase()
    if (HOP_BY_HOP.has(name)) continue
    if (name === 'host' || name === 'origin' || name === 'referer' || name === 'sec-fetch-site') continue
    if (name === 'accept-encoding' && !passthroughEncoding) continue
    next[name] = value
  }
  next.host = authority
  next.origin = origin
  next['sec-fetch-site'] = 'same-origin'
  const referer = headers.referer ?? headers.Referer
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const url = new URL(referer)
      next.referer = `${origin}${url.pathname}${url.search}`
    } catch {
      next.referer = `${origin}/`
    }
  }
  return next
}

/**
 * WebSocket upgrade to loopback dsh web. `connection` must be the string
 * `Upgrade`; an array copied from IncomingMessage makes Node skip the handshake.
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {number} dshPort
 */
export function rewriteUpgradeHeaders(headers, dshPort) {
  const next = rewriteUpstreamHeaders(headers, dshPort)
  next.connection = 'Upgrade'
  next.upgrade = typeof headers.upgrade === 'string' ? headers.upgrade : 'websocket'
  return next
}

/**
 * Drop hop-by-hop headers from an upstream IncomingMessage before writeHead.
 * Node already dechunks the body; forwarding `transfer-encoding: chunked` makes
 * browsers parse an empty document (blank page over SSH/LAN raw TCP).
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {{ dropContentLength?: boolean }} [options]
 * @returns {import('node:http').OutgoingHttpHeaders}
 */
export function sanitizeDownstreamHeaders(headers, options = {}) {
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const next = {}
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    if (options.dropContentLength && key.toLowerCase() === 'content-length') continue
    if (key.toLowerCase() === 'content-encoding' && options.dropContentLength) continue
    next[key] = value
  }
  return next
}

const PATCH_MARKER = 'data-dsh-remote-access-proxy'

/**
 * Connection's worker-preview stand-in: `ownsHost` makes `isLoopback` true
 * regardless of `location.hostname`. Do not wrap `__ModuleLoader__` or
 * `ctx.provide`; that breaks later plugin inject.
 * @returns {string}
 */
export function htmlProxyScript() {
  return `<script ${PATCH_MARKER}>
(function () {
  function withOwnsHost(value) {
    var next = value && typeof value === 'object' ? value : {};
    next.ownsHost = true;
    return next;
  }
  try {
    var existing = globalThis.__DSH_TRANSPORT__;
    if (existing && typeof existing === 'object') {
      existing.ownsHost = true;
      return;
    }
    var held = { ownsHost: true };
    Object.defineProperty(globalThis, '__DSH_TRANSPORT__', {
      configurable: true,
      enumerable: true,
      get: function () { return held; },
      set: function (value) { held = withOwnsHost(value); }
    });
  } catch (e) {
    try { globalThis.__DSH_TRANSPORT__ = { ownsHost: true }; } catch (err) {}
  }
})();
</script>`
}

/**
 * @param {string} html
 */
export function rewriteHtmlDocument(html) {
  if (html.includes(PATCH_MARKER)) return html
  const script = htmlProxyScript()
  const head = html.match(/<head[^>]*>/i)
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  return script + html
}

/**
 * @param {string} path
 * @param {import('node:http').IncomingHttpHeaders} headers
 */
export function isHtmlDocument(path, headers) {
  const accept = String(headers.accept ?? '')
  if (path !== '/' && path !== '/index.html') return false
  return accept.includes('text/html') || accept === '' || accept === '*/*'
}
