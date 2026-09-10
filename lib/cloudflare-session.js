import { startCloudflared } from './cloudflare.js'
import { resolveCloudflared } from './cloudflared-install.js'

/**
 * @param {{
 *   listenPort: number
 *   cloudflaredPath: string
 *   logger: { info: Function, warn: Function, error: Function }
 *   getClosed: () => boolean
 *   getState: () => import('./store.js').RemoteState
 *   ensureListener: () => Promise<void>
 *   releaseListenerIfIdle: () => Promise<void>
 * }} deps
 */
export function createCloudflareSession(deps) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null
  let url = ''
  let error = ''
  /** @type {'idle' | 'downloading' | 'starting' | 'ready'} */
  let phase = 'idle'
  let missingBinary = false
  let downloadReceived = 0
  let downloadTotal = 0
  /** @type {AbortController | null} */
  let abort = null

  function aborted(controller) {
    return controller.signal.aborted || deps.getClosed()
  }

  function killChild() {
    if (!child) return
    child.kill('SIGTERM')
    child = null
  }

  return {
    isRunning() {
      return child !== null
    },
    busy() {
      return child !== null || phase === 'downloading' || phase === 'starting'
    },
    snapshot() {
      return {
        running: child !== null || phase === 'downloading' || phase === 'starting',
        phase,
        mode: deps.getState().cloudflareMode,
        tokenSet: deps.getState().cloudflareToken.length > 0,
        url,
        error,
        missingBinary,
        downloadReceived,
        downloadTotal,
      }
    },
    abortStart() {
      abort?.abort()
      abort = null
    },
    /**
     * Marks starting and kicks the download/spawn loop. Does not await the binary.
     */
    beginStart() {
      if (this.busy()) return false
      url = ''
      error = ''
      missingBinary = false
      downloadReceived = 0
      downloadTotal = 0
      phase = 'starting'
      const controller = new AbortController()
      abort = controller
      void runStart(controller)
      return true
    },
    stop() {
      this.abortStart()
      killChild()
      phase = 'idle'
      url = ''
      error = ''
      missingBinary = false
      downloadReceived = 0
      downloadTotal = 0
    },
  }

  /**
   * @param {AbortController} controller
   */
  async function runStart(controller) {
    /** @type {string} */
    let binary
    try {
      binary = await resolveCloudflared({
        configured: deps.cloudflaredPath,
        signal: controller.signal,
        onDownload() {
          if (!aborted(controller)) {
            phase = 'downloading'
            downloadReceived = 0
            downloadTotal = 0
          }
        },
        onProgress(progress) {
          if (aborted(controller)) return
          downloadReceived = progress.received
          downloadTotal = progress.total
        },
      })
    } catch (cause) {
      if (aborted(controller)) return
      phase = 'idle'
      missingBinary = true
      error = cause instanceof Error ? cause.message : String(cause)
      await deps.releaseListenerIfIdle()
      return
    }
    if (aborted(controller)) return
    try {
      phase = 'starting'
      await deps.ensureListener()
      if (aborted(controller)) {
        await deps.releaseListenerIfIdle()
        return
      }
      const spawned = startCloudflared({
        binary,
        localPort: deps.listenPort,
        mode: deps.getState().cloudflareMode,
        token: deps.getState().cloudflareToken,
        onUrl(next) {
          url = next
          phase = 'ready'
          deps.logger.info(`dsh-remote-access Cloudflare URL ${next}`)
        },
        onSpawnError(cause) {
          error = cause.message
        },
        onExit(code, signal, lastLine) {
          if (child === spawned) child = null
          if (phase !== 'idle') phase = 'idle'
          if (code !== 0 && code !== null && error.length === 0) {
            error = lastLine || `cloudflared exited (${code ?? signal ?? 'unknown'})`
            deps.logger.warn(error)
          }
          void deps.releaseListenerIfIdle()
        },
      })
      child = spawned
      if (aborted(controller)) {
        if (child === spawned) {
          spawned.kill('SIGTERM')
          child = null
        }
        phase = 'idle'
        await deps.releaseListenerIfIdle()
        return
      }
      if (deps.getState().cloudflareMode === 'named') phase = 'ready'
    } catch (cause) {
      if (aborted(controller)) return
      phase = 'idle'
      error = cause instanceof Error ? cause.message : String(cause)
      await deps.releaseListenerIfIdle()
    }
  }
}
