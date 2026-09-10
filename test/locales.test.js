import { test } from 'node:test'
import assert from 'node:assert/strict'

import { zh, en } from '../client/locales.js'
import { Config } from '../lib/config.js'

test('English locale keys match the Chinese key set', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})

test('Config fills defaults and rejects a bad listenPort', () => {
  const ok = Config['~standard'].validate({})
  assert.deepEqual(ok.value, {
    listenPort: 3090,
    listenHost: '0.0.0.0',
    cloudflaredPath: '',
  })
  const bad = Config['~standard'].validate({ listenPort: 0 })
  assert.ok(bad.issues?.length)
})
