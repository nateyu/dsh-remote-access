import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REMOTE_ENDPOINTS, REMOTE_RPC_CHANNEL } from '../lib/api.js'
import { inject } from '../lib/index.js'
import { createRemoteRpcHandler, installRemoteRpc } from '../lib/rpc.js'

function handlerFor(runtime) {
  return createRemoteRpcHandler(runtime)
}

function mountCtx() {
  const routes = []
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        ctx.route = route
        return () => {}
      },
    },
    connection: {
      requestRejection() { return undefined },
    },
  }
  ctx.routes = routes
  return ctx
}

test('host plugin injects webServer so the RPC prefix can mount', () => {
  assert.ok(inject.includes('webServer'))
  assert.ok(inject.includes('connection'))
})

test('installRemoteRpc registers the channel on webServer', async () => {
  const runtime = { snapshot: async () => ({ listenPort: 3090 }) }
  const ctx = mountCtx()
  installRemoteRpc(ctx, runtime)
  assert.equal(ctx.route.kind, 'prefix')
  assert.equal(ctx.route.path, REMOTE_RPC_CHANNEL)
  const listed = await handlerFor(runtime)(REMOTE_ENDPOINTS.snapshot, {})
  assert.equal(listed.ok, true)
  assert.equal(listed.value.listenPort, 3090)
})

test('unknown endpoints and cancelled signals fail loudly', async () => {
  const handler = handlerFor({ snapshot: async () => ({}) })
  const cancelled = await handler(REMOTE_ENDPOINTS.snapshot, {}, AbortSignal.abort())
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.error.code, 'cancelled')
  const unknown = await handler('remote.nope', {})
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'bad-request')
})

test('installRemoteRpc fails loud when webServer is missing', () => {
  assert.throws(
    () => installRemoteRpc({ connection: { requestRejection() { return undefined } } }, {}),
    /webServer.register/,
  )
})

test('pinSet and lanSet route to the runtime', async () => {
  const calls = []
  const runtime = {
    snapshot: async () => ({ ok: true }),
    setPin: async (which, pin) => { calls.push(['pin', which, pin]); return { pin } },
    setLanEnabled: async (enabled) => { calls.push(['lan', enabled]) },
    setLanPinRequired: async (required) => { calls.push(['req', required]) },
  }
  const handler = handlerFor(runtime)
  const pin = await handler(REMOTE_ENDPOINTS.pinSet, { which: 'public', pin: 'AbCdEfGh12' })
  assert.equal(pin.ok, true)
  const lan = await handler(REMOTE_ENDPOINTS.lanSet, { enabled: true, pinRequired: false })
  assert.equal(lan.ok, true)
  assert.deepEqual(calls, [['pin', 'public', 'AbCdEfGh12'], ['lan', true], ['req', false]])
})
