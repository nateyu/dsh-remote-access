import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rewriteHtmlDocument, rewriteUpgradeHeaders, rewriteUpstreamHeaders, sanitizeDownstreamHeaders } from '../lib/page-patch.js'

test('rewriteUpstreamHeaders forces loopback Host, Origin, and same-origin fetch metadata', () => {
  const headers = rewriteUpstreamHeaders({
    host: '192.168.1.20:3090',
    origin: 'http://192.168.1.20:3090',
    referer: 'http://192.168.1.20:3090/settings',
    'sec-fetch-site': 'cross-site',
    'accept-encoding': 'gzip',
    accept: 'text/html',
  }, 3080)
  assert.equal(headers.host, '127.0.0.1:3080')
  assert.equal(headers.origin, 'http://127.0.0.1:3080')
  assert.equal(headers.referer, 'http://127.0.0.1:3080/settings')
  assert.equal(headers['sec-fetch-site'], 'same-origin')
  assert.equal(headers['accept-encoding'], 'gzip')
  assert.equal(headers.accept, 'text/html')
  assert.equal(headers.connection, undefined)
  const hop = rewriteUpstreamHeaders({
    host: '192.168.1.20:3090',
    connection: 'keep-alive',
    'keep-alive': 'timeout=5',
    'transfer-encoding': 'chunked',
    'content-type': 'text/plain',
  }, 3080)
  assert.equal(hop['transfer-encoding'], undefined)
  assert.equal(hop.connection, undefined)
  assert.equal(hop['keep-alive'], undefined)
  assert.equal(hop['content-type'], 'text/plain')
  const stripped = rewriteUpstreamHeaders({
    host: 'example.com',
    'accept-encoding': 'gzip',
  }, 3080, { passthroughEncoding: false })
  assert.equal(stripped['accept-encoding'], undefined)
})

test('rewriteHtmlDocument aligns the proxied document with the loopback hop', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body></body></html>'
  const rewritten = rewriteHtmlDocument(html)
  assert.ok(rewritten.includes('data-dsh-remote-access-proxy'))
  assert.ok(rewritten.includes('isLoopback'))
  assert.equal(rewriteHtmlDocument(rewritten), rewritten)
})

test('sanitizeDownstreamHeaders drops transfer-encoding so Node does not emit a truncated body', () => {
  const out = sanitizeDownstreamHeaders({
    'content-type': 'text/html',
    'transfer-encoding': 'chunked',
    connection: 'keep-alive',
    'content-length': '12',
  })
  assert.equal(out['content-type'], 'text/html')
  assert.equal(out['transfer-encoding'], undefined)
  assert.equal(out.connection, undefined)
  assert.equal(out['content-length'], '12')
  const html = sanitizeDownstreamHeaders({
    'content-type': 'text/html',
    'content-length': '12',
    'transfer-encoding': 'chunked',
  }, { dropContentLength: true })
  assert.equal(html['content-length'], undefined)
})

test('rewriteUpgradeHeaders forces a string Connection: Upgrade', () => {
  const headers = rewriteUpgradeHeaders({
    host: '185.238.251.17:3090',
    upgrade: 'websocket',
    connection: ['keep-alive', 'Upgrade'],
    'sec-websocket-key': 'abc',
  }, 3080)
  assert.equal(headers.connection, 'Upgrade')
  assert.equal(headers.upgrade, 'websocket')
  assert.equal(headers.host, '127.0.0.1:3080')
  assert.equal(headers['keep-alive'], undefined)
})
