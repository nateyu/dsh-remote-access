import { randomBytes } from 'node:crypto'

export const PIN_PATTERN = /^[A-Za-z0-9]{10}$/

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/**
 * @returns {string} ten unambiguous alphanumeric characters
 */
export function randomPin() {
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function parsePin(value) {
  const pin = typeof value === 'string' ? value.trim() : ''
  if (!PIN_PATTERN.test(pin)) {
    throw Object.assign(new Error('PIN must be exactly 10 letters or digits'), { code: 'bad-request' })
  }
  return pin
}
