export const PLUGIN_NAME = 'dsh-remote-access'

/** Previous on-disk names still deleted on uninstall. */
export const LEGACY_PLUGIN_NAMES = ['dsh-gateway', 'dsh-remote-proxyy']

export const Config = {
  '~standard': {
    version: 1,
    vendor: PLUGIN_NAME,
    validate(value) {
      const input = value !== null && typeof value === 'object' ? value : {}
      const listenPort = input.listenPort === undefined ? 3090 : Number(input.listenPort)
      if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
        return { issues: [{ message: 'listenPort must be an integer from 1 to 65535' }] }
      }
      const listenHost = typeof input.listenHost === 'string' && input.listenHost.length > 0
        ? input.listenHost
        : '0.0.0.0'
      const cloudflaredPath = typeof input.cloudflaredPath === 'string' ? input.cloudflaredPath : ''
      return { value: { listenPort, listenHost, cloudflaredPath } }
    },
  },
}
