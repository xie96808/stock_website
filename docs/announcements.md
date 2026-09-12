# 系统公告

访客首页右上角「公告」按钮（登录/注册或用户芯片旁）打开「系统公告」模态框。列表仅展示 `published`，按 `published_at` 倒序。

## 行为

- **今日关闭**：`localStorage` 键 `stockgame_announcements_dismissed_day` 记本地日历日 `YYYY-MM-DD`，当天不再自动弹出；可再点「公告」手动打开。
- **关闭公告**：仅关模态，不影响次日自动弹出。
- 正文前端 `escapeHtml`，防 XSS。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/announcements` | 公开；仅 published |
| GET | `/api/v1/admin/announcements` | 管理列表（可 `?status=`） |
| POST | `/api/v1/admin/announcements` | 创建（需 admin + reauth） |
| PATCH | `/api/v1/admin/announcements/:id` | 更新/改状态 |
| POST | `/api/v1/admin/announcements/:id/archive` | 归档 |

Schema：`server/migrations/007_announcements.sql`（含欢迎语种子）。

## 后台发布流程

1. 先二次验证管理员密码，否则写操作返回 `ADMIN_REAUTH_REQUIRED`。
2. **新建可直接 published**：填正文后点「新建」（状态下拉选 published），或无 ID 时点「发布」（POST `status=published`）。
3. 也可先存 draft，列表「填入」ID 后再点「发布」。

## 部署（server 29）

1. 拉代码 / 发静态（`index.html`、`js/announcements.js`、`css/announcements.css`、`admin/`）。
2. API 目录执行 migrate（会应用 `007_announcements.sql`）并重启 API 进程。
3. 无需改代码即可在 `/admin/` 继续发公告。

```bash
# 示例：API 主机
cd /path/to/api && sudo -u stockapi -E npm run migrate
sudo systemctl restart stockgame-api   # 以实际 unit 名为准
```
