# __tests__/

使用 vitest，纯 Node.js 环境运行。

## 结构

- `setup.ts` — polyfill `crypto.subtle.timingSafeEqual`（Cloudflare Workers 独有 API，Node.js 无此方法）
- `spam-filter.test.ts` — 黑名单匹配 + Authentication-Results 头解析
- `notify.test.ts` — HMAC 签名生成/验证/过期 + Webhook/Gotify 发送
- `email-handler.test.ts` — 拒收/存储/降级/R2 失败回滚/text 截断
- `api.test.ts` — 鉴权/限流/UUID 校验/CRUD 路由

## 约定

- 文件命名: `模块名.test.ts`
- 外部依赖 (D1/R2) 用 `vi.mock()` mock，不依赖真实服务
- Workers 独有 API 在 `setup.ts` 中 polyfill
- 新增模块时同步新增测试文件
