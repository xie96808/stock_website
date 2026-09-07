# Stage 6 自测报告（发布／备份／回滚）

日期：2026-09-08（Asia/Shanghai）

## 交付摘要

- SQLite 在线一致性备份：server/src/lib/backup.js（better-sqlite3 Online Backup API）
- CLI：server 包 db:backup / db:restore-check / db:restore；admin:create 别名
- 完整性：integrity_check、foreign_key_check、meta/sha256、backup-status.json
- 保留与 prune：见 deploy/README-ops-stage6.md
- 打包白名单：deploy/verify-package-whitelist.sh（接入 static/api 打包）
- 回滚：静态 rollback-release.sh；API rollback-api.sh
- ready 与 admin overview 暴露备份年龄；运维开关 REGISTRATION / CLOUD_GAMES / LEADERBOARD
- 管理后台非公网姿态文档交叉引用

## 自动化

- server tests（含 Stage6 backup/ops-flags）：44/44 通过
- Playwright 网页烟雾（127.0.0.1:8787）：16/16 通过
- 静态/API 打包 whitelist：WHITELIST_OK
- backup / restore-check；无允许开关时 restore 拒绝：通过

## 网页 HARD GATE 清单

- Home Scheme A：3 入口；模拟盘 hub 显隐；回首页 — PASS
- 知识馆进入/返回 — PASS
- 悔棋局进入/返回 — PASS
- 注册 / 登录 / 退出 / 设置（昵称、头像、参榜） — PASS
- 开始游戏 → 成交方式 → 若干步 hold → 返回 — PASS
- 我的战绩 — PASS
- 排行榜双模式 — PASS
- Cross：hub → LB → 回 hub — PASS
- Cross：知识馆 → 模拟盘 — PASS
- Cross：hub 上打开账号设置 — PASS
- Cross：登录 → hub → 退出 — PASS

## 残余风险

- 生产机尚未做真实异机恢复计时演练（RPO/RTO 承诺需首次演练后生效）
- rollback-api.sh 不自动安装依赖；依赖变更时需按 README 手工安装
- 根 package.json 未新增 db 别名（server 包脚本已齐）
- Playwright 未完整跑完 30 日结算 UI（hold 若干步 + 既有 games 集成测试覆盖结算）
