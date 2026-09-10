/**
 * 3090 → dsh web hop: rewrite request headers so upstream sees 127.0.0.1.
 * The index HTML response is also rewritten here (still on the proxy hop) so
 * the in-browser client matches that hop. This is not a Cordis extension of
 * other plugins; they are not asked to cooperate.
 */

/**
 * @param {number} dshPort
 */
export function loopbackOrigin(dshPort) {
  return `http://127.0.0.1:${dshPort}`
}

export const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
])

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {number} dshPort
 * @param {{ passthroughEncoding?: boolean }} [options]
 * @returns {import('node:http').OutgoingHttpHeaders}
 */
export function rewriteUpstreamHeaders(headers, dshPort, options = {}) {
  const origin = loopbackOrigin(dshPort)
  const authority = `127.0.0.1:${dshPort}`
  const passthroughEncoding = options.passthroughEncoding !== false
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const next = {}
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase()
    if (HOP_BY_HOP.has(name)) continue
    if (name === 'host' || name === 'origin' || name === 'referer' || name === 'sec-fetch-site') continue
    if (name === 'accept-encoding' && !passthroughEncoding) continue
    next[name] = value
  }
  next.host = authority
  next.origin = origin
  next['sec-fetch-site'] = 'same-origin'
  const referer = headers.referer ?? headers.Referer
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const url = new URL(referer)
      next.referer = `${origin}${url.pathname}${url.search}`
    } catch {
      next.referer = `${origin}/`
    }
  }
  return next
}

/**
 * WebSocket upgrade to loopback dsh web. `connection` must be the string
 * `Upgrade`; an array copied from IncomingMessage makes Node skip the handshake.
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {number} dshPort
 */
export function rewriteUpgradeHeaders(headers, dshPort) {
  const next = rewriteUpstreamHeaders(headers, dshPort)
  next.connection = 'Upgrade'
  next.upgrade = typeof headers.upgrade === 'string' ? headers.upgrade : 'websocket'
  return next
}

/**
 * Drop hop-by-hop headers from an upstream IncomingMessage before writeHead.
 * Node already dechunks the body; forwarding `transfer-encoding: chunked` makes
 * browsers parse an empty document (blank page over SSH/LAN raw TCP).
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {{ dropContentLength?: boolean }} [options]
 * @returns {import('node:http').OutgoingHttpHeaders}
 */
export function sanitizeDownstreamHeaders(headers, options = {}) {
  /** @type {import('node:http').OutgoingHttpHeaders} */
  const next = {}
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue
    if (options.dropContentLength && key.toLowerCase() === 'content-length') continue
    if (key.toLowerCase() === 'content-encoding' && options.dropContentLength) continue
    next[key] = value
  }
  return next
}

const PATCH_MARKER = 'data-dsh-remote-access-proxy'

/**
 * Align the browser client with the already-loopback 3090 → dsh hop.
 * `location.hostname` on a phone is still the LAN/public name; Connection
 * would otherwise skip local sessions. Runs only in the proxied document.
 * @returns {string}
 */
export function htmlProxyScript() {
  return `<script ${PATCH_MARKER}>
(function () {
  try {
    var c = globalThis.crypto;
    if (c && typeof c.randomUUID !== 'function' && typeof c.getRandomValues === 'function') {
      c.randomUUID = function () {
        var b = new Uint8Array(16);
        c.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        var hex = Array.from(b, function (n) { return n.toString(16).padStart(2, '0'); }).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
      };
    }
  } catch (e) {}
  try {
    if (globalThis.AbortSignal && typeof AbortSignal.any !== 'function') {
      AbortSignal.any = function (signals) {
        var controller = new AbortController();
        var list = Array.from(signals || []);
        var finished = false;
        function abortFrom(signal) {
          if (finished) return;
          finished = true;
          try { controller.abort(signal.reason); } catch (err) { controller.abort(); }
        }
        for (var i = 0; i < list.length; i++) {
          var signal = list[i];
          if (signal.aborted) { abortFrom(signal); return controller.signal; }
          signal.addEventListener('abort', function () { abortFrom(signal); }, { once: true });
        }
        return controller.signal;
      };
    }
  } catch (e) {}
  function wrapFactory(handle) {
    if (!handle || typeof handle.factory !== 'function') return;
    var originalFactory = handle.factory;
    handle.factory = function (require) {
      var exported = originalFactory.apply(this, arguments);
      if (exported && typeof exported.apply === 'function') {
        var originalApply = exported.apply;
        exported.apply = function (ctx) {
          if (ctx && typeof ctx.provide === 'function') {
            var originalProvide = ctx.provide;
            ctx.provide = function (name, value) {
              if (name === 'connection' && value && typeof value === 'object') {
                try { Object.defineProperty(value, 'isLoopback', { value: true, configurable: true, writable: true }); }
                catch (err) { value.isLoopback = true; }
              }
              return originalProvide.apply(this, arguments);
            };
          }
          return originalApply.apply(this, arguments);
        };
      }
      return exported;
    };
  }
  function wrapLoad(fn) {
    return function (handle) {
      if (handle && handle.id && String(handle.id).indexOf('connection') !== -1) wrapFactory(handle);
      return fn.call(this, handle);
    };
  }
  function wrapLoader(loader) {
    if (!loader || loader.__dshRemoteAccessProxy) return loader;
    var current = wrapLoad(loader.load.bind(loader));
    try {
      Object.defineProperty(loader, 'load', {
        configurable: true,
        get: function () { return current; },
        set: function (fn) { current = wrapLoad(fn); }
      });
    } catch (err) {
      loader.load = current;
    }
    loader.__dshRemoteAccessProxy = true;
    return loader;
  }
  if (globalThis.__ModuleLoader__) wrapLoader(globalThis.__ModuleLoader__);
  else {
    var held;
    Object.defineProperty(globalThis, '__ModuleLoader__', {
      configurable: true,
      enumerable: true,
      get: function () { return held; },
      set: function (value) { held = wrapLoader(value); }
    });
  }
})();
</script>`
}

/**
 * @param {string} html
 */
export function rewriteHtmlDocument(html) {
  if (html.includes(PATCH_MARKER)) return html
  const script = htmlProxyScript()
  const head = html.match(/<head[^>]*>/i)
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length
    return html.slice(0, at) + script + html.slice(at)
  }
  return script + html
}

/**
 * @param {string} path
 * @param {import('node:http').IncomingHttpHeaders} headers
 */
export function isHtmlDocument(path, headers) {
  const accept = String(headers.accept ?? '')
  if (path !== '/' && path !== '/index.html') {
    return false
  }
  return accept.includes('text/html') || accept === '' || accept === '*/*'
}
