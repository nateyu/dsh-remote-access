import { homedir } from 'node:os'
import { join } from 'node:path'
import { LEGACY_PLUGIN_NAMES, PLUGIN_NAME } from './config.js'

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function dshHome(env = process.env) {
  const value = env.DSH_HOME?.trim()
  return value && value.length > 0 ? value : join(homedir(), '.dsh')
}

/**
 * Single JSON file under the harness storages root.
 * @param {string} [home]
 */
export function statePath(home = dshHome()) {
  return join(home, 'storages', `${PLUGIN_NAME}.json`)
}

/**
 * @param {string} [home]
 */
export function ownedCleanupPaths(home = dshHome()) {
  return [
    statePath(home),
    join(home, PLUGIN_NAME),
    ...LEGACY_PLUGIN_NAMES.flatMap((name) => [
      join(home, name),
      join(home, 'storages', `${name}.json`),
    ]),
  ]
}
