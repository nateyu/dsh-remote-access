/**
 * Sliding-window lock for PIN guesses. Memory-only: a process restart clears it.
 */

/**
 * @param {{ windowMs?: number, maxFailures?: number, lockMs?: number }} [options]
 */
export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? 60_000
  const maxFailures = options.maxFailures ?? 5
  const lockMs = options.lockMs ?? 60_000
  /** @type {Map<string, { count: number, windowStart: number, lockedUntil: number }>} */
  const byIp = new Map()

  function recordOf(ip, now) {
    const existing = byIp.get(ip)
    if (!existing || now - existing.windowStart > windowMs) {
      const fresh = { count: 0, windowStart: now, lockedUntil: 0 }
      byIp.set(ip, fresh)
      return fresh
    }
    return existing
  }

  return {
    /**
     * @param {string} ip
     * @param {number} [now]
     */
    status(ip, now = Date.now()) {
      const rec = byIp.get(ip)
      const lockedUntil = rec?.lockedUntil ?? 0
      if (lockedUntil > now) {
        return { locked: true, retryAfter: Math.ceil((lockedUntil - now) / 1000) }
      }
      return { locked: false, retryAfter: 0 }
    },
    /**
     * @param {string} ip
     * @param {number} [now]
     */
    fail(ip, now = Date.now()) {
      const rec = recordOf(ip, now)
      rec.count += 1
      if (rec.count >= maxFailures) rec.lockedUntil = now + lockMs
      return this.status(ip, now)
    },
    /**
     * @param {string} ip
     */
    clear(ip) {
      byIp.delete(ip)
    },
  }
}
