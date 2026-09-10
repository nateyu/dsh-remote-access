import { createElement as h, useCallback, useEffect, useState } from 'react'
import { Button, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'

import { REMOTE_ENDPOINTS } from '../lib/api.js'
import { DownloadProgress, Field, PinRow, Section, sshErrorText, UrlCard } from './widgets.jsx'

export function GatewaySection({ t, rpcCall }) {
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [snap, setSnap] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [cfToken, setCfToken] = useState('')
  const [sshUser, setSshUser] = useState('')
  const [sshHost, setSshHost] = useState('')
  const [sshLoginPort, setSshLoginPort] = useState('22')
  const [sshPort, setSshPort] = useState('3090')
  const [sshIdentity, setSshIdentity] = useState('')
  const [sshPassword, setSshPassword] = useState('')

  const hydrateForms = useCallback((next) => {
    setCfToken(next.cloudflare?.tokenSet ? '********' : '')
    setSshUser(next.ssh?.username ?? '')
    setSshHost(next.ssh?.host ?? '')
    setSshLoginPort(String(next.ssh?.loginPort ?? 22))
    setSshPort(String(next.ssh?.remotePort ?? 3090))
    setSshIdentity(next.ssh?.identityFile ?? '')
    setSshPassword(next.ssh?.passwordSet ? '********' : '')
  }, [])

  const applySnap = useCallback((next, hydrate = true) => {
    setSnap(next)
    if (hydrate) hydrateForms(next)
  }, [hydrateForms])

  const load = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const result = await rpcCall(REMOTE_ENDPOINTS.snapshot, {})
      if (!result?.ok) throw new Error(result?.error?.message ?? t('error'))
      applySnap(result.value)
      setStatus('ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
    }
  }, [applySnap, rpcCall, t])

  useEffect(() => { void load() }, [load])

  const refreshSnap = useCallback(async () => {
    try {
      const result = await rpcCall(REMOTE_ENDPOINTS.snapshot, {})
      if (result?.ok) applySnap(result.value, false)
    } catch {
      /* keep the last snapshot while a tunnel is starting */
    }
  }, [applySnap, rpcCall])

  useEffect(() => {
    const phase = snap?.cloudflare?.phase
    const downloading = phase === 'downloading'
    const waitingUrl = Boolean(snap?.cloudflare?.running)
      && snap?.cloudflare?.mode === 'quick'
      && !snap?.cloudflare?.url
      && !snap?.cloudflare?.error
    if (!downloading && phase !== 'starting' && !waitingUrl) return undefined
    const id = setInterval(() => { void refreshSnap() }, downloading ? 400 : 1000)
    return () => clearInterval(id)
  }, [
    refreshSnap,
    snap?.cloudflare?.error,
    snap?.cloudflare?.mode,
    snap?.cloudflare?.phase,
    snap?.cloudflare?.running,
    snap?.cloudflare?.url,
  ])

  const run = useCallback(async (endpoint, payload, { hydrate = true, busy: showBusy = true } = {}) => {
    if (showBusy) setBusy(true)
    setError(null)
    try {
      const result = await rpcCall(endpoint, payload)
      if (!result?.ok) throw new Error(result?.error?.message ?? t('error'))
      applySnap(result.value, hydrate)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (showBusy) setBusy(false)
    }
  }, [applySnap, rpcCall, t])

  const persistSshDraft = useCallback((opts = {}) => {
    const payload = {
      username: sshUser.trim(),
      host: sshHost.trim(),
      loginPort: Number(sshLoginPort) || 22,
      identityFile: sshIdentity,
    }
    const remotePort = Number(sshPort)
    if (Number.isInteger(remotePort) && remotePort >= 1 && remotePort <= 65535) {
      payload.remotePort = remotePort
    }
    if (sshPassword && sshPassword !== '********') payload.password = sshPassword
    return run(REMOTE_ENDPOINTS.sshSet, payload, { hydrate: false, ...opts })
  }, [run, sshHost, sshIdentity, sshLoginPort, sshPassword, sshPort, sshUser])

  const persistCfDraft = useCallback((opts = {}) => {
    if (!cfToken || cfToken === '********') return Promise.resolve(true)
    return run(REMOTE_ENDPOINTS.cloudflareSet, { token: cfToken }, { hydrate: false, ...opts })
  }, [cfToken, run])

  const beginStart = useCallback(async (kind) => {
    if (kind === 'ssh') await persistSshDraft()
    else await persistCfDraft()
    setAcknowledged(false)
    setPending(kind)
  }, [persistCfDraft, persistSshDraft])

  const confirmStart = useCallback(async () => {
    if (!pending) return
    const kind = pending
    setPending(null)
    setAcknowledged(false)
    if (kind === 'cloudflare') {
      await persistCfDraft()
      await run(REMOTE_ENDPOINTS.cloudflareStart, {})
      return
    }
    await persistSshDraft()
    await run(REMOTE_ENDPOINTS.sshStart, {})
  }, [pending, persistCfDraft, persistSshDraft, run])

  if (status === 'loading' && !snap) {
    return h('div', { className: 'dsh-gw' }, h('p', { className: 'dsh-gw-muted' }, t('loading')))
  }
  if (status === 'error' && !snap) {
    return h('div', { className: 'dsh-gw' },
      h('p', { className: 'dsh-gw-error', role: 'alert' }, error ?? t('error')),
      h(Button, { variant: 'outline', onClick: () => void load() }, t('retry')),
    )
  }

  const lanUrls = snap?.lanUrls ?? []
  const cf = snap?.cloudflare ?? {}
  const ssh = snap?.ssh ?? {}
  const cfPhase = cf.phase ?? 'idle'
  const cfBusy = Boolean(cf.running) || cfPhase === 'downloading' || cfPhase === 'starting'
  const cfStatus = cfPhase === 'downloading'
    ? t('cfDownloading')
    : cfPhase === 'starting'
      ? t('cfStarting')
      : cfBusy ? t('running') : t('stopped')
  const cfShowError = cfPhase !== 'downloading' && cfPhase !== 'starting' && (cf.missingBinary || cf.error)

  return h('div', { className: 'dsh-gw' },
    h('div', { className: 'dsh-gw-head' },
      h('h2', { className: 'dsh-gw-title' }, t('title')),
      h('p', { className: 'dsh-gw-intro' }, t('intro')),
    ),
    error ? h('p', { className: 'dsh-gw-error', role: 'alert' }, error) : null,

    h(Section, {
      title: t('lanTitle'),
      intro: t('lanIntro'),
      status: snap?.lanEnabled ? t('lanOn') : t('lanOff'),
      on: Boolean(snap?.lanEnabled),
      action: snap?.lanEnabled
        ? h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => void run(REMOTE_ENDPOINTS.lanSet, { enabled: false }) }, t('lanStop'))
        : h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => void run(REMOTE_ENDPOINTS.lanSet, { enabled: true }) }, t('lanStart')),
    },
      h('label', { className: 'dsh-gw-check' },
        h('input', {
          type: 'checkbox',
          checked: Boolean(snap?.lanPinRequired),
          disabled: busy,
          onChange: (event) => void run(REMOTE_ENDPOINTS.lanSet, { pinRequired: event.target.checked }),
        }),
        t('lanPinRequired'),
      ),
      snap?.lanPinRequired
        ? h(PinRow, {
          label: t('lanPin'),
          value: snap?.lanPin ?? '',
          t,
          disabled: busy,
          onSave: (pin) => void run(REMOTE_ENDPOINTS.pinSet, { which: 'lan', pin }, { hydrate: false, busy: false }),
          onRotate: () => void run(REMOTE_ENDPOINTS.pinRotate, { which: 'lan' }, { hydrate: false, busy: false }),
        })
        : null,
      snap?.lanEnabled
        ? (lanUrls.length === 0
          ? h('p', { className: 'dsh-gw-muted' }, t('noLan'))
          : h('div', { className: 'dsh-gw-urls' }, lanUrls.map((item) => h(UrlCard, { key: item.ip, item, t }))))
        : null,
    ),

    h(Section, {
      title: t('publicTitle'),
      intro: t('publicIntro'),
    },
      h(PinRow, {
        label: t('publicPin'),
        value: snap?.publicPin ?? '',
        t,
        disabled: busy,
        onSave: (pin) => void run(REMOTE_ENDPOINTS.pinSet, { which: 'public', pin }, { hydrate: false, busy: false }),
        onRotate: () => void run(REMOTE_ENDPOINTS.pinRotate, { which: 'public' }, { hydrate: false, busy: false }),
      }),

      h(Section, {
        className: 'dsh-gw-sub',
        title: t('cfTitle'),
        intro: t('cfIntro'),
        status: cfStatus,
        on: cfBusy,
        action: cfBusy
          ? h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => void run(REMOTE_ENDPOINTS.cloudflareStop, {}) }, t('cfStop'))
          : h(Button, {
            variant: 'primary',
            size: 'sm',
            disabled: busy,
            onClick: () => { void beginStart('cloudflare') },
          }, t('cfStart')),
      },
        h('div', { className: 'dsh-gw-form' },
          h(Field, { label: t('cfMode') },
            h('select', {
              className: 'dsh-gw-select',
              value: cf.mode ?? 'quick',
              disabled: busy || cfBusy,
              onChange: (event) => void run(REMOTE_ENDPOINTS.cloudflareSet, { mode: event.target.value }),
            },
              h('option', { value: 'quick' }, t('cfQuick')),
              h('option', { value: 'named' }, t('cfNamed')),
            ),
          ),
          cf.mode === 'named'
            ? h(Field, { label: t('cfToken'), className: 'dsh-gw-span' },
              h('input', {
                className: 'dsh-gw-input',
                type: 'password',
                value: cfToken,
                disabled: busy || cfBusy,
                autoComplete: 'off',
                spellCheck: false,
                onChange: (event) => setCfToken(event.target.value),
                onBlur: () => { void persistCfDraft({ busy: false }) },
              }),
            )
            : null,
        ),
        cfPhase === 'downloading'
          ? h(DownloadProgress, {
            received: Number(cf.downloadReceived) || 0,
            total: Number(cf.downloadTotal) || 0,
            t,
          })
          : null,
        cf.url ? h(UrlCard, { item: { url: cf.url, qr: cf.qr }, t }) : null,
        cfShowError
          ? h('p', { className: 'dsh-gw-error' }, cf.missingBinary ? t('cfMissing') : cf.error)
          : null,
      ),

      h(Section, {
        className: 'dsh-gw-sub',
        title: t('sshTitle'),
        intro: t('sshIntro'),
        status: ssh.running ? t('running') : t('stopped'),
        on: Boolean(ssh.running),
        action: ssh.running
          ? h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => void run(REMOTE_ENDPOINTS.sshStop, {}) }, t('sshStop'))
          : h(Button, {
            variant: 'primary',
            size: 'sm',
            disabled: busy,
            onClick: () => { void beginStart('ssh') },
          }, t('sshStart')),
      },
        h('div', { className: 'dsh-gw-form' },
          h(Field, { label: t('sshHost'), className: 'dsh-gw-span' },
            h('input', {
              className: 'dsh-gw-input',
              value: sshHost,
              disabled: busy || ssh.running,
              spellCheck: false,
              autoComplete: 'off',
              placeholder: '203.0.113.10',
              onChange: (event) => setSshHost(event.target.value),
              onBlur: () => { void persistSshDraft({ busy: false }) },
            }),
          ),
          h(Field, { label: t('sshUser') },
            h('input', {
              className: 'dsh-gw-input',
              value: sshUser,
              disabled: busy || ssh.running,
              spellCheck: false,
              autoComplete: 'username',
              placeholder: 'root',
              onChange: (event) => setSshUser(event.target.value),
              onBlur: () => { void persistSshDraft({ busy: false }) },
            }),
          ),
          h(Field, { label: t('sshPassword') },
            h('input', {
              className: 'dsh-gw-input',
              type: 'password',
              value: sshPassword,
              disabled: busy || ssh.running,
              autoComplete: 'off',
              onChange: (event) => setSshPassword(event.target.value),
              onBlur: () => { void persistSshDraft({ busy: false }) },
            }),
          ),
          h(Field, { label: t('sshLoginPort') },
            h('input', {
              className: 'dsh-gw-input',
              value: sshLoginPort,
              disabled: busy || ssh.running,
              inputMode: 'numeric',
              placeholder: '22',
              onChange: (event) => setSshLoginPort(event.target.value),
              onBlur: () => { void persistSshDraft({ busy: false }) },
            }),
          ),
          h(Field, { label: t('sshIdentity') },
            h('input', {
              className: 'dsh-gw-input',
              value: sshIdentity,
              disabled: busy || ssh.running,
              spellCheck: false,
              onChange: (event) => setSshIdentity(event.target.value),
              onBlur: () => { void persistSshDraft({ busy: false }) },
            }),
          ),
          h(Field, { label: t('sshForwardPort'), className: 'dsh-gw-span' },
            h('input', {
              className: 'dsh-gw-input',
              value: sshPort,
              disabled: busy || ssh.running,
              inputMode: 'numeric',
              onChange: (event) => setSshPort(event.target.value),
              onBlur: () => { void persistSshDraft({ busy: false }) },
            }),
          ),
        ),
        ssh.hintUrl ? h(UrlCard, { item: { url: ssh.hintUrl, qr: ssh.qr }, t }) : null,
        ssh.error
          ? h('p', { className: 'dsh-gw-error' }, sshErrorText(ssh.error, t))
          : null,
      ),
    ),

    h(RiskConfirmation, {
      open: pending !== null,
      title: t('startTitle'),
      description: pending === 'ssh' ? t('startSshDescription') : t('startCfDescription'),
      acknowledgeLabel: t('acknowledge'),
      cancelLabel: t('cancel'),
      confirmLabel: t('confirm'),
      acknowledged,
      disabled: busy,
      onAcknowledgedChange: setAcknowledged,
      onCancel: () => {
        if (busy) return
        setPending(null)
        setAcknowledged(false)
      },
      onConfirm: () => { void confirmStart() },
    }),
  )
}
