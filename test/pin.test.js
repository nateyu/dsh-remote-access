import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parsePin, PIN_PATTERN, randomPin } from '../lib/pin.js'

test('randomPin is ten unambiguous alphanumeric characters', () => {
  const pin = randomPin()
  assert.match(pin, PIN_PATTERN)
  assert.equal(pin.length, 10)
})

test('parsePin rejects short or punctuated values', () => {
  assert.equal(parsePin('AbCdEfGh12'), 'AbCdEfGh12')
  assert.throws(() => parsePin('12345678'), /10/)
  assert.throws(() => parsePin('abcd-efghi'), /10/)
})
