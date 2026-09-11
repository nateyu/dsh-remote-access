import { test } from 'node:test'
import assert from 'node:assert/strict'

import { errorCode, fail } from '../lib/errors.js'
import { REMOTE_ENDPOINTS } from '../lib/api.js'
import { createRemoteRpcHandler } from '../lib/rpc.js'

test('fail only emits Connection RPC error codes', () => {
  assert.equal(fail('unavailable', 'missing').error.code, 'internal')
  assert.deepEqual(fail('unavailable', 'missing').error.details, {})
  assert.equal(fail('EADDRINUSE', 'busy').error.code, 'internal')
  assert.equal(fail('bad-request', 'nope').error.code, 'bad-request')
  assert.ok(Array.isArray(fail('bad-request', 'nope').error.details.issues))
  assert.equal(fail('cancelled', 'stop').error.code, 'cancelled')
})

test('errorCode never forwards Node errno strings', () => {
  assert.equal(errorCode(Object.assign(new Error('busy'), { code: 'EADDRINUSE' })), 'internal')
  assert.equal(errorCode(Object.assign(new Error('gone'), { code: 'unavailable' })), 'internal')
  assert.equal(errorCode(Object.assign(new Error('bad'), { code: 'bad-request' })), 'bad-request')
})

test('RPC maps Node listen failures to internal instead of a Zod-invalid code', async () => {
  const handler = createRemoteRpcHandler({
    startCloudflare: async () => {
      throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })
    },
  })
  const result = await handler(REMOTE_ENDPOINTS.cloudflareStart, {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'internal')
  assert.deepEqual(result.error.details, {})
  assert.match(result.error.message, /EADDRINUSE/)
})
