import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * GitHub release asset names for this OS/arch.
 * Linux ships a bare binary; macOS ships a .tgz; Windows ships an .exe.
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 * @returns {string[]}
 */
export function platformAssets(platform = process.platform, arch = process.arch) {
  const a = arch === 'x64' ? 'amd64' : arch === 'ia32' ? '386' : arch
  if (platform === 'win32') return [`cloudflared-windows-${a}.exe`]
  if (platform === 'darwin') return [`cloudflared-darwin-${a}.tgz`]
  return [`cloudflared-linux-${a}`, `cloudflared-linux-${a}.tgz`]
}

/**
 * Official release first, then GitHub proxies for networks that cannot reach github.com.
 * @param {string} asset
 * @returns {string[]}
 */
export function releaseUrls(asset) {
  const path = `cloudflare/cloudflared/releases/latest/download/${asset}`
  return [
    `https://github.com/${path}`,
    `https://gh-proxy.com/https://github.com/${path}`,
    `https://gitproxy.click/https://github.com/${path}`,
  ]
}

/**
 * Installed npm package root (`…/dsh-remote-access`), not `$DSH_HOME`.
 * @param {string} [fromMeta]
 */
export function packageRoot(fromMeta = import.meta.url) {
  return join(dirname(fileURLToPath(fromMeta)), '..')
}

/**
 * Downloaded binary under this package's `bin/` directory.
 * @param {string} [root]
 * @param {NodeJS.Platform} [platform]
 */
export function packageBinaryPath(root = packageRoot(), platform = process.platform) {
  const name = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared'
  return join(root, 'bin', name)
}
