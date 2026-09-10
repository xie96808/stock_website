# Phase 4 — cheap perf (brotli + cache-bust)

更新：2026-09-10（`feat/phase4-cheap-perf`）

## 目标（行为不变）

1. **Brotli / 预压缩 `.br`**：打包时为 js / css / html / json / svg / txt 生成 `.br`，保留既有 `.gz`；nginx 开启 `brotli_static`（及动态 `brotli` 回落），`gzip_static` 不变。
2. **js/css cache-bust**：发布包内把本地 script/link / ESM `import` / CSS `@import` / worker `new URL(...)` 打上 `?v=<revision前12位>`，避免 7 天强缓存导致发版后仍用旧模块。

**刻意不做（留给后续 PR）**：按 `datasetSha` 版本化 pack URL + 长缓存；紧凑 pack 编码；常驻 worker 窗口化；无整包云开局等。

## 为什么

| 问题 | 现状 | 本轮 |
|------|------|------|
| 行情包 ~55MB，gzip ~12MB | 仅 gzip / gzip_static | 额外 `.br`；支持 br 的客户端通常更小 |
| `expires 7d` 无 fingerprint | `index.html` 入口与深层 `./foo.js` 相对导入都不带版本 | 打包时整图 stamp `?v=` |
| 运维 | VPS nginx 未开 brotli | 仓库 conf 已写；**需 VPS 装模块后 reload** |

## 改动面

| 路径 | 作用 |
|------|------|
| `deploy/precompress-assets.mjs` | Node zlib 生成 `.gz` + `.br`（大文件 brotli q5，小文件 q11） |
| `deploy/stamp-asset-revision.mjs` | 仅改 **release 树** 内引用；源码工作区不打戳 |
| `deploy/package-production.sh` | copy → stamp → write version.json → precompress → tar |
| `deploy/nginx-stockgame.xieyw.top.conf` | `brotli` / `brotli_static` + `must-revalidate` |
| 本文件 | 回滚与验收 |

源码 `index.html` / `js/*` **不**含 `?v=`；本地直接打开或未走打包脚本时行为与改前一致。

## 残余陈旧风险

- **未 stamp 的引用**：pack URL（`data/stocks_data.json`）仍无 `?v=`（已 defer）；`pack-store` 用 HEAD / IDB 校验，不依赖 7 天静态缓存策略。
- **用户钉住的旧 HTML 标签页**：若标签页在发版前打开且未刷新，仍可能握着旧入口；刷新 `index.html`（默认无长缓存）即拿到新 `?v=`。
- **动态拼接路径**：若将来有字符串拼出来的模块路径且未被正则扫到，可能漏戳；当前仓库为静态 `from './x.js'` / `import("./x.js")` / `new URL('./w.js', import.meta.url)`。
- **无 brotli 模块的 nginx**：`nginx -t` 会因 `brotli*` 指令失败——见下方 VPS 步骤；可临时注释 brotli 行，仅靠 gzip_static。

## VPS nginx 应用步骤（Aliyun 121.199.33.29）

静态内容由 GitHub Actions 在 merge 到 `main` 后自动打包上传；**nginx 配置不会随静态包自动覆盖**。发版后若要启用 brotli：

1. 确认已安装 ngx_brotli（名称因发行版而异），例如 Debian/Ubuntu 包或自编译 `ngx_http_brotli_filter_module` + `ngx_http_brotli_static_module`，并在主配置 `load_module`（若为动态模块）。
2. 将仓库 `deploy/nginx-stockgame.xieyw.top.conf` 中的 **gzip + brotli + location** 段合并进线上 **443** Certbot server（不要用仓库里仅 HTTP 的整文件直接覆盖 TLS server）。
3. `sudo nginx -t && sudo systemctl reload nginx`
4. 验收：
   ```bash
   curl -sI -H 'Accept-Encoding: br' https://stockgame.xieyw.top/js/game.js | tr -d '\r' | grep -iE 'content-encoding|cache-control'
   curl -sI -H 'Accept-Encoding: gzip' https://stockgame.xieyw.top/data/stocks_data.json | tr -d '\r' | grep -i content-encoding
   curl -s https://stockgame.xieyw.top/version.json
   ```
   期望：js 可出现 `content-encoding: br`（或 gzip 回落）；`version.json` 的 `revision` 与刚发布 SHA 一致；HTML 内 css/js 链接含 `?v=`。

若暂时不装 brotli 模块：注释 conf 内 `brotli*` 四行后 reload；Actions 仍会上传 `.br` 文件，只是 nginx 不提供，无害。

## 回滚

- **静态**：`rollback-release.sh` / 既有 Stage6 回滚切 `current` 软链并 reload nginx → 回到无 stamp / 无 `.br` 的旧包亦可（旧包无 `.br` 时 brotli_static 自然 miss）。
- **nginx**：去掉 `brotli*` 行或恢复旧 conf 后 `nginx -t && reload`。
- **代码**：revert 本 PR；下一次 Actions 打包装回旧逻辑。

## 验收清单

- [ ] `npm test` 全绿（不依赖 stamp；测源码树）
- [ ] 本地试打包：`OUTPUT_DIR=/tmp/sw-rel bash deploy/package-production.sh "$(git rev-parse HEAD)"`
  - [ ] 包内存在 `data/stocks_data.json.br` 与 `.gz`
  - [ ] 包内 `index.html` 的 `css/style.css?v=` 与 inline `from './js/....js?v='`
  - [ ] 包内 `js/game.js` 含 `from '../shared/engine.js?v='`
  - [ ] 包内 `css/style.css` 的 `@import` 带 `?v=`
  - [ ] `version.json` revision 匹配
- [ ] PR merge 后 Actions 静态部署成功
- [ ]（可选，运维）VPS 启用 brotli 后 `Accept-Encoding: br` 命中

## 与 first-start-perf 的关系

`docs/first-start-perf.md` 已记录「brotli 未开」为残余瓶颈。本轮补上**打包侧预压缩 + conf 模板**；真正线上 br 仍依赖 VPS 模块。版本化 pack URL 仍 defer。
