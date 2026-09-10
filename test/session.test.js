import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cookieMatches, isAuthenticated, signCookie } from '../lib/session.js'

const secret = 'a'.repeat(64)
const state = {
  cookieSecret: secret,
  lanPin: 'LanPin0001',
  publicPin: 'PubPin0001',
  lanPinRequired: true,
}

test('signed cookies match only the PIN they were minted for', () => {
  const cookie = signCookie(secret, 'public', state.publicPin)
  assert.equal(cookieMatches(secret, cookie, 'public', state.publicPin), true)
  assert.equal(cookieMatches(secret, cookie, 'public', state.lanPin), false)
  assert.equal(cookieMatches(secret, cookie, 'lan', state.publicPin), false)
})

test('isAuthenticated requires a cookie on public Hosts and when LAN PIN is on', () => {
  const publicReq = { headers: { host: 'abc.trycloudflare.com', cookie: '' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(isAuthenticated(publicReq, state), false)
  const cookie = signCookie(secret, 'public', state.publicPin)
  const authed = { headers: { host: 'abc.trycloudflare.com', cookie: `dshra=${encodeURIComponent(cookie)}` }, socket: { remoteAddress: '127.0.0.1' } }
  assert.equal(isAuthenticated(authed, state), true)
  const lanOpen = { headers: { host: '192.168.1.20:3090', cookie: '' }, socket: { remoteAddress: '192.168.1.50' } }
  assert.equal(isAuthenticated(lanOpen, { ...state, lanPinRequired: false }), true)
  const sshReq = { headers: { host: '192.168.42.111:12168', cookie: '' }, socket: { remoteAddress: '127.0.0.1' } }
  const ssh = { open: true, host: '192.168.42.111', port: 12168, listenPort: 3090 }
  assert.equal(isAuthenticated(sshReq, { ...state, lanPinRequired: false }, ssh), false)
})
