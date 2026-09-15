# 用户反馈

登录用户在头像 → **资料设置** 中点 **「反馈」**，可提交文本（必填）与最多 3 张 JPEG/PNG/WebP 图片。开发者在 `/admin/`「用户反馈」区阅读（最新优先），可标已读 / 归档。

## 行为

- 需登录 + CSRF；未登录 `401`。
- 客户端压缩大图后 multipart 上传；纯文本也可用 JSON `{ "body": "..." }`。
- 频率限制：默认每用户每小时 5 次、每 IP 每小时 20 次（`RATE_FEEDBACK_*`）。
- 图片落盘于 `STOCKGAME_DATA_DIR/feedback/`；仅管理员 API 可读。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/feedback` | 用户提交（JSON 或 multipart：`body` + `images`） |
| GET | `/api/v1/admin/feedback` | 列表（`?status=new\|read\|archived`） |
| GET | `/api/v1/admin/feedback/:id` | 详情（含图片 URL） |
| PATCH | `/api/v1/admin/feedback/:id` | `{ "status": "read"\|"archived"\|"new" }`（需二次验证） |
| GET | `/api/v1/admin/feedback-images/:filename` | 管理员取图 |

Schema：`server/migrations/018_user_feedback.sql`。

## 部署

1. 发静态：`index.html`、`js/feedback.js`、`css/feedback.css`、`js/auth.js`、`admin/`。
2. API：migrate（应用 `018_user_feedback.sql`）并重启 API。
3. 确保存储目录可写：`$STOCKGAME_DATA_DIR/feedback/`（与 `avatars/` 同级）。

```bash
cd /path/to/api && sudo -u stockapi -E npm run migrate
sudo systemctl restart stockgame-api
```
