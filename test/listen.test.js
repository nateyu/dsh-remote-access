import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { createConnection } from 'node:net'
import { randomPin } from '../lib/pin.js'
import { createProxyServer } from '../lib/listen.js'
import { emptyState } from '../lib/store.js'

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

/**
 * @param {number} port
 * @param {import('node:http').OutgoingHttpHeaders} headers
 */
function get(port, headers, path = '/') {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, headers }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('gateway rewrites Host to loopback before the upstream sees the request', async () => {
  const seen = {}
  const upstream = createServer((req, res) => {
    seen.host = req.headers.host
    seen.origin = req.headers.origin
    seen.site = req.headers['sec-fetch-site']
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><head></head><body>ok</body></html>')
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
  })
  const port = await listen(gateway.server)
  try {
    const res = await get(port, { host: `127.0.0.1:${port}`, accept: 'text/html' })
    assert.equal(res.status, 200)
    assert.equal(seen.host, `127.0.0.1:${dshPort}`)
    assert.equal(seen.origin, `http://127.0.0.1:${dshPort}`)
    assert.equal(seen.site, 'same-origin')
    assert.match(res.body, /<body>ok<\/body>/)
    assert.ok(res.body.includes('data-dsh-remote-access-proxy'))
    assert.ok(res.body.includes('ownsHost'))
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('GET / without a dsh-auth cookie completes the dsh web launch-token exchange', async () => {
  const seen = []
  const upstream = createServer((req, res) => {
    seen.push(req.url)
    if (String(req.url).includes('token=secret-token')) {
      res.writeHead(303, {
        location: `http://127.0.0.1:${dshPort}/`,
        'set-cookie': 'dsh-auth-loop=v1.cookie',
      })
      res.end()
      return
    }
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
    launchToken: () => 'secret-token',
  })
  const port = await listen(gateway.server)
  try {
    const first = await get(port, { host: '192.168.1.20:3090', accept: 'text/html' })
    assert.equal(first.status, 303)
    assert.equal(first.headers.location, '/')
    assert.match(String(first.headers['set-cookie']), /dsh-auth-loop/)
    assert.deepEqual(seen, ['/?token=secret-token'])
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('expired dsh-auth cookie retries GET / with the launch token', async () => {
  const seen = []
  const upstream = createServer((req, res) => {
    seen.push(req.url)
    if (String(req.url).includes('token=secret-token')) {
      res.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-loop=v1.fresh' })
      res.end()
      return
    }
    res.writeHead(401, { 'content-type': 'text/plain' })
    res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
    launchToken: () => 'secret-token',
  })
  const port = await listen(gateway.server)
  try {
    const res = await get(port, {
      host: '192.168.1.20:3090',
      accept: 'text/html',
      cookie: 'dsh-auth-loop=v1.expired',
    })
    assert.equal(res.status, 303)
    assert.deepEqual(seen, ['/', '/?token=secret-token'])
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('chunked upstream HTML is forwarded as a complete document', async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'transfer-encoding': 'chunked' })
    res.write('<!doctype html><html><head></head><body>')
    res.write('ok')
    res.end('</body></html>')
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
  })
  const port = await listen(gateway.server)
  try {
    const res = await get(port, { host: `127.0.0.1:${port}`, accept: 'text/html' })
    assert.equal(res.status, 200)
    assert.match(res.body, /<body>ok<\/body>/)
    assert.ok(res.body.includes('data-dsh-remote-access-proxy'))
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('WebSocket upgrades reuse no HTTP agent and reach upstream', async () => {
  const upstream = createServer()
  upstream.on('upgrade', (req, socket, head) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
    if (head.length) socket.write(head)
    socket.end()
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
  })
  const port = await listen(gateway.server)
  try {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/events.mux',
        headers: {
          host: `127.0.0.1:${port}`,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-version': '13',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
        },
      })
      req.on('upgrade', (_res, socket) => {
        socket.end()
        resolve(101)
      })
      req.on('error', reject)
      req.on('response', (res) => reject(new Error(`expected upgrade, got ${res.statusCode}`)))
      req.end()
    })
    assert.equal(status, 101)
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('SSH RFC1918 Host is the public entry, not LAN-off', async () => {
  const upstream = createServer((_req, res) => { res.end('nope') })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: false, publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => true,
    sshEntry: () => ({ open: true, host: '192.168.42.111', port: 12168 }),
  })
  const port = await listen(gateway.server)
  try {
    const ssh = await get(port, { host: '192.168.42.111:12168', accept: 'text/html' })
    assert.equal(ssh.status, 200)
    assert.match(ssh.body, /PIN/)
    assert.doesNotMatch(ssh.body, /LAN access is off/)
    const lan = await get(port, { host: '192.168.1.20:3090', accept: 'text/html' })
    assert.equal(lan.status, 403)
    assert.match(lan.body, /LAN access is off/)
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('public Host is refused until Cloudflare or SSH is running', async () => {
  const upstream = createServer((_req, res) => { res.end('nope') })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: false }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
  })
  const port = await listen(gateway.server)
  try {
    const res = await get(port, { host: 'abc.trycloudflare.com', accept: 'text/html' })
    assert.equal(res.status, 403)
    assert.match(res.body, /Public access is off/)
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

test('public plugin bundles load without a PIN cookie; the index still requires it', async () => {
  const upstream = createServer((req, res) => {
    res.setHeader('content-type', 'text/javascript')
    res.end(`// ${req.url}`)
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: false, publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => true,
  })
  const port = await listen(gateway.server)
  try {
    const bundle = await get(
      port,
      { host: '203.0.113.10:12168', accept: '*/*' },
      '/plugins/@deepseek-ai/dsh-client-hmr/client.js?rev=1',
    )
    assert.equal(bundle.status, 200)
    assert.match(bundle.body, /dsh-client-hmr/)
    const events = await get(
      port,
      { host: '203.0.113.10:12168', accept: 'text/event-stream' },
      '/plugins/events',
    )
    assert.equal(events.status, 401)
    const index = await get(port, { host: '203.0.113.10:12168', accept: 'text/html' })
    assert.equal(index.status, 200)
    assert.match(index.body, /PIN/)
  } finally {
    await gateway.close()
    await close(upstream)
  }
})

/**
 * @param {number} port
 * @param {string} host
 */
function keepAliveGet(port, host) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    socket.once('error', reject)
    socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: keep-alive\r\nAccept: text/plain\r\n\r\n`)
    socket.once('data', () => resolve(socket))
  })
}

test('close() drops keep-alive connections', async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => false,
  })
  const port = await listen(gateway.server)
  try {
    const socket = await keepAliveGet(port, `127.0.0.1:${port}`)
    const closed = new Promise((resolve) => socket.on('close', resolve))
    await gateway.close()
    await Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('socket stayed open')), 1000)),
    ])
  } finally {
    await gateway.close().catch(() => {})
    await close(upstream)
  }
})

test('dropClass destroys sockets for that access class only', async () => {
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  const dshPort = await listen(upstream)
  const state = { ...emptyState(), lanEnabled: true, lanPinRequired: false, lanPin: randomPin(), publicPin: randomPin() }
  const gateway = createProxyServer({
    listenHost: '127.0.0.1',
    listenPort: 0,
    dshPort,
    getState: () => state,
    publicOpen: () => true,
  })
  const port = await listen(gateway.server)
  try {
    const lan = await keepAliveGet(port, '192.168.1.20:3090')
    const pub = await keepAliveGet(port, 'abc.trycloudflare.com')
    const lanClosed = new Promise((resolve) => lan.on('close', resolve))
    let pubClosed = false
    pub.on('close', () => { pubClosed = true })
    gateway.dropClass('private')
    await Promise.race([
      lanClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('LAN socket stayed open')), 1000)),
    ])
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(pubClosed, false)
    pub.destroy()
  } finally {
    await gateway.close().catch(() => {})
    await close(upstream)
  }
})
