import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

/**
 * @param {string} binary
 * @param {number} localPort
 * @param {{ mode: 'quick' | 'named', token: string }} options
 */
export function cloudflaredArgs(binary, localPort, options) {
  const url = `http://127.0.0.1:${localPort}`
  if (options.mode === 'named') {
    const token = options.token.trim()
    if (!token) {
      throw Object.assign(new Error('Named tunnel needs a Cloudflare token'), { code: 'bad-request' })
    }
    return [binary, ['tunnel', '--no-autoupdate', 'run', '--token', token]]
  }
  return [binary, ['tunnel', '--no-autoupdate', '--url', url]]
}

/**
 * @param {string} line
 * @returns {string | null}
 */
export function parseTunnelUrl(line) {
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
  return match ? match[0] : null
}

/**
 * @param {{
 *   binary: string
 *   localPort: number
 *   mode: 'quick' | 'named'
 *   token: string
 *   onUrl: (url: string) => void
 *   onExit: (code: number | null, signal: NodeJS.Signals | null, lastLine?: string) => void
 *   onSpawnError?: (error: Error) => void
 * }} spec
 */
export function startCloudflared(spec) {
  const [command, args] = cloudflaredArgs(spec.binary, spec.localPort, {
    mode: spec.mode,
    token: spec.token,
  })
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })
  let lastLine = ''
  const onLine = (line) => {
    lastLine = line
    const url = parseTunnelUrl(line)
    if (url) spec.onUrl(url)
  }
  if (child.stdout) {
    createInterface({ input: child.stdout }).on('line', onLine)
  }
  if (child.stderr) {
    createInterface({ input: child.stderr }).on('line', onLine)
  }
  child.on('exit', (code, signal) => spec.onExit(code, signal, lastLine))
  child.on('error', (error) => {
    spec.onSpawnError?.(error)
    spec.onExit(1, null, lastLine)
  })
  return child
}
