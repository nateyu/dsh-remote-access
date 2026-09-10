/**
 * Request Host classification for PIN policy.
 * Loopback and RFC1918 / CGNAT / link-local names use the LAN PIN, except the
 * live SSH reverse-forward target (often RFC1918), which uses the public PIN.
 */

/**
 * @typedef {{ open?: boolean, host?: string, port?: number, listenPort?: number }} SshEntry
 */

const PRIVATE_V4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/
const PHYSICAL_IFACE = /^(?:en\d|eth\d|wlan|wlp|wi-?fi|ethernet|wireless)/i
const VIRTUAL_IFACE = /(?:tun|tap|utun|bridge|docker|veth|vmnet|vbox|vmware|hyper-v|vethernet|wsl|tailscale|zerotier|vpn|hamachi|utun)/i

/**
 * @param {string | undefined} raw
 * @returns {string}
 */
export function hostnameOf(raw) {
  let host = String(raw ?? '').trim().toLowerCase()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end >= 0) host = host.slice(1, end)
  } else if ((host.match(/:/g) ?? []).length === 1) {
    host = host.replace(/:\d+$/, '')
  }
  return host
}

/**
 * @param {string | undefined} raw
 * @returns {number | undefined}
 */
export function hostPortOf(raw) {
  const host = String(raw ?? '').trim()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end < 0 || host[end + 1] !== ':') return undefined
    const port = Number(host.slice(end + 2))
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
  }
  if ((host.match(/:/g) ?? []).length !== 1) return undefined
  const port = Number(host.slice(host.lastIndexOf(':') + 1))
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

/**
 * SSH `-R` is reached as `http://<vps>:<remotePort>`. That Host is often RFC1918
 * and must not be gated as LAN.
 * @param {string | undefined} raw
 * @param {SshEntry | null | undefined} ssh
 * @returns {boolean}
 */
export function isSshEntryHost(raw, ssh) {
  if (!ssh?.open) return false
  const host = hostnameOf(raw)
  const port = hostPortOf(raw)
  const sshHost = hostnameOf(ssh.host)
  if (sshHost && host === sshHost) return true
  if (
    Number.isInteger(ssh.port)
    && ssh.port > 0
    && port === ssh.port
    && port !== ssh.listenPort
  ) {
    return true
  }
  return false
}

/**
 * @param {string | undefined} raw
 * @returns {'loopback' | 'private' | 'public'}
 */
export function hostClass(raw) {
  const host = hostnameOf(raw)
  if (host === 'localhost' || host === '::1' || host.startsWith('127.')) return 'loopback'
  if (host.endsWith('.local')) return 'private'
  if (PRIVATE_V4.test(host)) return 'private'
  if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) {
    return 'private'
  }
  return 'public'
}

/**
 * A forged Host: localhost from a phone must not skip the LAN PIN.
 * Cloudflare connects from loopback with a public Host header. SSH `-R` often
 * uses a private VPS Host and is classified as public when it matches the live target.
 * @param {import('node:http').IncomingMessage} req
 * @param {SshEntry | null | undefined} [ssh]
 * @returns {'loopback' | 'private' | 'public'}
 */
export function accessClass(req, ssh) {
  if (isSshEntryHost(req.headers.host, ssh)) return 'public'
  const remote = String(req.socket?.remoteAddress ?? '')
  const fromLoopback = remote === '127.0.0.1' || remote === '::1' || remote === ':ffff:127.0.0.1' || remote === '::ffff:127.0.0.1'
  const header = hostClass(req.headers.host)
  if (!fromLoopback && header === 'loopback') return 'private'
  return header
}

/**
 * @param {NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]>} interfaces
 * @returns {string[]}
 */
export function lanIpv4List(interfaces) {
  /** @type {{ ip: string, score: number, order: number }[]} */
  const found = []
  let order = 0
  for (const [name, addrs] of Object.entries(interfaces ?? {})) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' && addr.family !== 4) continue
      if (addr.internal) continue
      const ip = addr.address
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue
      found.push({ ip, score: scoreLan(ip, name), order })
      order += 1
    }
  }
  found.sort((a, b) => b.score - a.score || a.order - b.order)
  return [...new Set(found.map((row) => row.ip))]
}

/**
 * @param {string} ip
 * @param {string} iface
 */
function scoreLan(ip, iface) {
  let score = 0
  if (ip.startsWith('192.168.')) score += 40
  else if (ip.startsWith('10.')) score += 30
  else if (PRIVATE_V4.test(ip)) score += 20
  if (PHYSICAL_IFACE.test(iface)) score += 10
  if (VIRTUAL_IFACE.test(iface)) score -= 40
  return score
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.length > 0) return cf.trim()
  return String(req.socket?.remoteAddress ?? 'unknown')
}

/**
 * Cloudflare sets `x-forwarded-proto: https`. SSH reverse-forward is plain HTTP;
 * a Secure cookie would be stored and never sent, so the app never loads.
 * @param {import('node:http').IncomingMessage} req
 */
export function isHttps(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase()
  if (forwarded === 'https') return true
  if (forwarded === 'http') return false
  return Boolean(/** @type {{ encrypted?: boolean }} */ (req.socket).encrypted)
}
