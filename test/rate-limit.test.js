import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRateLimiter } from '../lib/rate-limit.js'

test('rate limiter locks after consecutive failures and clears on success', () => {
  const limiter = createRateLimiter({ windowMs: 60_000, maxFailures: 3, lockMs: 60_000 })
  const now = 1_000
  assert.equal(limiter.fail('1.1.1.1', now).locked, false)
  assert.equal(limiter.fail('1.1.1.1', now + 1).locked, false)
  assert.equal(limiter.fail('1.1.1.1', now + 2).locked, true)
  assert.equal(limiter.status('1.1.1.1', now + 3).retryAfter > 0, true)
  limiter.clear('1.1.1.1')
  assert.equal(limiter.status('1.1.1.1', now + 4).locked, false)
})
