# cfmail

基于 Cloudflare Email Workers 的邮件存储服务。通过 catch-all 接收所有子地址邮件，使用 D1 存储元数据、R2 存储原始邮件，并提供 HTTP REST API 查询和管理。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tossp/cfmail)

## 特性

- Catch-all 接收所有子地址邮件
- D1 存储元数据，R2 存储原始邮件和附件
- 基于 [Hono](https://hono.dev/) 的 REST API
- UUID v7 时间有序 ID
- 垃圾邮件过滤（SPF/DKIM/DMARC 检查 + 发件人黑名单）
- 附件/邮件大小限制
- Webhook 通知（HMAC-SHA256 签名）
- 已读/未读状态，差异化保留策略自动清理
- 一键部署到 Cloudflare

## 一键部署

点击上方按钮，Cloudflare 会自动：

1. 将仓库 fork 到你的 GitHub 账户
2. 自动创建 D1 数据库和 R2 Bucket
3. 运行数据库迁移并部署 Worker
4. 配置 CI/CD，后续推送自动部署

部署完成后，在 Cloudflare Dashboard 中配置 Email Routing：

1. 进入域名 > Email > Email Routing
2. 在 "Routing rules" 中添加 Catch-all 规则
3. 动作选择 "Send to a Worker"，选择 `cfmail`

## 手动部署

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`pnpm add -g wrangler`)
- Cloudflare 账户，已开启 Email Routing

### 1. 创建资源

```bash
wrangler d1 create cfmail-db
wrangler r2 bucket create cfmail-emails
```

将 D1 输出的 `database_id` 填入 `wrangler.toml`。

### 2. 设置 AUTH_TOKEN

```bash
wrangler secret put AUTH_TOKEN
```

### 3. 部署

```bash
pnpm install
pnpm deploy
```

部署脚本会自动运行 D1 迁移并部署 Worker。

### 4. 配置 Email Routing

在 Cloudflare Dashboard 中：

1. 进入域名 > Email > Email Routing
2. 在 "Routing rules" 中添加 Catch-all 规则
3. 动作选择 "Send to a Worker"，选择 `cfmail`

## API

所有请求需携带 `Authorization: Bearer <AUTH_TOKEN>` 请求头。

### 邮件列表

```
GET /api/emails?page=1&size=20&to=user@example.com
```

### 邮件详情

```
GET /api/emails/:id
```

### 下载原始邮件 (.eml)

```
GET /api/emails/:id/raw
```

### 下载附件

```
GET /api/emails/:id/attachments/:aid
```

### 标记已读

```
PATCH /api/emails/:id/read
```

### 删除邮件

```
DELETE /api/emails/:id
```

## 配置项

在 `wrangler.toml` 的 `[vars]` 中配置，或通过 Cloudflare Dashboard 修改：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RETENTION_DAYS_UNREAD` | `7` | 未读邮件保留天数 |
| `RETENTION_DAYS_READ` | `3` | 已读邮件保留天数 |
| `SENDER_BLACKLIST` | `""` | 发件人黑名单，逗号分隔（支持邮箱或域名，如 `spam@x.com,evil.com`） |
| `MAX_EMAIL_SIZE` | `26214400` | 单封邮件最大字节数（默认 25MB） |
| `MAX_ATTACHMENT_SIZE` | `10485760` | 单个附件最大字节数（默认 10MB），超限附件自动剔除 |
| `WEBHOOK_URL` | `""` | 收到邮件后推送的 Webhook URL（留空则不推送） |
| `WEBHOOK_SECRET` | `""` | Webhook HMAC-SHA256 签名密钥（留空则不签名） |

Secret 变量（通过 `wrangler secret put` 设置）：

| 变量 | 说明 |
|------|------|
| `AUTH_TOKEN` | API 鉴权令牌 |

## 垃圾邮件过滤

收到邮件时自动检查：

1. **发件人黑名单** — 匹配 `SENDER_BLACKLIST` 中的邮箱或域名，命中直接拒收
2. **DMARC** — `fail` 则拒收
3. **SPF** — `fail` 或 `softfail` 则拒收
4. **DKIM** — `fail` 则拒收

## Webhook

配置 `WEBHOOK_URL` 后，每收到一封邮件会向该 URL 发送 POST 请求：

```json
{
  "event": "email.received",
  "id": "...",
  "from": "sender@example.com",
  "from_name": "Sender",
  "to": "you@yourdomain.com",
  "subject": "Hello",
  "received_at": "2026-03-06T12:00:00.000Z",
  "has_attachments": false,
  "raw_size": 1234
}
```

如果配置了 `WEBHOOK_SECRET`，请求头会附带 `X-Webhook-Signature`（HMAC-SHA256 hex），可用于验证请求来源。

## 自动清理

Cron Trigger 每天 UTC 03:00 执行，根据已读/未读状态差异化清理：

| 状态 | 默认保留天数 | 环境变量 |
|------|-------------|---------|
| 未读 | 7 天 | `RETENTION_DAYS_UNREAD` |
| 已读 | 3 天 | `RETENTION_DAYS_READ` |

## 本地开发

```bash
pnpm install
pnpm dev
```

## 项目结构

```
src/
├── index.ts           # Worker 入口（email + fetch + scheduled）
├── api.ts             # Hono HTTP API 路由 + 鉴权中间件
├── email-handler.ts   # 邮件接收、过滤、解析、存储
├── spam-filter.ts     # 垃圾邮件检测（黑名单 + SPF/DKIM/DMARC）
├── webhook.ts         # Webhook 推送 + HMAC 签名
├── db.ts              # D1 数据库操作
├── storage.ts         # R2 存储操作
└── types.ts           # TypeScript 类型定义
```
