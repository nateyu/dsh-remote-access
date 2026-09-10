/**
 * Host half of dsh-remote-access: listen on listenPort only while LAN,
 * Cloudflare, or SSH is on, and reverse-proxy every HTTP and WebSocket
 * request onto the local dsh web port.
 *
 * The three entries share that port. The proxy hop to dsh web is rewritten as
 * loopback on the 3090 hop (request headers and the index HTML stream).
 */

import { Config, PLUGIN_NAME } from './config.js'
import { createRemoteRuntime } from './runtime.js'
import { installRemoteRpc } from './rpc.js'

export const name = PLUGIN_NAME
export const inject = ['connection', 'webServer']
export { Config }

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ listenPort: number, listenHost: string, cloudflaredPath: string }} config
 */
export function apply(ctx, config) {
  const dshPort = ctx.webServer?.port
  if (typeof dshPort !== 'number') {
    throw new Error('dsh-remote-access: ctx.webServer.port is required')
  }
  const logger = ctx.logger?.(PLUGIN_NAME) ?? console
  const runtime = createRemoteRuntime({
    dshPort,
    listenPort: config.listenPort,
    listenHost: config.listenHost,
    cloudflaredPath: config.cloudflaredPath,
    logger,
  })
  ctx.effect(() => {
    void runtime.start().catch((error) => {
      logger.error(`dsh-remote-access failed to start: ${error instanceof Error ? error.message : String(error)}`)
    })
    return () => runtime.stop()
  }, 'dsh-remote-access: reverse proxy')
  ctx.effect(() => installRemoteRpc(ctx, runtime), 'dsh-remote-access: loopback RPC')
}
