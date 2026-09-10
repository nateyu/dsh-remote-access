import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConnection, createServer } from 'node:net'

import { aliasForwardingDestinations, assertIdentityPath, classifySshFailure, composeSshTarget, createTcpRelay, lookupForwardedPort, parseSshdT, parseSshTarget, probeTcp, PUBLIC_FORWARD_ADDRS, remoteListenIsLoopbackOnly, sshClientConfig, sshHintUrl } from '../lib/ssh-forward.js'

test('parseSshTarget splits user, host, and optional port', () => {
  assert.deepEqual(parseSshTarget('alice@203.0.113.10'), {
    raw: 'alice@203.0.113.10',
    username: 'alice',
    host: '203.0.113.10',
    port: 22,
  })
  assert.equal(parseSshTarget('user@host:2222').port, 2222)
  assert.equal(parseSshTarget('alice@203.0.113.10', 2222).port, 2222)
  assert.equal(composeSshTarget('root', '185.238.251.17', 2222).username, 'root')
  assert.equal(composeSshTarget('root', '185.238.251.17', 2222).host, '185.238.251.17')
  assert.throws(() => composeSshTarget('', 'host'), /user and host/)
  assert.throws(() => parseSshTarget('host-only'), /user@host/)
  assert.throws(() => parseSshTarget('user@host;rm'), /SSH target/)
})

test('sshClientConfig uses a key or password and rejects flag-like identity paths', async () => {
  assert.throws(() => assertIdentityPath('-oSendEnv=*'), /identity/)
  const withPassword = await sshClientConfig({
    target: 'alice@203.0.113.10:22',
    identityFile: '',
    password: 'secret',
    agent: '',
  })
  assert.equal(withPassword.host, '203.0.113.10')
  assert.equal(withPassword.port, 22)
  assert.equal(withPassword.username, 'alice')
  assert.equal(withPassword.password, 'secret')
  const customLogin = await sshClientConfig({
    target: 'alice@203.0.113.10',
    loginPort: 2222,
    identityFile: '',
    password: 'secret',
    agent: '',
  })
  assert.equal(customLogin.port, 2222)
  await assert.rejects(
    () => sshClientConfig({ target: 'alice@host', identityFile: '', password: '', agent: '' }),
    /private key|password/,
  )
})

test('sshHintUrl uses the VPS host and remote port', () => {
  assert.equal(sshHintUrl('alice@203.0.113.10:22', 8443), 'http://203.0.113.10:8443')
})

test('reverse-forward requests 0.0.0.0 then any-address, never loopback-only as success', () => {
  assert.deepEqual(PUBLIC_FORWARD_ADDRS, ['0.0.0.0', ''])
})

test('parseSshdT and listen dumps classify GatewayPorts vs firewall', () => {
  assert.deepEqual(parseSshdT('gatewayports no\nallowtcpforwarding yes\n'), {
    gatewayPorts: 'no',
    allowTcpForwarding: 'yes',
  })
  assert.equal(remoteListenIsLoopbackOnly('LISTEN 0 128 127.0.0.1:12168 0.0.0.0:*\nLISTEN 0 128 [::1]:12168 [::]:*\n', 12168), true)
  assert.equal(remoteListenIsLoopbackOnly('LISTEN 0 128 0.0.0.0:12168 0.0.0.0:*\n', 12168), false)
  assert.equal(remoteListenIsLoopbackOnly('nothing', 12168), null)
  assert.equal(classifySshFailure({
    sshdText: 'gatewayports no\nallowtcpforwarding yes\n',
    listenText: 'LISTEN 0 128 127.0.0.1:12168 0.0.0.0:*\n',
    port: 12168,
    probeOk: false,
  }), 'gatewayports')
  assert.equal(classifySshFailure({
    sshdText: 'gatewayports clientspecified\nallowtcpforwarding yes\n',
    listenText: 'LISTEN 0 128 0.0.0.0:12168 0.0.0.0:*\n',
    port: 12168,
    probeOk: false,
  }), 'unreachable')
  assert.equal(classifySshFailure({
    sshdText: 'gatewayports no\nallowtcpforwarding no\n',
    listenText: '',
    port: 12168,
    probeOk: false,
    forwardError: 'Port forwarding administratively prohibited',
  }), 'tcpforwarding')
})

test('lookupForwardedPort accepts destIP sshd reports, not only the bind address', () => {
  const table = { '0.0.0.0:3090': 3090 }
  assert.equal(lookupForwardedPort(table, '0.0.0.0', 3090), 3090)
  assert.equal(lookupForwardedPort(table, '185.238.251.17', 3090), 3090)
  assert.equal(lookupForwardedPort(table, '127.0.0.1', 3090), 3090)
  assert.equal(lookupForwardedPort(table, '10.0.0.1', 8080), undefined)
})

test('aliasForwardingDestinations makes ssh2 see a public destIP as the reverse-forward', () => {
  const conn = { _forwarding: { '0.0.0.0:3090': 3090 } }
  aliasForwardingDestinations(conn)
  assert.equal(conn._forwarding['185.238.251.17:3090'], 3090)
  assert.equal(conn._forwarding['127.0.0.1:3090'], 3090)
  assert.equal(conn._forwarding['0.0.0.0:3090'], 3090)
})

test('createTcpRelay accept()s only after the loopback socket is connected', async () => {
  const order = []
  const echo = createServer((socket) => {
    order.push('local')
    socket.pipe(socket)
  })
  await new Promise((resolve, reject) => {
    echo.once('error', reject)
    echo.listen(0, '127.0.0.1', () => {
      echo.off('error', reject)
      resolve()
    })
  })
  const localPort = echo.address().port
  const side = createServer()
  await new Promise((resolve, reject) => {
    side.once('error', reject)
    side.listen(0, '127.0.0.1', () => {
      side.off('error', reject)
      resolve()
    })
  })
  const sidePort = side.address().port
  try {
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; order=${order.join(',')}`)), 3000)
      side.once('connection', (socket) => {
        createTcpRelay(localPort)({}, () => {
          order.push('accept')
          return socket
        }, () => reject(new Error('relay rejected')))
      })
      const client = createConnection({ host: '127.0.0.1', port: sidePort })
      client.once('error', reject)
      client.once('connect', () => { client.write('ping') })
      client.once('data', (chunk) => {
        clearTimeout(timer)
        client.end()
        resolve(chunk.toString())
      })
    })
    assert.equal(reply, 'ping')
    assert.equal(order[0], 'local')
    assert.ok(order.includes('accept'))
  } finally {
    echo.close()
    side.close()
  }
})

test('probeTcp succeeds against a local listener and fails a closed port', async () => {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    assert.equal(await probeTcp('127.0.0.1', port, 1000), true)
    assert.equal(await probeTcp('127.0.0.1', 1, 300), false)
  } finally {
    server.close()
  }
})
