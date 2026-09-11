import { networkInterfaces } from 'node:os'
import { lanIpv4List } from './origin.js'
import { launchTokenFrom } from './page-patch.js'
import { applySshPatch, emptyState, loadState, saveState } from './store.js'
import { parsePin, randomPin } from './pin.js'
import { createProxyServer } from './listen.js'
import { sshHintUrl } from './ssh-target.js'
import { createSerial } from './queue.js'
import { createQrCache, qrDataUrl } from './qr.js'
import { createCloudflareSession } from './cloudflare-session.js'
import { createSshSession } from './ssh-session.js'

export { qrDataUrl }

/**
 * @param {{
 *   dshPort: number
 *   listenPort: number
 *   listenHost: string
 *   cloudflaredPath: string
 *   logger: { info: Function, warn: Function, error: Function }
 *   authenticatedUrl: (baseUrl: string) => string
 * }} options
 */
export function createRemoteRuntime(options) {
  const { serialize } = createSerial()
  const { withQr } = createQrCache()
  /** @type {import('./store.js').RemoteState} */
  let state = emptyState()
  /** @type {ReturnType<typeof createProxyServer> | null} */
  let proxy = null
  let closed = false
  /** @type {Promise<void>} */
  let boot = Promise.resolve()

  function publicOpen() {
    return cloudflare.isRunning() || ssh.isRunning()
  }

  function listenerNeeded() {
    return Boolean(state.lanEnabled) || ssh.isRunning() || ssh.isStarting() || cloudflare.busy()
  }

  async function persist() {
    await saveState(state)
  }

  async function ensureListener() {
    if (closed || proxy) return
    proxy = createProxyServer({
      listenHost: options.listenHost,
      listenPort: options.listenPort,
      dshPort: options.dshPort,
      getState: () => state,
      publicOpen,
      sshEntry() {
        return {
          open: ssh.isRunning(),
          host: state.sshHost,
          port: state.sshRemotePort,
        }
      },
      launchToken() {
        if (typeof options.authenticatedUrl !== 'function') return ''
        return launchTokenFrom(options.authenticatedUrl, options.dshPort)
      },
    })
    try {
      await proxy.listen()
    } catch (error) {
      proxy = null
      throw error
    }
    options.logger.info(`dsh-remote-access forwarding ${options.listenHost}:${options.listenPort} → 127.0.0.1:${options.dshPort}`)
  }

  async function releaseListenerIfIdle() {
    if (closed || !proxy || listenerNeeded()) return
    const current = proxy
    proxy = null
    try {
      await current.close()
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) throw error
    }
    options.logger.info(`dsh-remote-access stopped listening on ${options.listenHost}:${options.listenPort}`)
  }

  function dropPublicIfIdle() {
    if (!publicOpen()) proxy?.dropClass('public')
  }

  const sessionDeps = {
    listenPort: options.listenPort,
    logger: options.logger,
    getClosed: () => closed,
    getState: () => state,
    ensureListener,
    releaseListenerIfIdle,
  }
  const cloudflare = createCloudflareSession({
    ...sessionDeps,
    cloudflaredPath: options.cloudflaredPath,
  })
  const ssh = createSshSession(sessionDeps)

  async function snapshot() {
    await boot
    const lanUrls = []
    if (state.lanEnabled) {
      let ifaces = {}
      try {
        ifaces = networkInterfaces()
      } catch {
        ifaces = {}
      }
      for (const ip of lanIpv4List(ifaces)) {
        const url = `http://${ip}:${options.listenPort}`
        lanUrls.push({ ip, ...(await withQr(url)) })
      }
    }
    const cf = cloudflare.snapshot()
    const sshSnap = ssh.snapshot()
    const cfCard = await withQr(cf.url)
    const sshCard = ssh.isRunning() && sshSnap.target
      ? await withQr(sshHintUrl(sshSnap.target, sshSnap.remotePort))
      : { url: '', qr: '' }
    return {
      listenPort: options.listenPort,
      lanEnabled: state.lanEnabled,
      lanPinRequired: state.lanPinRequired,
      lanPin: state.lanPin,
      publicPin: state.publicPin,
      lanUrls,
      cloudflare: { ...cf, url: cfCard.url, qr: cfCard.qr },
      ssh: { ...sshSnap, hintUrl: sshCard.url, qr: sshCard.qr },
    }
  }

  return {
    start() {
      boot = serialize(async () => {
        state = await loadState()
        if (closed) return
        await persist()
        if (closed) return
        if (state.lanEnabled) await ensureListener()
      })
      return boot
    },
    stop() {
      return serialize(async () => {
        closed = true
        cloudflare.stop()
        ssh.stop()
        if (proxy) {
          await proxy.close()
          proxy = null
        }
      })
    },
    snapshot,
    setLanEnabled(enabled) {
      return serialize(async () => {
        await boot
        const next = Boolean(enabled)
        if (next) {
          await ensureListener()
          state.lanEnabled = true
        } else {
          state.lanEnabled = false
          proxy?.dropClass('private')
          await releaseListenerIfIdle()
        }
        await persist()
        return snapshot()
      })
    },
    setLanPinRequired(required) {
      return serialize(async () => {
        await boot
        state.lanPinRequired = Boolean(required)
        await persist()
        return snapshot()
      })
    },
    setPin(which, value) {
      return serialize(async () => {
        await boot
        const pin = parsePin(value)
        if (which === 'public') state.publicPin = pin
        else state.lanPin = pin
        await persist()
        return snapshot()
      })
    },
    rotatePin(which) {
      return serialize(async () => {
        await boot
        if (which === 'public') state.publicPin = randomPin()
        else state.lanPin = randomPin()
        await persist()
        return snapshot()
      })
    },
    setCloudflare(patch) {
      return serialize(async () => {
        await boot
        if (patch.mode === 'quick' || patch.mode === 'named') state.cloudflareMode = patch.mode
        if (typeof patch.token === 'string') state.cloudflareToken = patch.token.trim()
        await persist()
        return snapshot()
      })
    },
    setSsh(patch) {
      return serialize(async () => {
        await boot
        applySshPatch(state, patch)
        await persist()
        return snapshot()
      })
    },
    startCloudflare() {
      return serialize(async () => {
        await boot
        cloudflare.beginStart()
        return snapshot()
      })
    },
    stopCloudflare() {
      cloudflare.abortStart()
      return serialize(async () => {
        await boot
        cloudflare.stop()
        dropPublicIfIdle()
        await releaseListenerIfIdle()
        return snapshot()
      })
    },
    startSsh() {
      return serialize(async () => {
        await boot
        await ssh.start()
        return snapshot()
      })
    },
    stopSsh() {
      return serialize(async () => {
        await boot
        ssh.stop()
        dropPublicIfIdle()
        await releaseListenerIfIdle()
        return snapshot()
      })
    },
  }
}
