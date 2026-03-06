# cfmail

Cloudflare Workers 邮件存储服务。catch-all 接收邮件 → D1 存元数据 → R2 存原始内容 → Hono REST API 查询管理。

## 命令

```bash
pnpm dev          # 本地开发
pnpm test         # 运行测试
pnpm run deploy   # 迁移 + 部署
```

修改代码后务必 `pnpm test` 确认通过。

## 技术栈

- 运行时: Cloudflare Workers (TypeScript strict, ESNext)
- HTTP 框架: Hono
- 存储: D1 (SQLite) + R2 (对象存储)
- 包管理: pnpm
- 测试: vitest
- ID: UUID v7 (时间有序)

## 新增功能检查清单

1. 类型 → `src/types.ts`
2. 环境变量 → `Env` 接口 + `wrangler.toml` [vars]
3. 关键路径 → 结构化日志
4. 测试 → `src/__tests__/`
5. 文档 → `README.md`
