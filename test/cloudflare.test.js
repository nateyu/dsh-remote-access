import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cloudflaredArgs, parseTunnelUrl } from '../lib/cloudflare.js'

test('quick tunnel points cloudflared at the local gateway', () => {
  const [bin, args] = cloudflaredArgs('/opt/cloudflared', 3090, { mode: 'quick', token: '' })
  assert.equal(bin, '/opt/cloudflared')
  assert.deepEqual(args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3090'])
})

test('named tunnel requires a token and does not pass --url', () => {
  assert.throws(() => cloudflaredArgs('cloudflared', 3090, { mode: 'named', token: '' }), /token/)
  const [, args] = cloudflaredArgs('cloudflared', 3090, { mode: 'named', token: 'eyJ' })
  assert.deepEqual(args, ['tunnel', '--no-autoupdate', 'run', '--token', 'eyJ'])
})

test('parseTunnelUrl picks the trycloudflare hostname', () => {
  const line = '2026-01-01 INF |  https://alpha-beta.trycloudflare.com  |'
  assert.equal(parseTunnelUrl(line), 'https://alpha-beta.trycloudflare.com')
  assert.equal(parseTunnelUrl('no url here'), null)
})
