import { createElement as h, useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

const PIN_PATTERN = /^[A-Za-z0-9]{10}$/

/**
 * @param {(key: string) => string} t
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function fmt(t, key, vars) {
  let text = t(key)
  if (!vars) return text
  for (const [name, value] of Object.entries(vars)) {
    text = text.split(`{${name}}`).join(String(value))
  }
  return text
}

/**
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function sshErrorText(error, t) {
  if (error === 'unreachable') return t('sshUnreachable')
  if (error === 'gatewayports') return t('sshGatewayPorts')
  if (error === 'tcpforwarding') return t('sshTcpForwarding')
  return error
}

export function Field({ label, className, children }) {
  return h('label', { className: className ? `dsh-gw-field ${className}` : 'dsh-gw-field' },
    h('span', { className: 'dsh-gw-label' }, label),
    children,
  )
}

export function PinRow({ label, value, t, disabled, onSave, onRotate }) {
  const [draft, setDraft] = useState(value)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    setDraft(value)
  }, [value])
  const dirty = draft !== value
  const invalid = dirty && !PIN_PATTERN.test(draft)
  const save = () => {
    if (!PIN_PATTERN.test(draft)) return
    onSave(draft)
  }
  return h('div', { className: 'dsh-gw-field' },
    h('span', { className: 'dsh-gw-label' }, label),
    h('div', { className: 'dsh-gw-pin' },
      h('input', {
        className: invalid ? 'dsh-gw-input is-invalid' : 'dsh-gw-input',
        value: draft,
        spellCheck: false,
        autoComplete: 'off',
        maxLength: 10,
        inputMode: 'text',
        'aria-invalid': invalid,
        onChange: (event) => {
          setDraft(event.target.value.trim())
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') save()
        },
      }),
      h(Button, {
        variant: 'outline',
        size: 'sm',
        disabled: !dirty || invalid,
        onClick: save,
      }, t('savePin')),
      h(Button, { variant: 'ghost', size: 'sm', disabled, onClick: onRotate }, t('rotate')),
      h(Button, {
        variant: 'ghost',
        size: 'sm',
        disabled,
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            setCopied(false)
          }
        },
      }, copied ? t('copied') : t('copy')),
    ),
    invalid ? h('p', { className: 'dsh-gw-error' }, t('pinInvalid')) : null,
  )
}

export function UrlCard({ item, t }) {
  const [copied, setCopied] = useState(false)
  return h('div', { className: 'dsh-gw-card' },
    item.qr ? h('img', { className: 'dsh-gw-qr', src: item.qr, alt: t('scanQr'), width: 120, height: 120 }) : null,
    h('div', { className: 'dsh-gw-urlmeta' },
      h('div', { className: 'dsh-gw-url' }, item.url),
      h(Button, {
        variant: 'outline',
        size: 'sm',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(item.url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            setCopied(false)
          }
        },
      }, copied ? t('copied') : t('copy')),
    ),
  )
}

export function Section({ title, intro, status, on, action, className, children }) {
  return h('section', { className: className ?? 'dsh-gw-block' },
    h('div', { className: 'dsh-gw-block-head' },
      h('div', { className: 'dsh-gw-block-title' },
        title ? h('h3', { className: 'dsh-gw-h' }, title) : null,
        intro ? h('p', { className: 'dsh-gw-intro' }, intro) : null,
      ),
      h('div', { className: 'dsh-gw-actions' },
        status != null
          ? h('span', { className: on ? 'dsh-gw-pill is-on' : 'dsh-gw-pill' }, status)
          : null,
        action ?? null,
      ),
    ),
    children,
  )
}

export function DownloadProgress({ received, total, t }) {
  const known = Number.isFinite(total) && total > 0
  const percent = known ? Math.min(100, Math.round((received / total) * 100)) : 0
  const label = known
    ? fmt(t, 'cfDownloadKnown', {
      received: formatBytes(received),
      total: formatBytes(total),
      percent,
    })
    : fmt(t, 'cfDownloadBytes', { received: formatBytes(received) })
  return h('div', {
    className: 'dsh-gw-progress',
    role: 'progressbar',
    'aria-label': t('cfDownloading'),
    'aria-valuemin': 0,
    'aria-valuemax': known ? 100 : undefined,
    'aria-valuenow': known ? percent : undefined,
  },
    h('div', { className: 'dsh-gw-progress-track' },
      h('div', {
        className: known ? 'dsh-gw-progress-fill' : 'dsh-gw-progress-fill is-indeterminate',
        style: known ? { width: `${percent}%` } : undefined,
      }),
    ),
    h('p', { className: 'dsh-gw-muted' }, label),
  )
}
