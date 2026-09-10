import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function qrDataUrl(text) {
  const QRCode = require('qrcode')
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 120, type: 'image/png' })
}

/**
 * @returns {{ withQr: (url: string) => Promise<{ url: string, qr: string }> }}
 */
export function createQrCache() {
  /** @type {Map<string, string>} */
  const cache = new Map()
  return {
    async withQr(url) {
      if (!url) return { url: '', qr: '' }
      const hit = cache.get(url)
      if (hit) return { url, qr: hit }
      const qr = await qrDataUrl(url)
      cache.set(url, qr)
      return { url, qr }
    },
  }
}
