const TARGET_PATTERN = /^(?:[A-Za-z0-9._-]+@[A-Za-z0-9._-]+)(?::\d+)?$/

/**
 * @param {unknown} value
 * @param {number} [defaultPort]
 * @returns {{ raw: string, username: string, host: string, port: number }}
 */
export function parseSshTarget(value, defaultPort = 22) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!TARGET_PATTERN.test(raw) || raw.includes(' ') || raw.includes('/')) {
    throw Object.assign(new Error('SSH target must look like user@host or user@host:22'), { code: 'bad-request' })
  }
  const at = raw.lastIndexOf('@')
  const username = raw.slice(0, at)
  const hostPort = raw.slice(at + 1)
  let host = hostPort
  let port = defaultPort
  if ((hostPort.match(/:/g) ?? []).length === 1) {
    const idx = hostPort.lastIndexOf(':')
    host = hostPort.slice(0, idx)
    port = Number(hostPort.slice(idx + 1))
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw Object.assign(new Error('SSH login port must be an integer from 1 to 65535'), { code: 'bad-request' })
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('SSH login port must be an integer from 1 to 65535'), { code: 'bad-request' })
  }
  return { raw, username, host, port }
}

/**
 * @param {{ username: string, host: string }} parsed
 */
export function sshUserHost(parsed) {
  return `${parsed.username}@${parsed.host}`
}

/**
 * @param {unknown} username
 * @param {unknown} host
 * @param {number} [loginPort]
 */
export function composeSshTarget(username, host, loginPort = 22) {
  const user = typeof username === 'string' ? username.trim() : ''
  const hostname = typeof host === 'string' ? host.trim() : ''
  if (!user || !hostname) {
    throw Object.assign(new Error('SSH user and host are required'), { code: 'bad-request' })
  }
  return parseSshTarget(`${user}@${hostname}`, loginPort)
}

/**
 * @param {unknown} value
 */
export function parseSshLoginPort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('SSH login port must be an integer from 1 to 65535'), { code: 'bad-request' })
  }
  return port
}

/**
 * @param {unknown} value
 */
export function parseRemotePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('Remote port must be an integer from 1 to 65535'), { code: 'bad-request' })
  }
  return port
}

/**
 * @param {string} identityFile
 */
export function assertIdentityPath(identityFile) {
  const identity = identityFile.trim()
  if (identity.includes('\0') || identity.startsWith('-')) {
    throw Object.assign(new Error('SSH identity path is invalid'), { code: 'bad-request' })
  }
  return identity
}

/**
 * @param {string} target
 * @param {number} remotePort
 */
export function sshHintUrl(target, remotePort) {
  const parsed = parseSshTarget(target)
  return `http://${parsed.host}:${remotePort}`
}
