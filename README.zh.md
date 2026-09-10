# dsh-remote-access

[English](README.md) | 中文

开启局域网、Cloudflare 或 SSH 后，本机在 `listenPort`（默认 `3090`）上监听，把 HTTP 和 WebSocket 转到回环上的 `dsh web`。三种入口共用该端口，全部关掉时不监听。远程入口等于本机权限，公网必须使用 10 位 PIN。

`dsh web` 本身仍只绑回环。流量改写都在 3090 这一跳：代理以 `127.0.0.1:<dsh-port>` 去连 `dsh web`，并改写首页 HTML，让浏览器里的客户端和这一跳一致（否则 `location.hostname` 仍是局域网/公网名，会话列表会是空的）。这不是其他插件能 hook 的 Cordis 扩展。本插件设置页只用公开的 slots / locale / Connection RPC。

设置导航随系统语言切换：中文「远程访问」，English “Remote access”。局域网、Cloudflare、SSH 的地址都会在该页生成二维码。

状态只写一个文件：`$DSH_HOME/storages/dsh-remote-access.json`（权限 `0600`）。`dsh plugin remove` 会跑 `preuninstall`，删掉该文件，以及旧名留下的 `$DSH_HOME/dsh-gateway/`。`storages` 目录本身保留。

## 安装

```sh
dsh plugin --profile web add dsh-remote-access
```

本地 checkout：

```sh
dsh plugin --profile web add /path/to/dsh-remote-access
```

重启 `dsh web`，打开设置 → 远程访问。

可选插件配置：

```yaml
- id: dsh-remote-access
  name: dsh-remote-access
  config:
    listenPort: 3090
    listenHost: 0.0.0.0
    cloudflaredPath: ''   # 空则走 PATH，再本包 bin/，再下载
```

## 使用

### 局域网

打开「开启」。扫描二维码，或在同一网络的其他设备上打开列出的 `http://<局域网IP>:3090`。局域网 PIN 默认关闭。三种入口都未开启时，本机不监听该端口。

### Cloudflare

npm 包里**不带** `cloudflared`（每个系统 20MB+）。`npm install` / `dsh plugin add` 会跑 `postinstall`，从 GitHub 下当前 release 到**本插件目录**的 `bin/`（`node_modules/dsh-remote-access/bin/cloudflared`），不写 `$DSH_HOME`。若安装时访问不了 GitHub，设置页第一次点「开启公网」时再下。PATH、Homebrew 常见目录、或 `cloudflaredPath` 里已有可执行文件则直接用，不再下载。

- 快速隧道：开启公网后会得到 `*.trycloudflare.com` 地址（设置页有二维码），必须使用公网 PIN。
- 命名隧道：粘贴 Zero Trust 里的 tunnel token。把该隧道的 ingress 指到 `http://127.0.0.1:3090`（或你配置的 `listenPort`）。

### SSH 反向转发

填写 `user@vps`、SSH 登录端口（默认 22，可改成 2222 等）和远程访问端口，再提供私钥路径或密码后开启。插件用 Node 内置的 SSH2 会话做反向转发：

```text
VPS 0.0.0.0:<远程端口>  →  127.0.0.1:<listenPort>
```

等同 `ssh -R 0.0.0.0:<远程端口>:127.0.0.1:<listenPort>`。公网或局域网要访问该端口，远程 sshd 需要 `AllowTcpForwarding yes`，且 `GatewayPorts clientspecified`（或 `yes`）。默认 `GatewayPorts no` 时端口只听在 `127.0.0.1`，页面会提示并断开这次 SSH，不会把状态标成开启。插件不改远程 sshd。不要求本机安装 OpenSSH。局域网、Cloudflare、SSH 共用本机这一个 `listenPort`，可以同时开启。Host 不是私网地址时必须使用公网 PIN。

## 安全

远程会话等于坐在这台机器前：访问者能跑本地 agent，**也能**打开设置 → 远程访问（读取 PIN、开关局域网 / Cloudflare / SSH）。三条入口都经共用的 `listenPort` 反代到 `dsh web`，并把 Host/Origin 改成 loopback，这样不必再给 `dsh web` 单独做一套信任路径。公网 Host 一律要 10 位 PIN。开启 Cloudflare 或 SSH 前会确认。登录猜测按客户端 IP 限速（Cloudflare 上用 `cf-connecting-ip`，否则用 TCP 对端）。不要在未开 PIN 的情况下把监听端口暴露到不信任的网络。

## 开发

```sh
npm install
npm test
```

`npm install` 会构建浏览器包（`client/client.js`）。改 `client/` 之后运行 `npm run build:client` 并刷新 `dsh web`。

## 卸载

```sh
dsh plugin --profile web remove dsh-remote-access
```

重启 `dsh web`。`preuninstall` 会删除 `$DSH_HOME/storages/dsh-remote-access.json`。卸掉 npm 包时 `bin/cloudflared` 会一并删掉。若只有跑 `dsh web` 时才设置 `DSH_HOME`，卸载时请导出同一个值。

## 限制

- 控制类 RPC 仍使用 Connection RPC 的 `authority: loopback`。局域网、Cloudflare、SSH 都经 `listenPort` 反代。这一跳会把请求改成 loopback，并改写首页 HTML 让浏览器客户端一致；不是其他插件能 hook 的 Cordis 扩展。
- 命名隧道的 DNS 与 ingress 在 Cloudflare 侧配置。
- `dsh web` 本身仍只绑回环。Harness 服务器上的 `0.0.0.0` 绑定仍然不受支持。
