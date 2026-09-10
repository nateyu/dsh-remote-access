import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { randomPin } from './pin.js'
import { dshHome, statePath } from './home.js'
import { composeSshTarget, parseRemotePort, parseSshLoginPort, parseSshTarget, sshUserHost } from './ssh-target.js'

/**
 * @typedef {object} RemoteState
 * @property {string} cookieSecret
 * @property {string} lanPin
 * @property {string} publicPin
 * @property {boolean} lanEnabled
 * @property {boolean} lanPinRequired
 * @property {'quick' | 'named'} cloudflareMode
 * @property {string} cloudflareToken
 * @property {string} sshTarget
 * @property {string} sshUsername
 * @property {string} sshHost
 * @property {number} sshLoginPort
 * @property {number} sshRemotePort
 * @property {string} sshIdentityFile
 * @property {string} sshPassword
 */

/**
 * @returns {RemoteState}
 */
export function emptyState() {
  return {
    cookieSecret: randomBytes(32).toString('hex'),
    lanPin: randomPin(),
    publicPin: randomPin(),
    lanEnabled: false,
    lanPinRequired: false,
    cloudflareMode: 'quick',
    cloudflareToken: '',
    sshTarget: '',
    sshUsername: '',
    sshHost: '',
    sshLoginPort: 22,
    sshRemotePort: 3090,
    sshIdentityFile: '',
    sshPassword: '',
  }
}

/**
 * Derive `sshTarget` when both user and host are present; leave it empty otherwise.
 *
 * @param {RemoteState} state
 */
export function syncSshTarget(state) {
  if (!state.sshUsername || !state.sshHost) {
    state.sshTarget = ''
    return state
  }
  try {
    state.sshTarget = sshUserHost(composeSshTarget(state.sshUsername, state.sshHost, state.sshLoginPort))
  } catch {
    state.sshTarget = ''
  }
  return state
}

/**
 * Persist SSH form fields independently so a draft survives a failed start.
 *
 * @param {RemoteState} state
 * @param {{ target?: unknown, username?: unknown, host?: unknown, loginPort?: unknown, remotePort?: unknown, identityFile?: unknown, password?: unknown }} patch
 */
export function applySshPatch(state, patch) {
  if (patch.loginPort !== undefined && patch.loginPort !== '') {
    state.sshLoginPort = parseSshLoginPort(patch.loginPort)
  }
  if (typeof patch.username === 'string') state.sshUsername = patch.username.trim()
  if (typeof patch.host === 'string') state.sshHost = patch.host.trim()
  if (patch.target !== undefined && patch.username === undefined && patch.host === undefined) {
    const parsed = parseSshTarget(patch.target, state.sshLoginPort)
    state.sshUsername = parsed.username
    state.sshHost = parsed.host
    const hostPort = String(patch.target).trim().slice(String(patch.target).trim().lastIndexOf('@') + 1)
    if ((hostPort.match(/:/g) ?? []).length === 1) state.sshLoginPort = parsed.port
  }
  if (patch.remotePort !== undefined && patch.remotePort !== '') {
    state.sshRemotePort = parseRemotePort(patch.remotePort)
  }
  if (typeof patch.identityFile === 'string') state.sshIdentityFile = patch.identityFile.trim()
  if (typeof patch.password === 'string' && patch.password !== '********') {
    state.sshPassword = patch.password
  }
  return syncSshTarget(state)
}

/**
 * @param {unknown} raw
 * @returns {RemoteState}
 */
export function normalizeState(raw) {
  const base = emptyState()
  if (raw === null || typeof raw !== 'object') return base
  const input = /** @type {Record<string, unknown>} */ (raw)
  if (typeof input.cookieSecret === 'string' && input.cookieSecret.length >= 32) {
    base.cookieSecret = input.cookieSecret
  }
  if (typeof input.lanPin === 'string' && input.lanPin.length > 0) base.lanPin = input.lanPin
  if (typeof input.publicPin === 'string' && input.publicPin.length > 0) base.publicPin = input.publicPin
  if (typeof input.lanEnabled === 'boolean') base.lanEnabled = input.lanEnabled
  if (typeof input.lanPinRequired === 'boolean') base.lanPinRequired = input.lanPinRequired
  if (input.cloudflareMode === 'quick' || input.cloudflareMode === 'named') {
    base.cloudflareMode = input.cloudflareMode
  }
  if (typeof input.cloudflareToken === 'string') base.cloudflareToken = input.cloudflareToken
  if (Number.isInteger(Number(input.sshLoginPort))) {
    const loginPort = Number(input.sshLoginPort)
    if (loginPort >= 1 && loginPort <= 65535) base.sshLoginPort = loginPort
  }
  if (typeof input.sshUsername === 'string') base.sshUsername = input.sshUsername.trim()
  if (typeof input.sshHost === 'string') base.sshHost = input.sshHost.trim()
  if (typeof input.sshTarget === 'string' && input.sshTarget.trim()) {
    try {
      const parsed = parseSshTarget(input.sshTarget, base.sshLoginPort)
      if (!base.sshUsername) base.sshUsername = parsed.username
      if (!base.sshHost) base.sshHost = parsed.host
      const hostPort = input.sshTarget.trim().slice(input.sshTarget.trim().lastIndexOf('@') + 1)
      if ((hostPort.match(/:/g) ?? []).length === 1) base.sshLoginPort = parsed.port
    } catch {
      if (!base.sshHost && !input.sshTarget.includes('@')) base.sshHost = input.sshTarget.trim()
    }
  }
  if (Number.isInteger(Number(input.sshRemotePort))) {
    const remotePort = Number(input.sshRemotePort)
    if (remotePort >= 1 && remotePort <= 65535) base.sshRemotePort = remotePort
  }
  if (typeof input.sshIdentityFile === 'string') base.sshIdentityFile = input.sshIdentityFile
  if (typeof input.sshPassword === 'string') base.sshPassword = input.sshPassword
  return syncSshTarget(base)
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  return normalizeState(JSON.parse(text))
}

/**
 * @returns {Promise<RemoteState>}
 */
export async function loadState() {
  try {
    return await readJson(statePath())
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const previous = join(dshHome(), 'storages', 'dsh-remote-proxyy.json')
  try {
    const migrated = await readJson(previous)
    await saveState(migrated)
    await rm(previous, { force: true })
    return migrated
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const legacy = join(dshHome(), 'dsh-gateway', 'state.json')
  try {
    const migrated = await readJson(legacy)
    await saveState(migrated)
    await rm(join(dshHome(), 'dsh-gateway'), { recursive: true, force: true })
    return migrated
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return emptyState()
    }
    throw error
  }
}

/**
 * @param {RemoteState} state
 */
export async function saveState(state) {
  const path = statePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}
