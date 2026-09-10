# Phase 4 residual — versioned pack URL

更新：2026-09-10（`feat/versioned-pack-url`；`fix/deploy-allow-pack-hardlinks`）

## 目标（行为不变）

1. 发版时生成 **`data/stocks_data.<datasetSha>.json`**（`datasetSha` = 文件内容 sha256，与 API `datasetVersion` 一致）。
2. 客户端经 **`data/pack-meta.json`** 发现 sha / URL；IndexedDB 键 = sha。
3. nginx 对版本化 pack 使用 **immutable 长缓存**；保留 `gzip_static` / `brotli_static`。
4. **保留** 未版本化 `data/stocks_data.json`（及 `.js`）作旧客户端 / 本地回落。

**刻意不做**：紧凑 pack 编码、常驻 worker 窗口化、无整包云开局。

## 为什么

| 问题 | 改前 | 改后 |
|------|------|------|
| ~55MB 行情包无法长缓存 | 依赖 HEAD ETag + 短/中缓存 | 文件名含 sha → `Cache-Control: immutable` 一年 |
| 发版后旧包滞留 | 仅靠 ETag 校验 | `pack-meta.json`（no-store）指向新 sha；旧 URL 仍可用但不被新客户端请求 |
| 云局数据版本 | 服务端已用 sha256 作 `datasetVersion` | 静态 `datasetSha` 与之对齐，便于对账 |

## 改动面

| 路径 | 作用 |
|------|------|
| `deploy/emit-versioned-pack.mjs` | 发版树内 hardlink 版本化文件 + 写 `pack-meta.json` + 写入 `version.json` |
| `deploy/package-production.sh` | stamp 后调用 emit，再 precompress |
| `deploy/precompress-assets.mjs` | 同 inode hardlink 复用 `.gz`/`.br`，避免对双胞胎 pack 双倍 brotli |
| `deploy/nginx-stockgame.xieyw.top.conf` | 版本化 pack 1y immutable；`pack-meta` no-store；未版本化 1h |
| `js/pack-url.js` | sha / URL / IDB key / meta 规范化纯函数 |
| `js/pack-store.js` | 先拉 meta → 版本化 URL；IDB key = sha；无 meta 时回落旧路径 |
| `docs/phase4-versioned-pack.md` | 本文件 |

源码树 **不** 提交 `stocks_data.<sha>.json` / `pack-meta.json`（仅 release 打包产出）。本地直接打开站点时仍走 `stocks_data.json`。

## 服务端对齐

`server/src/lib/dataset.js` 已对行情文件做 `sha256` 作为 `datasetVersion`。

- 静态包 `pack-meta.datasetSha` **必须** 等于 API `/api/v1/config` 的 `datasetVersion`（同一份 `stocks_data.json` 字节）。
- API 仍可读未版本化路径（或指向同一 inode 的版本化文件）；**无需** 为本 PR 改选股/结算逻辑。
- 若 VPS 上 API 数据目录与静态 `current/data` 不是同一文件，发版时需保证两边字节一致，否则云局与本地练习题库会漂移（既有风险，本轮用同一 sha 命名让不一致更易发现）。

## 部署说明

| 层 | 动作 |
|----|------|
| **静态** | merge → Actions `package-production` 自动产出版本化文件 + `.gz`/`.br` + `pack-meta.json` |
| **nginx** | **需运维合并 conf**：版本化 location + `pack-meta` no-store；`nginx -t && reload`。不 reload 则版本化文件仍可下载，但可能吃到通用 `expires 7d` 而非 immutable |
| **API** | 一般 **不必** redeploy；只要 API 读的数据集文件与静态包同一内容即可 |


### Deploy / nginx 同步（server 29）

- **`deploy/deploy-release.sh`**：解包校验允许 `member.islnk()`（hardlink）。版本化 pack 与未版本化 twin 以及共享的 `.br`/`.gz` 用 hardlink 省空间；仍拒绝 symlink 与特殊文件。
- **`deploy/nginx-stockgame.xieyw.top.conf`**：版本化 pack 的 `location ~*` 正则需加引号（`"...{64}..."`），否则 nginx 把 `{64}` 当成配置块。

验收：

```bash
# 包内
tar -tzf release/production/stock-website-<sha>.tar.gz | grep -E 'stocks_data\.[a-f0-9]{64}\.json|pack-meta'
# 线上
curl -s https://stockgame.xieyw.top/data/pack-meta.json
curl -sI https://stockgame.xieyw.top/data/stocks_data.<datasetSha>.json | tr -d '\r' | grep -iE 'cache-control|content-encoding'
curl -s https://stockgame.xieyw.top/api/v1/config  # datasetVersion 应等于 pack-meta.datasetSha
```

## 回滚

- 静态：切回旧 release；旧客户端本就不依赖 `pack-meta`。
- 新客户端若拿到新 HTML/JS 但旧静态无 `pack-meta`：自动回落 `stocks_data.json`（行为同改前）。
- nginx：去掉版本化 location 即可；无害残留文件可留在盘上。

## 残余风险

- 旧标签页握着无 `pack-meta` 逻辑的旧 `pack-store.js` 时仍走未版本化路径（预期）。
- IDB 会按 sha 累积历史条目；体积通常可接受，未做自动 GC。
- 未实现 compact encoding / resident worker windowing。
