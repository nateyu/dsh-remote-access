# @neil-yu/dsh-remote-access

English | [中文](README.zh.md)

A DeepSeek Harness settings plugin. After LAN, Cloudflare, or SSH is started, this machine listens on `listenPort` (default `3090`) and reverse-proxies HTTP and WebSocket onto loopback `dsh web`. The three entries share that port and it is not listened on while all are off. A remote entry is host-equivalent; public access requires the 10-character PIN.

`dsh web` itself stays bound to loopback. The 3090 hop talks to `dsh web` as `127.0.0.1:<dsh-port>`, rewrites Host/Origin/Referer and loopback `Location` headers, and completes the launch-token cookie exchange so a phone never needs the URL printed by `dsh web`. On the index document it sets Connection's documented `__DSH_TRANSPORT__.ownsHost` flag so Host settings (models, plugin config) stay host-backed: the browser hostname is still the LAN or public name. This plugin's settings UI uses the public slots / locale / Connection RPC APIs.

The settings nav label follows the product locale: 「远程访问」 in Chinese, “Remote access” in English. LAN, Cloudflare, and SSH URLs each get a QR code on that page.

State is a single file, `$DSH_HOME/storages/dsh-remote-access.json` (mode `0600`). `dsh plugin remove` runs `preuninstall` and deletes that file, plus leftover `$DSH_HOME/dsh-gateway/` and `$DSH_HOME/storages/dsh-remote-proxyy.json` from earlier names. The `storages` directory is left in place.

## Install

```sh
dsh plugin --profile web add @neil-yu/dsh-remote-access
```

From a local checkout:

```sh
dsh plugin --profile web add /path/to/dsh-remote-access
```

Restart `dsh web`, then open Settings → Remote access.

Optional plugin config in the web profile:

```yaml
- id: dsh-remote-access
  name: '@neil-yu/dsh-remote-access'
  config:
    listenPort: 3090
    listenHost: 0.0.0.0
    cloudflaredPath: ''   # empty → PATH, then this package's bin/, then download
```

## Usage

### LAN

Turn on Start. Scan the QR code or open a listed `http://<lan-ip>:3090` URL on another device on the same network. LAN PIN is off by default. The machine does not listen on that port while every entry is off.

### Cloudflare

`cloudflared` is **not** shipped in the npm tarball (20MB+ per OS). The first “Start public access” downloads the current GitHub release into **this package’s** `bin/` directory (`node_modules/@neil-yu/dsh-remote-access/bin/cloudflared`). That path is not under `$DSH_HOME`. An executable already on `PATH`, Homebrew’s usual bins, or `cloudflaredPath` is used instead and no download runs.

- Quick tunnel: Start public access. Cloudflare prints a `*.trycloudflare.com` URL (QR on the settings page). The public PIN is required.
- Named tunnel: paste a tunnel token from Zero Trust. Point that tunnel’s ingress at `http://127.0.0.1:3090` (or your `listenPort`).

### SSH reverse forward

Fill `user@vps`, the SSH login port (default 22; use 2222 or any sshd port), and the remote access port, plus a private key path or a password. Start forward. The plugin opens an SSH2 session from Node and reverse-forwards:

```text
VPS 0.0.0.0:<remotePort>  →  127.0.0.1:<listenPort>
```

Same as `ssh -R 0.0.0.0:<remotePort>:127.0.0.1:<listenPort>`. Reaching that port from the public internet or LAN needs remote sshd `AllowTcpForwarding yes` and `GatewayPorts clientspecified` (or `yes`). With the default `GatewayPorts no` the port binds `127.0.0.1` only; the page shows that hint and drops the SSH session instead of marking it running. The plugin does not change remote sshd. OpenSSH does not have to be installed on this machine. LAN, Cloudflare, and SSH share that one local `listenPort` and can run together. Public PIN is required when the Host is not private.

## Security

A remote session is the same as sitting at this machine: the visitor can run the local agent **and** open Settings → Remote access (read PINs, start or stop LAN / Cloudflare / SSH). The shared `listenPort` hop rewrites Host/Origin to loopback and completes `dsh web`'s launch-token cookie exchange, so a phone never needs the URL printed by `dsh web`. Public Hosts always require the 10-character PIN. Starting Cloudflare or SSH asks for confirmation. Login guesses are rate-limited per client IP (`cf-connecting-ip` on Cloudflare, otherwise the TCP peer). Do not put this listener on an untrusted network without the PIN.

## Develop

```sh
npm install
npm test
```

`npm install` builds the browser bundle (`client/client.js`). After changing files under `client/`, run `npm run build:client` and refresh `dsh web`.

## Uninstall

```sh
dsh plugin --profile web remove @neil-yu/dsh-remote-access
```

Restart `dsh web`. The `preuninstall` script removes `$DSH_HOME/storages/dsh-remote-access.json`. Removing the npm package also deletes `bin/cloudflared`. If `DSH_HOME` is set only for `dsh web`, export the same value when removing the plugin.

## Limits

- Control RPCs use Connection's JSON envelope on a dedicated prefix mounted on this plugin's `webServer`. LAN, Cloudflare, and SSH all reverse-proxy through `listenPort`. That hop rewrites Host/Origin to loopback, completes the launch-token cookie exchange, and sets `ownsHost` on the index document.
- Named-tunnel DNS and ingress are configured in Cloudflare, not here.
- `dsh web` itself stays on loopback. Opening `0.0.0.0` on the Harness server is still unsupported.
