import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  packageBinaryPath,
  packageRoot,
  platformAssets,
  releaseUrls,
} from '../lib/cloudflared-assets.js'
import { downloadFile, extractCloudflared, installCloudflared, resolveCloudflared } from '../lib/cloudflared-install.js'

const PAYLOAD = Buffer.alloc(2048, 7)

/**
 * @param {Buffer} body
 * @param {number} [status]
 */
function serve(body, status = 200) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { 'Content-Length': String(body.length) })
    res.end(body)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('expected TCP address')
      resolve({ server, url: `http://127.0.0.1:${address.port}/asset` })
    })
  })
}

test('platformAssets match GitHub latest names', () => {
  assert.deepEqual(platformAssets('darwin', 'arm64'), ['cloudflared-darwin-arm64.tgz'])
  assert.deepEqual(platformAssets('linux', 'x64'), [
    'cloudflared-linux-amd64',
    'cloudflared-linux-amd64.tgz',
  ])
  assert.deepEqual(platformAssets('win32', 'x64'), ['cloudflared-windows-amd64.exe'])
})

test('releaseUrls try GitHub then proxies', () => {
  const urls = releaseUrls('cloudflared-darwin-arm64.tgz')
  assert.equal(urls[0], 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz')
  assert.ok(urls.some((url) => url.includes('gh-proxy.com')))
})

test('packageBinaryPath is this npm package bin/, not $DSH_HOME/storages', () => {
  const root = '/tmp/dsh-remote-access-pkg'
  assert.equal(packageBinaryPath(root, 'darwin'), join(root, 'bin', 'cloudflared'))
  assert.equal(packageBinaryPath(root, 'win32'), join(root, 'bin', 'cloudflared.exe'))
  assert.ok(!packageBinaryPath(root).includes('storages'))
  assert.equal(packageRoot(), join(dirname(fileURLToPath(import.meta.url)), '..'))
})

test('installCloudflared writes a bare binary from HTTP', async () => {
  const { server, url } = await serve(PAYLOAD)
  const root = join(tmpdir(), `dsh-cf-bare-${process.pid}-${Date.now()}`)
  const dest = packageBinaryPath(root, 'linux')
  try {
    await installCloudflared(dest, {
      assets: ['cloudflared-linux-amd64'],
      urlsFor: () => [url],
    })
    const data = await readFile(dest)
    assert.equal(data.length, PAYLOAD.length)
    assert.equal(data[0], 7)
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('installCloudflared skips a 404 URL and uses the next', async () => {
  const miss = await serve(Buffer.from('nope'), 404)
  const hit = await serve(PAYLOAD)
  const root = join(tmpdir(), `dsh-cf-skip-${process.pid}-${Date.now()}`)
  const dest = join(root, 'bin', 'cloudflared')
  try {
    await installCloudflared(dest, {
      assets: ['cloudflared-linux-amd64'],
      urlsFor: () => [miss.url, hit.url],
    })
    assert.equal((await readFile(dest)).length, PAYLOAD.length)
  } finally {
    miss.server.close()
    hit.server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('extractCloudflared unpacks a tgz onto dest', async () => {
  const work = join(tmpdir(), `dsh-cf-tar-${process.pid}-${Date.now()}`)
  await mkdir(work, { recursive: true })
  const inner = join(work, 'cloudflared')
  await writeFile(inner, PAYLOAD)
  const archive = join(work, 'cf.tgz')
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-czf', archive, '-C', work, 'cloudflared'], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar czf ${code}`))))
  })
  const dest = join(work, 'out', 'cloudflared')
  try {
    await extractCloudflared(archive, dest)
    assert.equal((await readFile(dest)).length, PAYLOAD.length)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
})

test('downloadFile reports byte progress', async () => {
  const { server, url } = await serve(PAYLOAD)
  const dest = join(tmpdir(), `dsh-cf-prog-${process.pid}-${Date.now()}`)
  const ticks = []
  try {
    await downloadFile(url, dest, { onProgress: (progress) => ticks.push({ ...progress }) })
    assert.ok(ticks.length >= 2)
    assert.equal(ticks[0].received, 0)
    assert.equal(ticks.at(-1).received, PAYLOAD.length)
    assert.equal(ticks.at(-1).total, PAYLOAD.length)
  } finally {
    server.close()
    await rm(dest, { force: true })
  }
})

test('resolveCloudflared prefers a configured executable', async () => {
  const path = await resolveCloudflared({
    configured: process.execPath,
    onDownload() {
      throw new Error('should not download')
    },
  })
  assert.equal(path, process.execPath)
})

test('resolveCloudflared reuses package bin/ when PATH has nothing', async () => {
  const root = join(tmpdir(), `dsh-cf-cache-${process.pid}-${Date.now()}`)
  const dest = packageBinaryPath(root)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, PAYLOAD)
  await chmod(dest, 0o755)
  try {
    const path = await resolveCloudflared({
      find: async () => null,
      cachePath: dest,
      onDownload() {
        throw new Error('should not download')
      },
    })
    assert.equal(path, dest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
