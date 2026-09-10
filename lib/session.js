import { createHmac, timingSafeEqual } from 'node:crypto'
import { hostClass, isSshEntryHost } from './origin.js'

const COOKIE_NAME = 'dshra'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7

/**
 * @param {string} secret
 * @param {'lan' | 'public'} kind
 * @param {string} pin
 */
export function signCookie(secret, kind, pin) {
  const payload = `${kind}.${pin}`
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${kind}.${sig}`
}

/**
 * @param {string} secret
 * @param {string} cookie
 * @param {'lan' | 'public'} kind
 * @param {string} pin
 */
export function cookieMatches(secret, cookie, kind, pin) {
  const expected = signCookie(secret, kind, pin)
  const left = Buffer.from(cookie)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  const header = req.headers.cookie
  if (typeof header !== 'string' || header.length === 0) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('./origin.js').SshEntry | null | undefined} [ssh]
 * @returns {'lan' | 'public'}
 */
export function requestKind(req, ssh) {
  if (isSshEntryHost(req.headers.host, ssh)) return 'public'
  return hostClass(req.headers.host) === 'public' ? 'public' : 'lan'
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ cookieSecret: string, lanPin: string, publicPin: string, lanPinRequired: boolean }} state
 * @param {import('./origin.js').SshEntry | null | undefined} [ssh]
 */
export function isAuthenticated(req, state, ssh) {
  const kind = requestKind(req, ssh)
  if (kind === 'lan' && !state.lanPinRequired) return true
  const cookie = parseCookies(req)[COOKIE_NAME]
  if (!cookie) return false
  const pin = kind === 'public' ? state.publicPin : state.lanPin
  return cookieMatches(state.cookieSecret, cookie, kind, pin)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {string} value
 * @param {boolean} secure
 */
export function setSessionCookie(res, value, secure) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ]
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

/**
 * @param {import('node:http').ServerResponse} res
 */
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

export { COOKIE_NAME }
