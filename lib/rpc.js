import { REMOTE_ENDPOINTS, REMOTE_RPC_CHANNEL } from './api.js'
import { CANCELLED, errorCode, errorMessage, fail, isAbortError, ok } from './errors.js'

/**
 * @param {unknown} value
 * @returns {'lan' | 'public'}
 */
function parseWhich(value) {
  const record = value !== null && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {}
  if (record.which === 'lan' || record.which === 'public') return record.which
  throw Object.assign(new Error('which must be "lan" or "public"'), { code: 'bad-request' })
}

/**
 * @param {object} ctx
 * @param {ReturnType<import('./runtime.js').createRemoteRuntime>} runtime
 */
export function installRemoteRpc(ctx, runtime) {
  if (ctx.connection?.rpc?.handle === undefined) {
    throw new Error('dsh-remote-access: ctx.connection.rpc.handle is required (load the web Connection plugin)')
  }
  return ctx.connection.rpc.handle(REMOTE_RPC_CHANNEL, async (endpoint, payload = {}, signal) => {
    if (signal?.aborted) return CANCELLED
    try {
      if (endpoint === REMOTE_ENDPOINTS.snapshot) {
        return ok(await runtime.snapshot())
      }
      if (endpoint === REMOTE_ENDPOINTS.lanSet) {
        const record = payload !== null && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {}
        if (typeof record.enabled === 'boolean') await runtime.setLanEnabled(record.enabled)
        if (typeof record.pinRequired === 'boolean') await runtime.setLanPinRequired(record.pinRequired)
        return ok(await runtime.snapshot())
      }
      if (endpoint === REMOTE_ENDPOINTS.pinSet) {
        return ok(await runtime.setPin(parseWhich(payload), /** @type {Record<string, unknown>} */ (payload).pin))
      }
      if (endpoint === REMOTE_ENDPOINTS.pinRotate) {
        return ok(await runtime.rotatePin(parseWhich(payload)))
      }
      if (endpoint === REMOTE_ENDPOINTS.cloudflareSet) {
        return ok(await runtime.setCloudflare(payload ?? {}))
      }
      if (endpoint === REMOTE_ENDPOINTS.cloudflareStart) {
        return ok(await runtime.startCloudflare())
      }
      if (endpoint === REMOTE_ENDPOINTS.cloudflareStop) {
        return ok(await runtime.stopCloudflare())
      }
      if (endpoint === REMOTE_ENDPOINTS.sshSet) {
        return ok(await runtime.setSsh(payload ?? {}))
      }
      if (endpoint === REMOTE_ENDPOINTS.sshStart) {
        return ok(await runtime.startSsh())
      }
      if (endpoint === REMOTE_ENDPOINTS.sshStop) {
        return ok(await runtime.stopSsh())
      }
      return fail('bad-request', `unknown endpoint "${endpoint}"`)
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) return CANCELLED
      return fail(errorCode(error), errorMessage(error))
    }
  }, { authority: 'loopback' })
}
