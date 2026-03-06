# src/

## 模块职责

| 文件 | 职责 |
|------|------|
| `index.ts` | Worker 入口，分发 email / fetch / scheduled 三个 handler |
| `api.ts` | Hono 路由 + 中间件（鉴权、限流、UUID 校验、全局错误处理） |
| `email-handler.ts` | 邮件接收核心：过滤 → 解析 → D1 写入 → R2 上传 |
| `db.ts` | D1 读写（CRUD + 批量清理） |
| `storage.ts` | R2 读写（上传/下载/批量删除） |
| `notify.ts` | 通知推送（Webhook + Gotify）+ HMAC 签名生成与验证 |
| `spam-filter.ts` | 垃圾邮件检测（发件人黑名单 + Authentication-Results 解析） |
| `log.ts` | 结构化 JSON 日志工具 |
| `types.ts` | 共享类型定义（Env、Records、分页响应） |

## 邮件处理流程

```
index.ts email handler
  → handleEmail() (email-handler.ts)
    1. isBlacklisted() → setReject
    2. checkJunkMail() → setReject
    3. 大小限制检查 → setReject
    4. PostalMime.parse() (失败则降级存储)
    5. D1 插入 → R2 上传 (失败则回滚 + 抛异常)
    6. 返回 EmailRecord
  → 成功: ctx.waitUntil(sendNotifications())
  → 异常: setReject() 通知发件方
```

## 数据存储

- **D1**: 元数据 + text/html 预览（截断至 64KB），完整内容从 R2 获取
- **R2 key**: `emails/{id}/raw.eml`、`emails/{id}/attachments/{aid}`

## 编码约定

- TypeScript strict，不允许 any
- 类型集中在 `types.ts`，通过 `import type` 引入
- `Env` 中可选 binding 用 `?`（如 `RATE_LIMITER?`）
- 日志用 `log.info/warn/error("模块.动作", { data })`，不直接 console.log
- 错误处理：API 层 `app.onError()` 全局捕获；通知层 `Promise.allSettled()` 隔离

## 安全机制

- Bearer Token 鉴权：SHA-256 哈希后 timingSafeEqual，防长度泄漏
- 签名删除链接：`HMAC(delete:{id}:{hourTs}, AUTH_TOKEN)`，72h 过期
- Content-Disposition：RFC 5987 编码防文件名注入
- 所有端点（含签名删除）均经过 Rate Limiter
