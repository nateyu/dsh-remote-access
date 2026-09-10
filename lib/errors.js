/**
 * Connection RPC only accepts a closed set of error codes. Unknown Node or
 * plugin codes (EADDRINUSE, unavailable, …) must become `internal` or the
 * browser Zod parse of the response fails and the settings page shows JSON.
 */

/**
 * @param {string} code
 * @param {string} message
 */
export function fail(code, message) {
  if (code === 'bad-request') {
    return { ok: false, error: { code: 'bad-request', message, details: { issues: [{ message }] } } }
  }
  if (code === 'cancelled') {
    return { ok: false, error: { code: 'cancelled', message, details: {} } }
  }
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

export const CANCELLED = fail('cancelled', 'The request was cancelled.')

/**
 * @template T
 * @param {T} value
 */
export function ok(value) {
  return { ok: true, value }
}

/**
 * @param {unknown} error
 */
export function errorCode(error) {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'bad-request' || error.code === 'cancelled') return error.code
  }
  return 'internal'
}

/**
 * @param {unknown} error
 */
export function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * @param {unknown} error
 */
export function isAbortError(error) {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}
