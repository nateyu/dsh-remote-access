import { test } from 'node:test'
import assert from 'node:assert/strict'

import { accessClass, hostClass, hostnameOf, hostPortOf, isHttps, isSshEntryHost, lanIpv4List } from '../lib/origin.js'

test('hostnameOf strips ports and brackets', () => {
  assert.equal(hostnameOf('127.0.0.1:3090'), '127.0.0.1')
  assert.equal(hostnameOf('[::1]:3090'), '::1')
  assert.equal(hostnameOf('Example.LOCAL'), 'example.local')
})

test('hostPortOf reads the Host port', () => {
  assert.equal(hostPortOf('192.168.42.111:12168'), 12168)
  assert.equal(hostPortOf('[::1]:3090'), 3090)
  assert.equal(hostPortOf('example.com'), undefined)
})

test('hostClass splits loopback, private, and public', () => {
  assert.equal(hostClass('localhost:3090'), 'loopback')
  assert.equal(hostClass('127.0.0.1'), 'loopback')
  assert.equal(hostClass('192.168.1.20:3090'), 'private')
  assert.equal(hostClass('10.0.0.4'), 'private')
  assert.equal(hostClass('172.16.0.8'), 'private')
  assert.equal(hostClass('100.64.1.2'), 'private')
  assert.equal(hostClass('mac.local'), 'private')
  assert.equal(hostClass('abc.trycloudflare.com'), 'public')
  assert.equal(hostClass('203.0.113.10:3090'), 'public')
})

test('accessClass treats a live SSH RFC1918 Host as public, not LAN', () => {
  const ssh = { open: true, host: '192.168.42.111', port: 12168, listenPort: 3090 }
  const req = { headers: { host: '192.168.42.111:12168' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(isSshEntryHost(req.headers.host, ssh), true)
  assert.equal(accessClass(req, ssh), 'public')
  assert.equal(accessClass(req), 'private')
  const lanOnThisHost = { headers: { host: '192.168.1.20:3090' }, socket: { remoteAddress: '192.168.1.50' } }
  assert.equal(accessClass(lanOnThisHost, ssh), 'private')
})

test('accessClass does not treat a spoofed localhost Host from LAN as loopback', () => {
  const lan = { headers: { host: 'localhost:3090' }, socket: { remoteAddress: '192.168.1.50' } }
  assert.equal(accessClass(lan), 'private')
  const cf = { headers: { host: 'abc.trycloudflare.com' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(accessClass(cf), 'public')
})

test('isHttps follows x-forwarded-proto so SSH HTTP does not mint a Secure cookie', () => {
  assert.equal(isHttps({ headers: { 'x-forwarded-proto': 'https' }, socket: {} }), true)
  assert.equal(isHttps({ headers: { 'x-forwarded-proto': 'http' }, socket: { encrypted: true } }), false)
  assert.equal(isHttps({ headers: {}, socket: {} }), false)
})

test('lanIpv4List prefers physical RFC1918 over virtual adapters', () => {
  const ips = lanIpv4List({
    utun0: [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  })
  assert.equal(ips[0], '192.168.1.20')
  assert.deepEqual(ips, ['192.168.1.20', '10.8.0.2'])
})
