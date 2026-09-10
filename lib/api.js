/** Shared RPC channel and endpoint names for the Host handler and settings page. */

export const REMOTE_RPC_CHANNEL = '/dsh-remote-access'

export const REMOTE_ENDPOINTS = Object.freeze({
  snapshot: 'remote.snapshot',
  lanSet: 'lan.set',
  pinSet: 'pin.set',
  pinRotate: 'pin.rotate',
  cloudflareStart: 'cloudflare.start',
  cloudflareStop: 'cloudflare.stop',
  cloudflareSet: 'cloudflare.set',
  sshStart: 'ssh.start',
  sshStop: 'ssh.stop',
  sshSet: 'ssh.set',
})
