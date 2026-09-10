import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSerial } from '../lib/queue.js'

test('serialize runs jobs one at a time in order', async () => {
  const { serialize } = createSerial()
  const order = []
  const first = serialize(async () => {
    order.push('a-start')
    await new Promise((resolve) => setTimeout(resolve, 30))
    order.push('a-end')
    return 1
  })
  const second = serialize(async () => {
    order.push('b')
    return 2
  })
  assert.deepEqual(await Promise.all([first, second]), [1, 2])
  assert.deepEqual(order, ['a-start', 'a-end', 'b'])
})

test('a rejected job does not stall the chain', async () => {
  const { serialize } = createSerial()
  const failed = serialize(async () => {
    throw new Error('boom')
  })
  await assert.rejects(failed, /boom/)
  assert.equal(await serialize(async () => 'ok'), 'ok')
})
