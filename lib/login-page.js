/**
 * @param {{ kind: 'lan' | 'public', failed?: boolean, locked?: boolean, retryAfter?: number }} options
 */
export function loginPageHtml(options) {
  const title = options.kind === 'public' ? 'Remote access' : 'LAN access'
  const hint = options.kind === 'public'
    ? 'Enter the public PIN from Settings → Remote access. It must be exactly 10 letters or digits (A–Z, a–z, 0–9).'
    : 'Enter the LAN PIN from Settings → Remote access. It must be exactly 10 letters or digits (A–Z, a–z, 0–9).'
  const status = options.locked
    ? `Too many attempts. Try again in ${options.retryAfter ?? 60}s.`
    : options.failed
      ? 'That PIN did not match.'
      : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f1115; color: #e8eaed; }
    form { width: min(360px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 12px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0; }
    p { margin: 0; color: #9aa3af; }
    input { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #3b4250; background: #1a1d24; color: inherit; }
    input:user-invalid { border-color: #f87171; box-shadow: 0 0 0 1px #f87171; }
    button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 0; background: #3b82f6; color: #fff; cursor: pointer; }
    .err { color: #f87171; min-height: 1.2em; }
  </style>
</head>
<body>
    <form method="post" action="/_remote/login" autocomplete="off">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(hint)}</p>
    <input name="pin" type="password" inputmode="text" maxlength="10" minlength="10" pattern="[A-Za-z0-9]{10}" required autofocus spellcheck="false" autocomplete="off">
    <button type="submit">Continue</button>
    <p class="err">${escapeHtml(status)}</p>
  </form>
</body>
</html>`
}

/**
 * @param {string} text
 */
function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

/**
 * @param {string} message
 */
export function deniedPageHtml(message) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remote access</title></head>
<body style="font:14px/1.5 sans-serif;padding:24px">${escapeHtml(message)}</body></html>`
}
