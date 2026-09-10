import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { packageBinaryPath, platformAssets, releaseUrls } from './cloudflared-assets.js'
import { findExecutable, isExecutable } from './which.js'

const MIN_BYTES = 1024

/**
 * @param {string} dir
 * @param {RegExp} name
 * @returns {Promise<string | null>}
 */
async function findNamed(dir, name) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findNamed(path, name)
      if (nested) return nested
    } else if (name.test(entry.name)) {
      return path
    }
  }
  return null
}

/**
 * @param {string} archive
 * @param {string} dest
 */
export async function extractCloudflared(archive, dest) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cf-'))
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('tar', ['-xzf', archive, '-C', dir], { stdio: 'ignore' })
      child.on('error', reject)
      child.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar exited ${code}`))
      })
    })
    const found = await findNamed(dir, /^cloudflared(\.exe)?$/)
    if (!found) throw new Error('archive did not contain cloudflared')
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(found, dest)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * @param {string} url
 * @param {string} dest
 * @param {{
 *   fetchImpl?: typeof fetch
 *   signal?: AbortSignal
 *   onProgress?: (progress: { received: number, total: number }) => void
 * }} [options]
 */
export async function downloadFile(url, dest, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, { signal: options.signal, redirect: 'follow' })
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)
  const total = Number(response.headers.get('content-length')) || 0
  await mkdir(dirname(dest), { recursive: true })
  let received = 0
  options.onProgress?.({ received, total })

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    received = buffer.length
    options.onProgress?.({ received, total: total || received })
    if (buffer.length < MIN_BYTES) throw new Error(`download from ${url} was too small`)
    await writeFile(dest, buffer)
    return
  }

  const file = createWriteStream(dest)
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      received += chunk.length
      options.onProgress?.({ received, total })
      if (!file.write(chunk)) await once(file, 'drain')
    }
    file.end()
    await once(file, 'finish')
  } catch (error) {
    file.destroy()
    await rm(dest, { force: true })
    throw error
  }
  if (received < MIN_BYTES) {
    await rm(dest, { force: true })
    throw new Error(`download from ${url} was too small`)
  }
}

/**
 * @param {unknown} error
 * @param {AbortSignal} [signal]
 */
function aborted(error, signal) {
  return Boolean(signal?.aborted)
    || (error instanceof Error && error.name === 'AbortError')
}

/**
 * @param {string} dest
 * @param {{
 *   assets?: string[]
 *   urlsFor?: (asset: string) => string[]
 *   fetchImpl?: typeof fetch
 *   extract?: typeof extractCloudflared
 *   signal?: AbortSignal
 *   onProgress?: (progress: { received: number, total: number }) => void
 * }} [options]
 */
export async function installCloudflared(dest, options = {}) {
  const assets = options.assets ?? platformAssets()
  const urlsFor = options.urlsFor ?? releaseUrls
  const extract = options.extract ?? extractCloudflared
  /** @type {Error | undefined} */
  let last
  for (const asset of assets) {
    for (const url of urlsFor(asset)) {
      const tmp = `${dest}.download`
      try {
        await downloadFile(url, tmp, {
          fetchImpl: options.fetchImpl,
          signal: options.signal,
          onProgress: options.onProgress,
        })
        if (asset.endsWith('.tgz')) await extract(tmp, dest)
        else {
          await mkdir(dirname(dest), { recursive: true })
          await copyFile(tmp, dest)
        }
        if (process.platform !== 'win32') await chmod(dest, 0o755)
        await rm(tmp, { force: true })
        const info = await stat(dest)
        if (info.size < MIN_BYTES) throw new Error('installed cloudflared is too small')
        return dest
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error))
        await rm(tmp, { force: true })
        if (aborted(error, options.signal)) throw last
      }
    }
  }
  throw last ?? new Error('cloudflared download failed')
}

/**
 * PATH, a configured path, this package's `bin/`, then GitHub latest into `bin/`.
 * @param {{
 *   configured?: string
 *   cachePath?: string
 *   find?: typeof findExecutable
 *   onDownload?: () => void
 *   signal?: AbortSignal
 *   fetchImpl?: typeof fetch
 *   assets?: string[]
 *   urlsFor?: (asset: string) => string[]
 *   extract?: typeof extractCloudflared
 *   onProgress?: (progress: { received: number, total: number }) => void
 * }} [options]
 */
export async function resolveCloudflared(options = {}) {
  const find = options.find ?? findExecutable
  const existing = await find('cloudflared', options.configured)
  if (existing) return existing
  const cached = options.cachePath ?? packageBinaryPath()
  if (await isExecutable(cached)) return cached
  options.onDownload?.()
  await installCloudflared(cached, {
    fetchImpl: options.fetchImpl,
    signal: options.signal,
    assets: options.assets,
    urlsFor: options.urlsFor,
    extract: options.extract,
    onProgress: options.onProgress,
  })
  return cached
}

/**
 * Optional `node lib/cloudflared-install.js` hook: fill `bin/` when missing.
 * Failure is non-fatal; the settings page downloads again on first Cloudflare start.
 */
export async function postinstallCloudflared() {
  if (process.env.DSH_SKIP_CLOUDFLARED === '1') return
  const dest = packageBinaryPath()
  if (await isExecutable(dest)) return dest
  return installCloudflared(dest)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await postinstallCloudflared()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[dsh-remote-access] cloudflared will download on first Cloudflare start (${message})`)
  }
}
