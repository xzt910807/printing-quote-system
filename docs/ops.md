# 部署与运维手册（printing-quote）

适用服务器：api.aiwts.me（Linux + Node.js 18+ + MySQL 8 + Nginx 反代 + PM2 守护）。

## 1. 首次部署

```bash
# 1) 拉代码
git clone <repo> /opt/printing-quote-system && cd /opt/printing-quote-system

# 2) 安装依赖
npm ci --omit=dev

# 3) 环境变量：复制 .env.example 为 .env 并填实际值（DB_*、PORT、WX_*、WXPAY_*）
cp .env.example .env && vi .env

# 4) 建库（sql/init.sql 为当前态唯一权威 schema：全部表结构 + 参考/种子数据；
#    历史 001~027 迁移的效果已全部并入，全新环境跑这一个文件即完成建库；
#    业务流水表与账号表（admin_user/factory_user）不预置数据）
mysql -u root -p < sql/init.sql
# 本地无 mysql 命令行时改用：node scripts/run-sql.js sql/init.sql --allow-db-ddl
#   （init.sql 头部带 DROP/CREATE DATABASE + USE；run-sql.js 默认拒绝库级 DDL，
#     只有 --allow-db-ddl 才会保留 USE 且不预绑库，详见第 13 节）
# sql/migrations/ 已清空（仅留 .gitkeep 占位，目录不可删：migrate.js 扫目录会报 ENOENT），
# 历史迁移文件归档在 data/sql-migrations-backup-20261027.zip。
# 建库后跑一次 bootstrap 建立版本表（现存迁移为 0，仅建表不登记）：
node scripts/migrate.js bootstrap
node scripts/migrate.js status   # 预期：合计 0 个迁移，未执行 0 个
# 校验建库结果与 init.sql 是否一致（预期：缺表 0 / 缺列 0）：
node scripts/schema-sync.js

# 5) PM2 启动（配置见项目根 ecosystem.config.js：printing-quote / 单实例 / 512M 内存重启 / 自动重启）
mkdir -p /var/log/printing-quote
pm2 start ecosystem.config.js
pm2 save && pm2 startup   # 开机自启

# 6) 验证
curl http://127.0.0.1:6001/health
```

## 2. 日常更新（发版）

```bash
cd /opt/printing-quote-system
git pull
npm ci --omit=dev                      # 依赖有变化时
# 结构对齐：比对 init.sql 与实际库，打印缺失表/列（只加不删，幂等安全）
node scripts/schema-sync.js            # 只看差异
node scripts/schema-sync.js --apply    # 直接补齐缺表/缺列
# （sql/migrations 已清空，不再靠迁移文件升级；表结构变更一律改 init.sql + 本工具同步存量库）
node scripts/migrate.js apply          # 仅当 sql/migrations/ 确有新增文件时才需要
pm2 restart printing-quote
# 冒烟
curl http://127.0.0.1:6001/health
curl -s -X POST http://127.0.0.1:6001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<密码>"}' | head -c 200
```

## 3. 回滚

- **代码回滚**：`git checkout <上一个 tag/commit>` → `pm2 restart printing-quote`。
- **数据回滚**：本阶段迁移（013~016/017）均为加表加列，未删改旧结构，一般无需回滚；
  如需撤销灌入的会话数据：`DELETE FROM user_session WHERE created_at >= '<执行时间>';`
  其余场景用最近备份恢复（见第 5 节）。

## 4. 每日备份（backup.sh）

`scripts/backup.sh`：读 `.env` 的 DB_* 配置 → mysqldump（single-transaction，业务不锁表）→
gzip 到 `/var/backups/printing-quote/` → 清理 7 天前旧档 → 可选 scp 异地副本。

安装：

```bash
chmod +x scripts/backup.sh
# 手动试跑一次，确认产出 dump 文件
./scripts/backup.sh
# 加入 crontab：每日 03:00
(crontab -l 2>/dev/null; echo '0 3 * * * /opt/printing-quote-system/scripts/backup.sh >> /var/log/printing-quote/backup.log 2>&1') | crontab -
```

异地副本（可选）：设置环境变量后生效，例如写入 crontab 行内
`BACKUP_REMOTE=user@backup-host:/backups/printing-quote/`。

## 5. 备份恢复演练

```bash
# 1) 解压最近备份
gunzip -k /var/backups/printing-quote/printing_quote_<时间>.sql.gz
# 2) 恢复到临时库验证（勿直接覆盖生产库）
mysql -u root -p -e "CREATE DATABASE printing_quote_restore;"
mysql -u root -p printing_quote_restore < /var/backups/printing-quote/printing_quote_<时间>.sql
# 3) 验证表与行数后，确认恢复流程可用，删除临时库
mysql -u root -p -e "DROP DATABASE printing_quote_restore;"
```

## 6. Nginx 反代（保持现有，补两项）

现有配置不动，仅确认/追加：

```nginx
server {
    listen 443 ssl;
    server_name api.aiwts.me;

    client_max_body_size 10m;                 # 全局上限

    location /legal/ {
        proxy_pass http://127.0.0.1:6001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /uploads/ {
        client_max_body_size 10m;             # 上传（营业执照/图片等）
        proxy_pass http://127.0.0.1:6001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:6001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 7. 常用排障

| 现象 | 排查 |
|---|---|
| 服务 502 | `pm2 status` 看进程是否存活；`pm2 logs printing-quote` 看异常 |
| 数据库连不上 | `pm2 logs` 中 [DB] 日志；确认 MySQL 运行与 `.env` 的 DB_* |
| 登录 401 | 会话过期属正常；大面积 401 查 `user_session` 表与服务器时间 |
| 磁盘涨 | `/var/log/printing-quote/` 与备份目录，`pm2 install pm2-logrotate` 切分日志 |

## 8. 微信支付验签与商户号资质（P0 资损防线）

回调 `/api/c/pay/notify` 现已强制安全链：**验签 → 解密 → 商户号核对 → 金额核对**，任一不过即返回非 200 且**不落已支付状态**，杜绝伪造回调刷单。

- **验签模式二选一**（`GET /api/admin/ops/status` 的 `wxpay.verifyMode` 会显示当前模式，`verifyReady=false` 时真实回调将被 401 拦截）：
  - 平台证书模式：只需配齐基础六项，服务用 `WXPAY_APIV3_KEY` 自动下载并缓存平台证书（序列号未知或超 12h 自动重下）。
  - 公钥模式：额外填 `WXPAY_PUBLIC_KEY_ID` + `WXPAY_PUBLIC_KEY_PATH`（商户平台「微信支付公钥」下载）。
- **`WXPAY_APIV3_KEY` 必须是 32 位原文**：回调解密直接以其字节作 AES-256-GCM 密钥，不做哈希；与商户平台设置值须逐字一致。

**本地验签链自测（无需商户号 / 无需数据库）**：`npm run pay:selftest`（`scripts/pay-notify-selftest.js`）。
自生成 RSA 密钥对走**公钥模式**，直接驱动 `wxpay.verifyNotify / decryptNotify / assertNotifyMchid` 跑 7 个用例：
正常回调 / 篡改签名 / 缺验签头 / 过期时间戳(重放) / 序列号错配 / 跨商户串单 / 金额不符，全部应「正常放行或精准拦截」。
（平台证书模式需联网下真证书，本地不可测，故自测走公钥模式；脚本输出 `configured=false` 属正常——未配齐商户号六项不能真实下单，但 `verifyReady=true` 代表回调防护已生效。）

**商户号资质检查清单**（能不能收钱，上线前逐项确认）：

| 项 | 要求 |
|---|---|
| 主体资质 | 企业/个体工商户，个人主体**无法**开通微信支付商户号 |
| JSAPI 支付 | 商户平台已开通「JSAPI 支付」产品并审核通过 |
| AppID 绑定 | 商户号已关联小程序 AppID（`WXPAY_APPID`），并在小程序侧确认授权 |
| 支付目录/授权 | 小程序调用支付不受域名限制，但 Native 场景需配置支付目录 |
| APIv3 密钥 | 已在商户平台设置 32 位 APIv3 密钥，与 `.env` 一致 |
| 证书/公钥 | 商户 API 私钥 `apiclient_key.pem` 已上传服务器；平台侧证书或公钥模式已配 |
| 回调地址 | `WXPAY_NOTIFY_URL` 公网 HTTPS 可达，指向 `/api/c/pay/notify`，返回微信规范 JSON |
| 金额单位 | 下单与对账均以「分」为单位，`total_price+shipping_fee+sample_fee` 之和须与回调 `amount.total` 相符 |

## 9. 订阅消息模板字段实测（P0 双端通知）

接单/发货订阅消息若「模板 ID 字段名与代码 data 键不一致」会**静默失败**（微信返回 47001/40037 但主流程不报错）。用运维接口真发一条验证：

```bash
# scene=accepted 用 thing1/thing2；scene=shipped 用 character_string1/thing2（与 matchService/orderService 调用点一致）
curl -s -X POST http://127.0.0.1:6001/api/admin/ops/notify-test \
  -H 'Content-Type: application/json' -H 'X-Admin-Token: <令牌>' \
  -d '{"userId":<C端用户ID>,"scene":"accepted"}'
```

返回 `result.errcode`：`0`=字段与模板匹配且发送成功；`47001/40037`=字段名或值与微信后台模板不符（据 errmsg 改代码或改模板）；`20001`=用户未订阅/次数耗尽（字段本身仍已通过校验）。模板 ID 配在 `WX_TMPL_ORDER_ACCEPTED` / `WX_TMPL_ORDER_SHIPPED`。

## 10. 监控告警与报价引擎测试（P1）

- **健康拨测**：`/health` 现返回 cron 心跳状态（`cron.state`：ok / stale / last_run_failed / no_heartbeat）。设 `HEALTH_STRICT=1` 时，cron 异常会直接返回 **HTTP 503**，供外部拨测（UptimeRobot 等）按状态码告警。
- **cron 心跳**：`cronService` 每轮 tick 向 `sys_kv` 写心跳；超 `CRON_STALE_MINUTES`（默认 45）未刷新判为 stale。tick 失败会写失败心跳并触发告警。
- **告警通道**：`ALERT_WEBHOOK_URL` 支持企业微信群机器人与钉钉群机器人（按 URL 特征自动适配），并同步向所有启用管理员发站内信；同一告警 30 分钟冷却去重。未配 URL 时仅站内信。
- **启动自检**：bootstrap 会检查「迁移是否有未登记执行」「支付已配置但验签未就绪」，异常写告警日志并推 `alertService`（不阻断启动）。
- **报价引擎测试**：`npm test`（node:test，无需数据库，直接解析 sql 种子灌入内存目录）覆盖面积公式/材料/版费/印工三参数/后道/拼版/工厂价覆盖/品类校验等核心用例，改种子价或改公式都会被抓出。

## 11. 印查查融合功能（027：产能/验真/图文/IM）

本功能相关的列/表（`factory.capacity_*`、`license_verified`、`factory_media`、`inquiry_message`）已全部写入 init.sql；原 `027-yinchacha.sql` 迁移文件已与其他历史迁移一并归档删除（见第 1 节）。**存量库若还没执行过这些 DDL，必须先手动补齐（可从归档 zip 中取回 027 语句），否则新接口会因缺列/缺表报错。**

- **闲置产能**：B 端 `PUT /api/factory/me/capacity` 自报 idle/normal/busy（超 72h 自动降级 unknown、不再参与加权）；撮合与找厂排序对空闲厂加权；C 端列表/详情展示产能状态。
- **验真徽章**：`factory.license_verified` + `audit_status` 双条件出「已核验」徽章；管理后台「工厂管理 → 编辑」表单内置验真开关（写 `PUT /api/factory/:id` 的 licenseVerified 字段）。
- **设备图文**：B 端 `GET/POST/DELETE /api/factory/me/media`（base64 上传，落 `uploads/factory-media/`，默认上传即 approved）；管理后台「工厂管理 → 图文」弹窗展示图集并支持逐张通过/驳回（`POST /api/factory/media/:mediaId/audit`，驳回连带删文件）；C 端详情页图集。**uploads 目录需纳入备份与 Nginx 静态反代（第 6 节已有 /uploads/）。**
- **IM 在线沟通**：新表 `inquiry_message`，会话键 = inquiry_id + factory_id；路由 `/api/messages/*`（threads/thread/send/unread），双身份鉴权（X-Factory-* 优先）。无长连接，小程序聊天页 15s 轮询；工厂回复时降级复用站内信通知客户。

## 12. 结构同步与数据清理工具（init.sql 单一权威策略的配套）

迁移文件清空后，“这个库到底缺不缺列”不再能从 migrations 推出来，改由三个脚本负责（均读 `.env` 的 DB_* 连库）：

| 脚本 | 作用 | 安全性 |
|---|---|---|
| `node scripts/schema-sync.js` | 比对 `sql/init.sql` 声明的结构与实际库，报告缺表/缺列/库内多余对象 | 只读 |
| `node scripts/schema-sync.js --sql` | 额外打印补齐 DDL，可粘贴到 mysql 客户端人工执行 | 只输出不执行 |
| `node scripts/schema-sync.js --apply` | 直接执行补齐（`CREATE TABLE` / `ADD COLUMN`） | **只加不删**，幂等 |
| `node scripts/run-sql.js <file.sql>` | 通用 SQL 文件执行器（本地无 mysql 命令行时用） | 默认拒执行库级 DDL（见第 13 节） |
| `node scripts/run-sql.js sql/init.sql --allow-db-ddl` | 首次建库专用：保留文件内 USE、不预绑连接库 | 会重建库，仅当 DDL 库名 == DB_NAME |
| `node scripts/purge-biz-data.js` | 试运行：列出将被清空的业务流水表与行数 | 只读 |
| `node scripts/purge-biz-data.js --apply` | 先备份到 `data/purge-backup-<时间>.sql`，再执行 `sql/purge-biz-data.sql` | 破坏性，有备份 |

**业务数据清理边界**（`sql/purge-biz-data.sql` 头部有完整清单）：
- 清空：询价链路（`c_inquiry`/`c_inquiry_quote_view`/`factory_inquiry_push`/`inquiry_message`）、报价与订单（`quote_order`/`order_main`/`order_logistics`）、台账统计（`platform_fee_ledger`/`daily_stats`）、消息会话日志（`c_message`/`user_session`/`factory_operation_log`）、上传类（`factory_media`/`user_address`）。
- **保留**：`admin_user`/`factory_user`/`c_end_user`（删了后台不进去）、`customer`/`factory_invite_code`（档案）、`factory` 与各参考种子表（删了报价引擎无数据）、`biz_seq`（单号计数器）、`schema_migrations`（工具表）。
- 注意：清 `user_session` 后所有设备需重新登录；TRUNCATE 不删磁盘文件，`uploads/avatars|designs|factory-media/` 需人工确认后另行清理。

**一屏冒烟**：`GET /api/admin/ops/status` 汇总支付/验签/物流/语音/AI/告警/cron 心跳/迁移待执行状态，发版后先看这一屏。

## 13. binlog 镜像抢救（误删库/误删表时的最后防线）

MySQL 8 默认 `binlog_format=ROW` + `binlog_row_image=FULL`，每个行事件都带**整行前后镜像**；
把现存 binlog 按序重放进「主键 → 行」字典，字典终态就是该表在 binlog 末刻的内容。
局限：只能覆盖现存 binlog 范围内被写过的行（`SHOW BINARY LOGS` 看库存，`binlog_expire_logs_seconds` 默认 30 天，到期即不可用）。

```bash
# 0) 先抢文件：binlog 随时可能滚动过期，立即整份拷走（含 .index）
copy "<datadir>\XZT-bin.*" data\binlog-rescue\
# 1) 生成恢复 SQL（mysqlbinlog 不在 PATH 时在 .env 配 MYSQLBINLOG=<完整路径>）
node scripts/binlog-rescue.js                      # 默认只捞 init.sql 无种子的账号表
node scripts/binlog-rescue.js --tables=admin_user,factory_user
# 2) 人工看过 data/rescue-<时间>.sql 后写回
node scripts/binlog-rescue.js --apply
```

配套恢复顺序（库被整体误删时）：`run-sql.js sql/init.sql --allow-db-ddl` 重建结构与参考种子 →
`binlog-rescue` 捞运行时账号 → 工厂老板账号可从 factory 表凭据派生（原 014 迁移第 2 步：
`INSERT IGNORE INTO factory_user (factory_id,username,password_hash,real_name,phone,role,status) SELECT id,username,password_hash,contact,phone,'owner',status FROM factory WHERE username<>''`）
→ `schema-sync.js` 校验结构 → `migrate.js bootstrap` 建版本表。

**为什么 run-sql.js 默认拒绝库级 DDL**（本库真实踩过的坑）：工具为对齐 migrate.js 会**过滤 `USE` 语句**，
于是文件里的 `DROP DATABASE IF EXISTS x` 不再随 USE 切换目标，而是作用在 `.env DB_NAME` 指向的库上——
用 `DB_NAME=临时库` 执行 init.sql 时，真库被删、建表全落在临时库，表现为「库存在但 0 表」。
因此现在：① 默认遇库级 DDL 直接中止；② `--allow-db-ddl` 时校验库名必须等于 `DB_NAME`，并自动保留 USE、不在连接时预绑库（否则 DROP 后连接默认库失效，报 `No database selected`）。
任何时候手工切库执行 SQL 文件，都要先确认输出首行的「目标库」再回车。

## 14. Batch A/B/C/D 增量上线手册（031-035）

### 14.1 迁移与冒烟

```powershell
# 已在本会话验证，存量库上线时只需重跑一次确认
node scripts/migrate.js status   # 应看到 031-034 都为 ✓
node scripts/migrate.js apply    # 幂等，新库上自动补齐
npm test                         # 27 个用例全绿即可重启服务
```

涉及新表：`user_news_subscription`、`supplier_follow`；新列：`industry_news.featured/editor_note/editor_id/keywords`、`factory.verification_level/verified_at`。均默认 0/NULL，存量无影响。

### 14.2 资讯订阅推送三件套（Batch B）

1. 微信公众平台「订阅消息」申请新模板，建议字段：
   - `thing1` 分类·标题（20字）
   - `thing2` 摘要（20字）
   - `time3` 推送时间（yyyy/M/d HH:mm:ss）
2. `.env` 回填 `NEWS_SUBSCRIBE_TEMPLATE_ID=xxx`；`NEWS_PUSH_HOURS=8,20` 控制每日推送时区（默认早报 8 点 + 晚报 20 点，2h 容错窗口同窗口只推一次，靠 `sys_kv.news_digest_push_<hour>_<date>` 节流）。
3. 小程序端：news 页点订阅后自动 `wx.requestSubscribeMessage`，未配模板 ID 时静默降级。后端 cron 下发前会先查 `enabled=1 AND openid IS NOT NULL`，未绑定微信 openid 的开发身份自动跳过。
4. 验收：`SELECT k, v FROM sys_kv WHERE k LIKE 'news_digest_push_%'` 应看到当日已推窗口记录，v 包含 `{hour, results:[{cat,subscribers,sent}]}`。

### 14.3 AI 一句话到位报价（Batch C）

`POST /api/quote/nl` 默认 `useAI=true`，行为变化：
- **以前**：仅当规则解析缺 quantity/lengthM 才拉 LLM，失败直接抛。
- **现在**：规则先给一个基座 → LLM 一步产出完整 JSON 字段 → 非法枚举/越界自动丢弃 → 基座回补。
- **风险**：LLM 服务挂时会在服务端 log `[nl] AI 解析失败回退规则结果`，不阻断主流程；确认没配 `AGNES_API_KEY`/`DEEPSEEK_API_KEY` 时也能用。排障时可传 `useAI=false` 回到旧行为。
- few-shot 样本在 `src/parser/nl-parser.js` `parseByAI`，新增领域参数时同步补充样本。

### 14.4 快递100 主动推送回调（Batch D）

1. `.env` 确认 `KUAIDI100_KEY` 与 `KUAIDI100_CUSTOMER` 已填（同拉取查询共用）。
2. 快递100 高级方案后台「任务推送」绑定回调 URL：`https://your-domain/api/logistics/kuaidi100/callback`（HTTPS 必需）。
3. nginx 层建议加 IP 白名单（poll.kuaidi100.com 固定 egress IP 段，参考官方文档），防止未签名伪探。
4. 签名算法：`MD5(param + KUAIDI100_KEY).toUpperCase()`，与拉取查询同一把钥匙。本端签名不匹定一律丢弃并回执 `{result:false,status:'500'}`。
5. 验收：本地模拟 curl（把 `<key>` 替换为真 KEY，param 中的 `number` 需为已录入单号）：
   ```bash
   PARAM='{"company":"SF","number":"SF1234567890","state":"3","trail":[{"ftime":"2026-10-27 10:00:00","context":"已签收"}]}'
   SIGN=$(printf '%s' "${PARAM}<key>" | md5sum | awk '{print toupper($1)}')
   curl -s -X POST https://your-domain/api/logistics/kuaidi100/callback \
     --data-urlencode "param=$PARAM" --data-urlencode "sign=$SIGN"
   ```
   预期返回 `{"result":true,"status":"200","message":"成功"}`，`order_logistics.status` 与 `order_main.logistics_status` 同步为 signed。

### 14.5 同环比与 CSV 导出（Batch A 遗留）

- `GET /api/factory/dashboard/compare?start=YYYY-MM-DD&end=YYYY-MM-DD`（需 `X-Factory-Id + X-Factory-Token`）：环比上期（长度相同的紧邻前一段）+ 同比去年（前推 365 天）；区间不传则默认本月至今。
- `GET /api/factory/dashboard/export.csv?start=&end=`：同区间 CSV（含 BOM，Excel 直接中文不乱码），小程序下右上传到邮箱，无前端入口。
- 无同环比/导出权限的工厂账号（viewer/finance）仍可读 summary，但不会看到派生 KPI。

