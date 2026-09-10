import { parseRemotePort } from './ssh-target.js'

/**
 * Remote sshd dump used when a public `-R` does not accept connections.
 * Port numbers are not interpolated; matching happens in JS.
 */
export const SSHD_INSPECT_COMMAND = 'sshd -T 2>/dev/null; echo ---; ss -lnt 2>/dev/null; echo ---; netstat -lnt 2>/dev/null'

/**
 * @param {string} text
 * @returns {{ gatewayPorts: string, allowTcpForwarding: string }}
 */
export function parseSshdT(text) {
  const gatewayPorts = /(?:^|\n)gatewayports\s+(\S+)/i.exec(text)?.[1]?.toLowerCase() ?? ''
  const allowTcpForwarding = /(?:^|\n)allowtcpforwarding\s+(\S+)/i.exec(text)?.[1]?.toLowerCase() ?? ''
  return { gatewayPorts, allowTcpForwarding }
}

/**
 * Whether ss/netstat shows the access port only on loopback.
 * `null` when the dump has no row for that port.
 * @param {string} text
 * @param {unknown} port
 * @returns {boolean | null}
 */
export function remoteListenIsLoopbackOnly(text, port) {
  const access = parseRemotePort(port)
  const re = new RegExp(String.raw`(\*|0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\]|::1|::):${access}\b`, 'g')
  let publicBind = false
  let loopbackBind = false
  for (const match of String(text).matchAll(re)) {
    const addr = match[1]
    if (addr === '127.0.0.1' || addr === '[::1]' || addr === '::1') loopbackBind = true
    else publicBind = true
  }
  if (publicBind) return false
  if (loopbackBind) return true
  return null
}

/**
 * @param {{
 *   sshdText?: string
 *   listenText?: string
 *   port: number
 *   probeOk: boolean
 *   forwardError?: string
 * }} input
 * @returns {string}
 */
export function classifySshFailure(input) {
  const dump = `${input.sshdText ?? ''}\n${input.listenText ?? ''}`
  const sshd = parseSshdT(dump)
  if (sshd.allowTcpForwarding === 'no' || /prohibit|administratively/i.test(input.forwardError ?? '')) {
    return 'tcpforwarding'
  }
  const loopbackOnly = remoteListenIsLoopbackOnly(dump, input.port)
  if (loopbackOnly === true) return 'gatewayports'
  if (loopbackOnly === false && !input.probeOk) return 'unreachable'
  if (!input.probeOk) {
    if (sshd.gatewayPorts === 'yes' || sshd.gatewayPorts === 'clientspecified') return 'unreachable'
    return 'gatewayports'
  }
  return input.forwardError || 'unreachable'
}
