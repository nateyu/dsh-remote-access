import { parseSshTarget, sshUserHost } from './ssh-target.js'
import { startSshForward } from './ssh-forward.js'

const START_TIMEOUT_MS = 25_000
const DESTROY_AFTER_END_MS = 1_500

/**
 * @param {{
 *   listenPort: number
 *   logger: { info: Function, warn: Function, error: Function }
 *   getClosed: () => boolean
 *   getState: () => import('./store.js').RemoteState
 *   ensureListener: () => Promise<void>
 *   releaseListenerIfIdle: () => Promise<void>
 * }} deps
 */
export function createSshSession(deps) {
  /** @type {{ end: () => void, destroy?: () => void } | null} */
  let handle = null
  let starting = false
  let error = ''

  return {
    isRunning() {
      return handle !== null
    },
    isStarting() {
      return starting
    },
    snapshot() {
      const state = deps.getState()
      return {
        running: handle !== null,
        target: state.sshTarget,
        username: state.sshUsername,
        host: state.sshHost,
        loginPort: state.sshLoginPort,
        remotePort: state.sshRemotePort,
        identityFile: state.sshIdentityFile,
        passwordSet: state.sshPassword.length > 0,
        error,
      }
    },
    async start() {
      if (handle || starting) return
      const state = deps.getState()
      parseSshTarget(state.sshTarget, state.sshLoginPort)
      error = ''
      starting = true
      const parsed = parseSshTarget(state.sshTarget, state.sshLoginPort)
      try {
        await deps.ensureListener()
        if (deps.getClosed()) return
        await waitUntilListening(parsed)
      } finally {
        starting = false
        if (!handle) await deps.releaseListenerIfIdle()
      }
    },
    stop() {
      if (handle) {
        handle.end()
        handle = null
      }
      error = ''
    },
  }

  /**
   * @param {{ username: string, host: string, port: number }} parsed
   */
  function waitUntilListening(parsed) {
    const state = deps.getState()
    return new Promise((resolve) => {
      let settled = false
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timeout
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let killTimer
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        clearTimeout(killTimer)
        resolve()
      }
      /** @type {{ end: () => void, destroy?: () => void } | null} */
      let current = null
      current = startSshForward({
        target: sshUserHost(parsed),
        loginPort: parsed.port,
        remotePort: state.sshRemotePort,
        localPort: deps.listenPort,
        identityFile: state.sshIdentityFile,
        password: state.sshPassword,
        publicHost: parsed.host,
        onListening() {
          handle = current
          settle()
        },
        onError(message) {
          error = message
          deps.logger.warn(error)
        },
        onExit(code) {
          const dropped = handle === current
          handle = null
          if (dropped && error.length === 0) {
            error = code !== 0 && code !== null
              ? `ssh session ended (${code ?? 'unknown'})`
              : 'ssh session ended'
            deps.logger.warn(error)
          }
          void deps.releaseListenerIfIdle()
          settle()
        },
      })
      timeout = setTimeout(() => {
        if (settled) return
        if (!error) error = 'ssh start timed out'
        current?.end()
      }, START_TIMEOUT_MS)
      killTimer = setTimeout(() => {
        if (settled) return
        current?.destroy?.()
        settle()
      }, START_TIMEOUT_MS + DESTROY_AFTER_END_MS)
    })
  }
}
