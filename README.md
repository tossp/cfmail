# cfmail

基于 Cloudflare Email Workers 的邮件存储服务。通过 catch-all 接收所有子地址邮件，使用 D1 存储元数据、R2 存储原始邮件，并提供 HTTP REST API 查询和管理。

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`pnpm add -g wrangler`)
- Cloudflare 账户，已开启 Email Routing

## 部署步骤

### 1. 创建 D1 数据库

```bash
wrangler d1 create cfmail-db
```

将输出的 `database_id` 填入 `wrangler.toml` 中对应位置。

### 2. 初始化数据库表结构

```bash
# 本地测试
pnpm db:migrate --local

# 远程
pnpm db:migrate --remote
```

### 3. 创建 R2 Bucket

```bash
wrangler r2 bucket create cfmail-emails
```

### 4. 设置 AUTH_TOKEN

在 Cloudflare Dashboard 或通过 wrangler 设置安全的 token：

```bash
wrangler secret put AUTH_TOKEN
```

### 5. 部署 Worker

```bash
pnpm deploy
```

### 6. 配置 Email Routing

在 Cloudflare Dashboard 中：

1. 进入域名 > Email > Email Routing
2. 在 "Routing rules" 中添加 Catch-all 规则
3. 动作选择 "Send to a Worker"，选择 `cfmail`

## API 使用

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

### 删除邮件

```
DELETE /api/emails/:id
```

## 本地开发

```bash
pnpm install
pnpm dev
```

## 项目结构

```
src/
├── index.ts           # Worker 入口
├── email-handler.ts   # 邮件接收、解析、存储
├── api.ts             # HTTP API 路由
├── db.ts              # D1 数据库操作
├── storage.ts         # R2 存储操作
└── types.ts           # TypeScript 类型定义
```
