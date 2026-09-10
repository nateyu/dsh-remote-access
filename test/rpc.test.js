import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REMOTE_ENDPOINTS, REMOTE_RPC_CHANNEL } from '../lib/api.js'
import { installRemoteRpc } from '../lib/rpc.js'

function handlerFor(runtime) {
  const ctx = {}
  ctx.connection = {
    rpc: {
      handle(channel, handler, options) {
        ctx.channel = channel
        ctx.options = options
        ctx.handler = handler
        return () => {}
      },
    },
  }
  installRemoteRpc(ctx, runtime)
  return ctx
}

test('installRemoteRpc registers a loopback channel', async () => {
  const runtime = { snapshot: async () => ({ listenPort: 3090 }) }
  const ctx = handlerFor(runtime)
  assert.equal(ctx.channel, REMOTE_RPC_CHANNEL)
  assert.deepEqual(ctx.options, { authority: 'loopback' })
  const listed = await ctx.handler(REMOTE_ENDPOINTS.snapshot, {})
  assert.equal(listed.ok, true)
  assert.equal(listed.value.listenPort, 3090)
})

test('unknown endpoints and cancelled signals fail loudly', async () => {
  const ctx = handlerFor({ snapshot: async () => ({}) })
  const cancelled = await ctx.handler(REMOTE_ENDPOINTS.snapshot, {}, AbortSignal.abort())
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.error.code, 'cancelled')
  const unknown = await ctx.handler('remote.nope', {})
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'bad-request')
})

test('installRemoteRpc fails loud when Connection RPC is missing', () => {
  assert.throws(() => installRemoteRpc({}, {}), /rpc.handle/)
})

test('pinSet and lanSet route to the runtime', async () => {
  const calls = []
  const runtime = {
    snapshot: async () => ({ ok: true }),
    setPin: async (which, pin) => { calls.push(['pin', which, pin]); return { pin } },
    setLanEnabled: async (enabled) => { calls.push(['lan', enabled]) },
    setLanPinRequired: async (required) => { calls.push(['req', required]) },
  }
  const ctx = handlerFor(runtime)
  const pin = await ctx.handler(REMOTE_ENDPOINTS.pinSet, { which: 'public', pin: 'AbCdEfGh12' })
  assert.equal(pin.ok, true)
  const lan = await ctx.handler(REMOTE_ENDPOINTS.lanSet, { enabled: true, pinRequired: false })
  assert.equal(lan.ok, true)
  assert.deepEqual(calls, [['pin', 'public', 'AbCdEfGh12'], ['lan', true], ['req', false]])
})
