import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

import { createRemoteRuntime } from '../lib/runtime.js'
import { probeTcp } from '../lib/ssh-forward.js'

const silent = { info() {}, warn() {}, error() {} }

/**
 * @returns {Promise<number>}
 */
async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

/**
 * @param {number} listenPort
 */
async function withRuntime(listenPort, fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ra-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const runtime = createRemoteRuntime({
    dshPort: 1,
    listenPort,
    listenHost: '127.0.0.1',
    cloudflaredPath: '',
    logger: silent,
  })
  try {
    await runtime.start()
    await fn(runtime)
  } finally {
    await runtime.stop()
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

test('plugin start does not bind listenPort when every path is off', async () => {
  const listenPort = await freePort()
  await withRuntime(listenPort, async () => {
    assert.equal(await probeTcp('127.0.0.1', listenPort, 300), false)
  })
})

test('LAN start binds listenPort and LAN stop unbinds it', async () => {
  const listenPort = await freePort()
  await withRuntime(listenPort, async (runtime) => {
    const on = await runtime.setLanEnabled(true)
    assert.equal(on.lanEnabled, true)
    assert.equal(await probeTcp('127.0.0.1', listenPort, 1000), true)
    const off = await runtime.setLanEnabled(false)
    assert.equal(off.lanEnabled, false)
    assert.equal(await probeTcp('127.0.0.1', listenPort, 300), false)
  })
})

test('snapshot waits for start so state is loaded', async () => {
  const listenPort = await freePort()
  await withRuntime(listenPort, async (runtime) => {
    const snap = await runtime.snapshot()
    assert.equal(snap.listenPort, listenPort)
    assert.equal(snap.lanEnabled, false)
    assert.equal(typeof snap.publicPin, 'string')
    assert.equal(snap.publicPin.length, 10)
  })
})
