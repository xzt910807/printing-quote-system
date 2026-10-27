# 龙港印刷智能报价系统

面向印刷包装行业的报价 + 撮合平台：**B 端多租户工厂入驻**，**C 端客户智能报价引流**，把「输入需求 → 算出价格 → 匹到工厂 → 下单履约」做成一条闭环。

## 功能地图

| 端 | 能力 |
|---|---|
| C 端小程序 | 自然语言/表单报价、询价推送与比价、工厂主页（产能状态/验真徽章/设备图集）、IM 在线沟通、下单支付、地址簿、物流轨迹、订单评价、AI 设计与排版 |
| B 端工厂 | 自助注册 + 平台审核、多员工账号（owner/manager/sales/finance/designer/viewer）、询价接单台与报价、订单状态推进（确认/打样/生产/发货）、产能自报、设备图文上传、客户档案与折扣 |
| 管理后台 | 工厂与账号管理、图文审核、验真开关、报价与订单全量视图、退款处理、材料/费率/工艺/品类配置、运费模板、物流配置、数据看板、操作日志、运维诊断一屏 |
| AI 能力 | 自然语言参数抽取（LLM）、语音识别输入（ASR）、设计参考图生成、模板排版输出制版 PDF |

## 核心引擎

报价计算全部是纯函数，集中在 `src/core/`，被 `engine.js` 编排：

- `paper.js` — 开料与拼版（大度/正度、叼口、利用率）
- `plate.js` — 版费（CTP/树脂版/丝网版，按色数与规格）
- `printing.js` — 印工费（开机费 + 印数阶梯 + 专色/网点/纸张系数）
- `finishing.js` — 后道工艺（覆膜/模切/烫金/裱糊/绳带…）

品类可配置项（允许的印刷方式、材料、工艺、MOQ 与起订量系数、是否显示图案覆盖/油墨类型/专色）落在 `product_config` 表，由 `catalogService` 启动时加载。工厂侧可对整机价格、费率做覆盖（`factory_price_override`）。

## 技术栈

Node.js 18+ / Express 4 / MySQL 8（`mysql2` 直连，**无 ORM**）/ 原生微信小程序 / Vue 3（CDN 单页后台，无构建步骤）/ PM2 / Nginx。

## 目录结构

```
src/
  core/         报价引擎（纯函数，可脱离数据库测试）
  services/     报价/撮合/订单/物流/会话/支付/告警/定时任务等
  routes/       HTTP 接口（C端 /api/c、工厂端 /api/factory、管理端 /api/admin）
  middlewares/  鉴权与限流
  config/       数据库连接与权限矩阵
miniapp/        微信小程序（原生，pages + custom-tab-bar + utils）
admin/          管理后台（Vue 3 CDN 单页）
sql/            init.sql（唯一权威 schema + 参考种子）与运维 SQL
scripts/        迁移、结构同步、数据清理、binlog 抢救、备份、支付自测
test/           报价引擎单元测试与 SQL 种子夹具
docs/ops.md     部署与运维手册
```

## 快速开始

```bash
npm install
cp .env.example .env      # 填 DB_* 与 PORT（默认 6001）

# 建库（init.sql 含全部表结构与参考种子数据）
mysql -u root -p < sql/init.sql
# Windows 本地无 mysql 命令行时：
node scripts/run-sql.js sql/init.sql --allow-db-ddl

node scripts/migrate.js bootstrap   # 建立版本表
node scripts/schema-sync.js         # 校验结构是否与 init.sql 一致（预期缺表 0 / 缺列 0）

npm start                 # 或 npm run dev（node --watch）
```

启动后：管理后台 `http://localhost:6001/admin/`，健康检查 `http://localhost:6001/health`。小程序用开发者工具打开 `miniapp/` 目录，指向本地或线上 API 域名。

## 环境变量与降级策略

所有外部依赖都是**可选配置**，未配置时功能自动降级而不是报错，便于本地开发与分环境部署。完整清单见 `.env.example`：

| 变量组 | 未配置时的行为 |
|---|---|
| `WX_APPID` / `WX_SECRET` | 登录降级为开发身份 |
| `WXPAY_*`（6 项 + 验签二选一） | 真实支付不可用，小程序可走模拟支付或线下转账（工厂确认收款） |
| `WX_TMPL_ORDER_*` | 跳过订阅消息，仅站内信 |
| `KUAIDI100_*` | 物流轨迹返回「未配置」，发货信息照常录入与展示 |
| `XF_*` | 语音识别接口提示未配置 |
| `AGNES_*` / `DEEPSEEK_API_KEY` | 自然语言报价退回规则解析 |
| `AI_IMAGE_*` | AI 生图接口提示未配置 |
| `ALERT_WEBHOOK_URL` | 告警仅写管理员站内信 |

## 测试

```bash
npm test              # 报价引擎用例（node:test，不连数据库，直接解析 SQL 种子灌入内存目录）
npm run pay:selftest  # 微信支付 v3 回调验签链自测（自生成 RSA 密钥，7 个用例覆盖放行与拦截）
```

改种子价格、改面积公式或改费率系数都会被测试抓出来。

## 数据库变更约定

`sql/init.sql` 是**当前态 schema 的唯一权威**，历史迁移已归档（`sql/migrations/` 仅留占位）。因此：

- 全新环境 → 跑 `init.sql`
- 存量环境 → 用 `node scripts/schema-sync.js --apply` 补齐缺表缺列（**只加不删**）
- ⚠️ **严禁对任何有数据的库执行 `init.sql`**：它头部含 `DROP DATABASE`，会整库重建

配套工具：

| 命令 | 用途 |
|---|---|
| `node scripts/schema-sync.js [--sql\|--apply]` | 比对 init.sql 与实际库，报告或补齐差异 |
| `node scripts/run-sql.js <file.sql>` | 通用 SQL 执行器（默认拒绝库级 DDL） |
| `node scripts/purge-biz-data.js [--apply]` | 清理业务流水（默认试运行；`--apply` 先自动备份） |
| `node scripts/binlog-rescue.js [--apply]` | 从 binlog 行镜像逐行抢救误删数据 |
| `npm run migrate` / `migrate:apply` | 版本表状态与新增迁移执行 |

## 部署

生产用 PM2 守护（`ecosystem.config.js`，单实例 / 512M 内存重启 / 自动重启）+ Nginx HTTPS 反代，每日 `mysqldump` 备份由 `scripts/backup.sh` 挂 crontab。完整步骤、回滚、支付资质清单、监控告警与排障见 **[docs/ops.md](docs/ops.md)**。

## 安全边界

- 支付回调强制「验签 → 解密 → 商户号核对 → 金额核对」，任一不过即不落库；订单只允许 `unpaid → paid` 单向流转，退款中的订单不会被回调覆盖
- 生产/发货前置校验「已支付」；工厂端接口按 `factory_id` 校验数据归属
- 管理端接口走 `X-Admin-Token` + 权限矩阵（`src/config/permissions.js`），工厂端走 `X-Factory-*` 双身份
- 登录有防爆破限流；`/health` 可配 `HEALTH_STRICT=1` 在定时任务异常时返回 503 供外部拨测
- 待补：用户生成内容（询价文本 / IM 消息 / 上传图片）尚未接入微信内容安全接口，上线前必须补齐
