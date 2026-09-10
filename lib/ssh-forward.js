import { createConnection } from 'node:net'
import { readFile } from 'node:fs/promises'
import { Client } from 'ssh2'
import { assertIdentityPath, parseSshTarget } from './ssh-target.js'
import { classifySshFailure, SSHD_INSPECT_COMMAND } from './ssh-diagnose.js'

export {
  parseSshTarget,
  sshUserHost,
  composeSshTarget,
  parseSshLoginPort,
  parseRemotePort,
  assertIdentityPath,
  sshHintUrl,
} from './ssh-target.js'

export {
  SSHD_INSPECT_COMMAND,
  parseSshdT,
  remoteListenIsLoopbackOnly,
  classifySshFailure,
} from './ssh-diagnose.js'

/**
 * Connect options for ssh2. No OpenSSH binary is required.
 * @param {{ target: string, identityFile: string, password: string, agent?: string, loginPort?: number }} options
 */
export async function sshClientConfig(options) {
  const parsed = parseSshTarget(options.target, options.loginPort ?? 22)
  /** @type {Record<string, unknown>} */
  const config = {
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    keepaliveInterval: 30_000,
    keepaliveCountMax: 3,
    readyTimeout: 20_000,
    hostVerifier: () => true,
  }
  const identity = assertIdentityPath(options.identityFile)
  if (identity) config.privateKey = await readFile(identity)
  const password = typeof options.password === 'string' ? options.password : ''
  if (password.length > 0) config.password = password
  const agent = options.agent ?? process.env.SSH_AUTH_SOCK
  if (!config.privateKey && !config.password && typeof agent === 'string' && agent.length > 0) {
    config.agent = agent
  }
  if (!config.privateKey && !config.password && !config.agent) {
    throw Object.assign(new Error('Provide a private key file or a password'), { code: 'bad-request' })
  }
  return config
}

/**
 * Connect to local listenPort first, then accept the SSH channel.
 * Accepting first drops the HTTP/WebSocket handshake while the loopback socket is still opening.
 * @param {number} localPort
 */
export function createTcpRelay(localPort) {
  return (_info, accept, reject) => {
    const local = createConnection({ host: '127.0.0.1', port: localPort })
    const fail = () => {
      try { reject() } catch { /* channel already closed */ }
      local.destroy()
    }
    local.setNoDelay(true)
    local.once('error', fail)
    local.once('connect', () => {
      local.removeListener('error', fail)
      /** @type {import('node:stream').Duplex} */
      let remote
      try {
        remote = accept()
      } catch {
        local.destroy()
        return
      }
      const close = () => {
        local.destroy()
        remote.destroy()
      }
      remote.on('error', close)
      local.on('error', close)
      remote.setNoDelay?.(true)
      remote.pipe(local)
      local.pipe(remote)
    })
  }
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 */
export function probeTcp(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port, timeout: timeoutMs })
    const done = (ok) => {
      sock.removeAllListeners()
      sock.destroy()
      resolve(ok)
    }
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/**
 * ssh2 only emits `tcp connection` when `_forwarding[destIP:destPort]` exists.
 * sshd reports the address the client connected to, not only the bind we requested.
 * @param {Record<string, number>} table
 * @param {string} destIP
 * @param {number} destPort
 */
export function lookupForwardedPort(table, destIP, destPort) {
  const exact = table[`${destIP}:${destPort}`]
  if (exact !== undefined) return exact
  return table[`0.0.0.0:${destPort}`]
    ?? table[`*:${destPort}`]
    ?? table[`127.0.0.1:${destPort}`]
    ?? table[`localhost:${destPort}`]
    ?? table[`:${destPort}`]
}

const FORWARD_ALIASED = Symbol('dsh-forward-alias')

/**
 * @param {import('ssh2').Client} conn
 */
export function aliasForwardingDestinations(conn) {
  const client = /** @type {import('ssh2').Client & { [FORWARD_ALIASED]?: boolean, _forwarding?: Record<string, number> }} */ (conn)
  if (client[FORWARD_ALIASED]) return
  const inner = client._forwarding
  if (!inner) return
  client[FORWARD_ALIASED] = true
  client._forwarding = new Proxy(inner, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || !prop.includes(':')) {
        return Reflect.get(target, prop, receiver)
      }
      if (Object.hasOwn(target, prop)) return target[prop]
      const colon = prop.lastIndexOf(':')
      const destPort = Number(prop.slice(colon + 1))
      if (!Number.isInteger(destPort)) return Reflect.get(target, prop, receiver)
      return lookupForwardedPort(target, prop.slice(0, colon), destPort)
    },
  })
}

/**
 * Same as `ssh -R 0.0.0.0:port:127.0.0.1:local`. Loopback-only binds are not a success.
 */
export const PUBLIC_FORWARD_ADDRS = Object.freeze(['0.0.0.0', ''])

/**
 * @param {import('ssh2').Client} conn
 * @param {string} addr
 * @param {number} port
 * @returns {Promise<number>}
 */
function forwardIn(conn, addr, port) {
  return new Promise((resolve, reject) => {
    conn.forwardIn(addr, port, (error, allocated) => {
      if (error) {
        reject(error)
        return
      }
      resolve(Number(allocated) || port)
    })
  })
}

/**
 * @param {import('ssh2').Client} conn
 * @param {string} command
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
function execOutput(conn, command, timeoutMs = 8000) {
  return new Promise((resolve) => {
    conn.exec(command, (error, stream) => {
      if (error) {
        resolve('')
        return
      }
      let out = ''
      const timer = setTimeout(() => {
        stream.destroy()
        resolve(out)
      }, timeoutMs)
      stream.on('data', (chunk) => { out += chunk.toString() })
      stream.stderr.on('data', (chunk) => { out += chunk.toString() })
      stream.on('close', () => {
        clearTimeout(timer)
        resolve(out)
      })
    })
  })
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [tries]
 */
async function probeTcpRetries(host, port, tries = 5) {
  for (let i = 0; i < tries; i++) {
    if (await probeTcp(host, port, 1000)) return true
  }
  return false
}

/**
 * Pure `ssh -R 0.0.0.0:remotePort:127.0.0.1:localPort`. Marks ready only after
 * the public access port accepts TCP. Any failure ends the SSH session.
 * @param {{
 *   target: string
 *   remotePort: number
 *   localPort: number
 *   identityFile: string
 *   password: string
 *   loginPort?: number
 *   publicHost?: string
 *   onExit: (code: number | null, signal: NodeJS.Signals | null) => void
 *   onError?: (message: string) => void
 *   onListening?: () => void
 * }} spec
 */
export function startSshForward(spec) {
  const conn = new Client()
  let finished = false
  const done = (code) => {
    if (finished) return
    finished = true
    spec.onExit(code, null)
  }
  const abort = (message) => {
    spec.onError?.(message)
    conn.end()
  }

  conn.on('tcp connection', createTcpRelay(spec.localPort))

  conn.on('ready', () => {
    aliasForwardingDestinations(conn)
    void (async () => {
      /** @type {Error | undefined} */
      let lastError
      let bound = false
      for (const addr of PUBLIC_FORWARD_ADDRS) {
        try {
          await forwardIn(conn, addr, spec.remotePort)
          bound = true
          lastError = undefined
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
        }
      }
      const probeOk = bound && (spec.publicHost
        ? await probeTcpRetries(spec.publicHost, spec.remotePort)
        : true)
      if (probeOk && !finished) {
        spec.onListening?.()
        return
      }
      if (finished) return
      const inspect = await execOutput(conn, SSHD_INSPECT_COMMAND)
      abort(classifySshFailure({
        sshdText: inspect,
        listenText: inspect,
        port: spec.remotePort,
        probeOk: Boolean(probeOk),
        forwardError: lastError?.message ?? '',
      }))
    })().catch((error) => {
      if (!finished) abort(error instanceof Error ? error.message : String(error))
    })
  })

  conn.on('error', (error) => {
    spec.onError?.(error.message)
    done(1)
  })
  conn.on('close', () => done(0))

  void sshClientConfig({
    target: spec.target,
    loginPort: spec.loginPort,
    identityFile: spec.identityFile,
    password: spec.password,
  }).then((config) => {
    conn.connect(config)
  }).catch((error) => {
    spec.onError?.(error instanceof Error ? error.message : String(error))
    conn.end()
  })

  return {
    end() {
      conn.end()
    },
    destroy() {
      conn.destroy()
    },
  }
}
