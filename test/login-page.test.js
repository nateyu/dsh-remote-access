import { test } from 'node:test'
import assert from 'node:assert/strict'

import { loginPageHtml } from '../lib/login-page.js'

test('login page states the PIN is 10 letters or digits', () => {
  const html = loginPageHtml({ kind: 'public' })
  assert.match(html, /exactly 10 letters or digits/)
  assert.match(html, /pattern="\[A-Za-z0-9\]\{10\}"/)
  assert.match(html, /:user-invalid/)
})
