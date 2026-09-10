import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ownedCleanupPaths } from './home.js'

/**
 * Delete this plugin's persisted file (and leftover directories from earlier names).
 * Leaves `$DSH_HOME/storages` itself in place — other DSH units live there.
 * @param {string} [home]
 */
export async function removeOwnedFiles(home) {
  for (const path of ownedCleanupPaths(home)) {
    await rm(path, { recursive: true, force: true })
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await removeOwnedFiles()
}
