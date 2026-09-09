# 阶段 6：备份、发布白名单与回滚（运维）

对应 docs/account-leaderboard-admin-v1.md 第 13 节。非新玩法。

## 1. SQLite 在线一致性备份

禁止对运行中的 WAL 库直接复制主文件。请使用 better-sqlite3 Online Backup API（见 server 包脚本 db:backup）。

成功输出 BACKUP_OK，并写入时间戳备份、.meta.json，以及 backup-status.json（供 health/ready 与 admin/overview 读取年龄）。

用 db:restore-check 做 integrity_check 与 foreign_key_check。保留：48 小时点、30 日点、最长 30 天；异机加密副本必需。RPO/RTO 目标各 1 小时。

## 2. 恢复路径

代码回滚不等于数据库恢复。仅数据灾难时停写、保全故障副本、人工批准。

流程：停止 API 服务 → 允许恢复开关后执行 db:restore → 旧库进入 restore-salvage → 撤销全部旧 session 并重放注销 tombstone → 再启动并检查 ready。

## 3. 发布打包白名单

静态包只收：index.html、css、js、data、images、shared、admin、version.json。
不得打入：.git、.env、SQLite、server/tests、私有日志、备份、node_modules。
API 包排除 node_modules、data、tests、.env（可保留 .env.example）。
打包后用 verify-package-whitelist.sh 扫描。

## 4. 回滚

静态：rollback-release.sh 切换 current 软链并 reload nginx。
API：保留上一版 api 包；停止服务后覆盖 api/ 与 shared/（见 rollback-api.sh）；依赖变化时在目标机安装生产依赖；不要盲目反向迁移库；启动后检查 ready、登录、建局。

## 5. 运维开关（环境变量，默认开启）

- REGISTRATION_ENABLED=0 → 注册 403 REGISTRATION_DISABLED
- CLOUD_GAMES_ENABLED=0 → 新建云局 403；已有局仍可 finish
- LEADERBOARD_ENABLED=0 → 榜单 403
- ADMIN_ENABLED 默认关闭（Stage 5）

特性位出现在 GET /api/v1/config 与 ready。更改需运维审计。

## 6. 管理后台非公网姿态

启用 ADMIN_ENABLED 前须 nginx IP 白名单或 VPN 限制 /admin/ 与 /api/v1/admin/。可选 ADMIN_IP_ALLOWLIST。写操作需二次密码验证。详见 README-api.md。

## 7. 健康检查

- health/live：存活
- health/ready：DB 与行情，附带 backup.ageSeconds
- admin/overview：用户、局数、开关、最近备份（管理员）

告警建议：备份年龄超过 2 小时；ready 连续失败；磁盘超过 80%。

## 8. Phase 0 launch hardening

### Rate limits (in-memory, single-process API)

Defaults (override via env; restart resets counters):

| Op | Default | Env knobs |
|---|---|---|
| Login failures | 5 / 15min per account+IP; 30 / 15min per IP | `RATE_LOGIN_FAIL_PER_ACCOUNT_IP`, `RATE_LOGIN_FAIL_PER_IP`, `RATE_LOGIN_FAIL_WINDOW_MS` |
| Register | 5 / hour / IP; 20 / day / IP | `RATE_REGISTER_PER_IP_HOUR`, `RATE_REGISTER_PER_IP_DAY`, `RATE_REGISTER_HOUR_MS`, `RATE_REGISTER_DAY_MS` |
| Create game | 10 / min / user; 100 / day / user | `RATE_CREATE_GAME_PER_USER_MINUTE`, `RATE_CREATE_GAME_PER_USER_DAY`, `RATE_CREATE_GAME_MINUTE_MS`, `RATE_CREATE_GAME_DAY_MS` |

429 responses use Chinese messages and `Retry-After`. Password min length remains **4** (no complexity strengthen).

### Absolute session expiry

- Idle sliding window default **7 days** (`SESSION_IDLE_DAYS`).
- Absolute max from session `created_at` default **7 days** (`SESSION_ABSOLUTE_DAYS`). Idle refresh cannot extend past absolute; cookie `maxAge` = absolute.
- Redeploy **API** required for these changes.

### Tombstones + soft-delete

- Soft-delete (self or admin) writes `user_tombstones`.
- Admin `/admin/` can soft-delete and restore users (reason + reauth + audit). Ban/unban unchanged.
- **Whole-DB backup restore stays CLI/server only** — never a web button.
- After `db:restore`: revoke old sessions, then `npm run db:replay-tombstones` before opening writes.

### Co-deploy reminder

Ship **API + static** together when admin shell or client auth messages change. Phase 0 needs API migrate (`006_user_tombstones.sql`) + API restart; static `admin/` for soft-delete UI.
