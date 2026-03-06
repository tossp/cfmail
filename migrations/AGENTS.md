# migrations/

D1 数据库迁移文件，由 wrangler 管理。

## 规则

- 文件名格式: `NNNN_描述.sql`（如 `0001_init.sql`）
- `pnpm run deploy` 自动执行未应用的迁移
- 已部署的迁移不可修改，只能新增
- 当前 `0001_init.sql` 包含完整建表和索引，是唯一的迁移文件
