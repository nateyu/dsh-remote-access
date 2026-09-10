import { GatewaySection } from './section.jsx'
import { NS, zh, en } from './locales.js'
import { REMOTE_RPC_CHANNEL } from '../lib/api.js'
import css from './index.css'

export const name = 'dsh-remote-access'
export const inject = ['slots', 'locale', 'connection']

const STYLE_ID = 'dsh-remote-access-css'

function mountStyles() {
  if (document.getElementById(STYLE_ID)) return () => {}
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = css
  document.head.appendChild(el)
  return () => el.remove()
}

export function apply(ctx) {
  ctx.effect(() => mountStyles(), 'dsh-remote-access: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-remote-access: locale dictionaries')
  const t = ctx.locale.bind(NS)
  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(REMOTE_RPC_CHANNEL, endpoint, payload, signal)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote-access',
    locale: NS,
    order: 14,
    label: () => t('nav'),
    inject: () => ({ rpcCall, t }),
  }, GatewaySection))
}

export { GatewaySection }
