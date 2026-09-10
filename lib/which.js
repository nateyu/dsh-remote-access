import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Directories GUI-launched processes often omit from PATH.
 */
export function fallbackBinDirs() {
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(homedir(), '.local', 'bin'),
  ]
}

/**
 * @param {string} candidate
 * @returns {Promise<string | null>}
 */
export async function isExecutable(candidate) {
  try {
    await access(candidate, constants.X_OK)
    return candidate
  } catch {
    return null
  }
}

/**
 * @param {string} name
 * @param {string} [configured]
 * @returns {Promise<string | null>}
 */
export async function findExecutable(name, configured) {
  const extra = typeof configured === 'string' ? configured.trim() : ''
  if (extra.length > 0) return isExecutable(extra)

  const names = process.platform === 'win32' && !name.endsWith('.exe')
    ? [name, `${name}.exe`]
    : [name]
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    ...fallbackBinDirs(),
  ]
  const seen = new Set()
  for (const dir of dirs) {
    if (dir.length === 0 || seen.has(dir)) continue
    seen.add(dir)
    for (const bin of names) {
      const found = await isExecutable(join(dir, bin))
      if (found) return found
    }
  }
  return null
}
