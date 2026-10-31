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
#    历史 001~034 迁移的效果已全部并入，新建一个空库后跑这一个文件即完成建库；
#    业务流水表与账号表（admin_user/factory_user）不预置数据）
#    init.sql 是纯「表结构 + 种子」的导出文件，不含 DROP/CREATE DATABASE 也不含 USE，
#    所以库必须先建好、并显式指定目标库；它对每张表都带 DROP TABLE IF EXISTS。
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS printing_quote DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p printing_quote < sql/init.sql
# 本地无 mysql 命令行时改用（目标库取 .env 的 DB_NAME，需先建好该库；
#   因文件不含库级 DDL，不需要 --allow-db-ddl，详见第 13 节）：
node scripts/run-sql.js sql/init.sql
# ⚠️ 上面两种导入 init.sql 的方式（mysql 与 run-sql.js）都只能在「空库」上跑：init.sql 逐表 DROP TABLE IF EXISTS，在存量库执行等于删表重建。
# sql/migrations/ 已清空（仅留 .gitkeep 占位，目录不可删：migrate.js 扫目录会报 ENOENT），
# 历史迁移文件归档在 data/sql-migrations-backup-20261027.zip（001~027）与
# data/sql-migrations-backup-20261030.zip（026-file-transfer~034）。data/ 被 .gitignore 忽略，备份只在本地，需要时另拷。
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
# ⚠️ schema-sync 只比表名与列名，既不比对也不创建索引：给存量表加「带索引的新列」时，
#    索引必须在 init.sql 的 CREATE TABLE 里写好（新库天然有），并对存量库手工补一条 ADD INDEX。
#    需手工补的索引清单（本库已执行完毕，新发现的往这里追加）：
#      ALTER TABLE `order_main` ADD INDEX `idx_escrow`(`escrow_status`);            -- Batch D0，029 迁移原本漏建
#      ALTER TABLE `factory`    ADD INDEX `idx_latlng`(`lat`, `lng`);               -- Batch D2，随距离排序上线
#      ALTER TABLE `community_comment` ADD INDEX `idx_factory_quote`(`factory_id`, `is_quote`, `author_type`, `created_at`);  -- Batch E，社区答价聚合
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

> 2026-10-30 复核：`sql/migrations/` 里的 026~034 曾回流到工作区（与本节此前「已归档删除」的表述不符），
> 已重新归档为 `data/sql-migrations-backup-20261030.zip` 并删除文件；同时把这 9 个迁移的效果全部并入 init.sql，
> 并修掉了 init.sql 自身的两处硬伤（factory 种子 INSERT 缺列、占位账号撞 uk_factory_username 唯一索引）——
> 在此之前，用 init.sql 建全新库是跑不通的。

- **闲置产能**：B 端 `PUT /api/factory/me/capacity` 自报 idle/normal/busy（超 72h 自动降级 unknown、不再参与加权）；撮合与找厂排序对空闲厂加权；C 端列表/详情展示产能状态。
- **验真徽章**：`factory.license_verified` + `audit_status` 双条件出「已核验」徽章；管理后台「工厂管理 → 编辑」表单内置验真开关（写 `PUT /api/factory/:id` 的 licenseVerified 字段）。
- **设备图文**：B 端 `GET/POST/DELETE /api/factory/me/media`（base64 上传，落 `uploads/factory-media/`，默认上传即 approved）；管理后台「工厂管理 → 图文」弹窗展示图集并支持逐张通过/驳回（`POST /api/factory/media/:mediaId/audit`，驳回连带删文件）；C 端详情页图集。**uploads 目录需纳入备份与 Nginx 静态反代（第 6 节已有 /uploads/）。**
- **IM 在线沟通**：新表 `inquiry_message`，会话键 = inquiry_id + factory_id；路由 `/api/messages/*`（threads/thread/send/unread），双身份鉴权（X-Factory-* 优先）。无长连接，小程序聊天页 15s 轮询；工厂回复时降级复用站内信通知客户。
- **协同文件进会话**：`inquiry_message` 的 `msg_type`/`file_id` 两列支撑“文件也是一条消息”（026 的 `file_transfer` 表已并入 init.sql）。上传接口在 `refType=inquiry` 时同步写一条 `msg_type='file'` 消息，会话对家工厂由前端携带的 `factoryId` 决定（工厂侧就是本厂；客户侧没带则按 `matched_factory_id` 兜底，都对不上就只存文件不进消息流，响应里 `threaded=false`）。消息 content 只存预览文案：图片一律就「[图片]」（选图上传时微信给的文件名是 40 位随机串，拼进去就是一串乱码），文档为「[文件] 名字」（超 40 字截断）。**发版后需跑一次**：`node scripts/backfill-file-message.js --apply`（幂等，同时把存量文件消息补进会话、把早期写脏的图片 content 压回「[图片]」，回填的消息 `is_read=1`，不会把人砸一屏未读）。
- **文件读取按会话隔离**：一条询价常同时推给多家厂，A 厂聊天里递的刀模图不能让 B 厂列走。`GET /api/{c,factory}/file/list?refType=inquiry` 只返回在 `(inquiry_id, factory_id)` 会话里有 `msg_type='file'` 消息行的文件（工厂侧固定本厂；客户侧可带 `factoryId` 收窄到某一个会话，不带则返回自己全部会话）；`GET /api/{c,factory}/file/:id/download` 过 `assertFileReadable`，与列表同口径（旧行为是只要登录了就能按 id 拉）。**局限**：静态 `/uploads/files/*` 仍是“拿到 URL 即可读”，聊天页图片就靠它；要防直链泄露得上签名 URL，本轮防的是列表与 id 枚举。

## 12. 结构同步与数据清理工具（init.sql 单一权威策略的配套）

迁移文件清空后，“这个库到底缺不缺列”不再能从 migrations 推出来，改由三个脚本负责（均读 `.env` 的 DB_* 连库）：

| 脚本 | 作用 | 安全性 |
|---|---|---|
| `node scripts/schema-sync.js` | 比对 `sql/init.sql` 声明的结构与实际库，报告缺表/缺列/库内多余对象 | 只读 |
| `node scripts/schema-sync.js --sql` | 额外打印补齐 DDL，可粘贴到 mysql 客户端人工执行 | 只输出不执行 |
| `node scripts/schema-sync.js --apply` | 直接执行补齐（`CREATE TABLE` / `ADD COLUMN`） | **只加不删**，幂等 |
| `node scripts/run-sql.js <file.sql>` | 通用 SQL 文件执行器（本地无 mysql 命令行时用） | 默认拒执行库级 DDL（见第 13 节） |
| `node scripts/run-sql.js sql/init.sql` | 首次建库专用：目标库 = `.env` 的 `DB_NAME`（库须先建好，文件内无 USE） | ⚠️ 逐表 `DROP TABLE IF EXISTS`，存量库禁跑 |
| `node scripts/purge-biz-data.js` | 试运行：列出将被清空的业务流水表与行数 | 只读 |
| `node scripts/purge-biz-data.js --apply` | 先备份到 `data/purge-backup-<时间>.sql`，再执行 `sql/purge-biz-data.sql` | 破坏性，有备份 |
| `node scripts/backfill-file-message.js [--apply]` | 把存量 `file_transfer`（仅 inquiry）补成会话消息 | 只插缺的，已有同 `file_id` 消息则跳过，可重复跑 |
| `node scripts/backfill-region.js [--apply] [--force]` | 从 `factory.address` 提取并回填 `province/city` | 未命中保持 NULL；已填的默认跳过 |
| `node scripts/backfill-factory-geo.js [--apply] [--force]` | 按 `factory.city` 回填市中心坐标（Batch D2 距离排序） | 只处理命中表内城市；已有坐标默认跳过（工厂选址会覆盖） |

**业务数据清理边界**（`sql/purge-biz-data.sql` 头部有完整清单）：
- 清空：询价链路（`c_inquiry`/`c_inquiry_quote_view`/`factory_inquiry_push`/`inquiry_message`）、报价与订单（`quote_order`/`order_main`/`order_logistics`）、台账统计（`platform_fee_ledger`/`daily_stats`）、消息会话日志（`c_message`/`user_session`/`factory_operation_log`）、上传类（`factory_media`/`user_address`）、UGC 社区内容与其互动/举报（`community_post`/`community_comment`/`community_like`/`community_favorite`/`community_report`，Batch D4）。
- **保留**：`admin_user`/`factory_user`/`c_end_user`（删了后台不进去）、`customer`/`factory_invite_code`（档案）、`factory` 与各参考种子表（删了报价引擎无数据）、`community_category`（社区 6 个版块种子，清了发帖直接不可用）、`biz_seq`（单号计数器）、`schema_migrations`（工具表）。
- 注意：清 `user_session` 后所有设备需重新登录；TRUNCATE 不删磁盘文件，`uploads/avatars|designs|factory-media|community/` 需人工确认后另行清理。

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

配套恢复顺序（库被整体误删时）：先 `CREATE DATABASE printing_quote ...` 建回空库，再
`node scripts/run-sql.js sql/init.sql` 重建结构与参考种子（init.sql 无库级 DDL，不需要 `--allow-db-ddl`）→
`binlog-rescue` 捞运行时账号 → 工厂老板账号可从 factory 表凭据派生（原 014 迁移第 2 步：
`INSERT IGNORE INTO factory_user (factory_id,username,password_hash,real_name,phone,role,status) SELECT id,username,password_hash,contact,phone,'owner',status FROM factory WHERE username<>''`）
→ `schema-sync.js` 校验结构 → `migrate.js bootstrap` 建版本表。

**为什么 run-sql.js 默认拒绝库级 DDL**（本库真实踩过的坑）：工具为对齐 migrate.js 会**过滤 `USE` 语句**，
于是文件里的 `DROP DATABASE IF EXISTS x` 不再随 USE 切换目标，而是作用在 `.env DB_NAME` 指向的库上——
用 `DB_NAME=临时库` 执行当时那份头部带库级 DDL 的 init.sql 时，真库被删、建表全落在临时库，表现为「库存在但 0 表」。
（现在的 init.sql 已不再带 DROP/CREATE DATABASE 与 USE，护栏保留是为了任何 dump 类文件。）
因此现在：① 默认遇库级 DDL 直接中止；② `--allow-db-ddl` 时校验库名必须等于 `DB_NAME`，并自动保留 USE、不在连接时预绑库（否则 DROP 后连接默认库失效，报 `No database selected`）。
任何时候手工切库执行 SQL 文件，都要先确认输出首行的「目标库」再回车。

## 14. Batch A/B/C/D 增量上线手册（031-035）

### 14.1 迁移与冒烟

```powershell
# 已在本会话验证，存量库上线时只需重跑一次确认
node scripts/migrate.js status   # 031-034 的效果已并入 init.sql、迁移文件已归档删除，此处应看到「合计 0 个」
node scripts/schema-sync.js     # 缺表 0 / 缺列 0（索引不在本工具射程，见第 2 节手工补索引清单）
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

### 14.6 工厂硬指标/资质证书/浏览量/距离（Batch D1+D2）

新列（全在 `factory` 表末尾，均默认 NULL / 0，存量行无影响）：
`factory_area` `annual_volume` `employee_count` `equipment_count` `assembly_lines` `outer_processing` `view_count` `lat` `lng`。
`factory_media.media_type` 注释多一个取值 `certificate`（资质证书）。审核口径与普通实拍图不同：
设备/车间/样品实拍仍是**先发后审**（表默认 `approved`，后台驳回即删行删文件），
资质证书改为**先审后发**——`POST /api/factory/me/media` 对 `certificate` 显式写 `pending`，
因为它是对外背书材料，不能让伪造证照在人工看到之前就先摆上 C 端详情页（工厂端图集会显示「待审」角标）。

上线顺序（每一步都可在开发库先过一遍）：

```powershell
node scripts/schema-sync.js --apply        # 只补列，不建索引
# 手工补索引（schema-sync 不比对也不创建索引，漏了不会报错，只是距离/画像查询慢）
#   ALTER TABLE `factory` ADD INDEX `idx_latlng`(`lat`, `lng`);
node scripts/backfill-factory-geo.js       # 试运行看命中情况
node scripts/backfill-factory-geo.js --apply
```

接口行为变化：
- `GET /api/factory/list` 新增 `userLat` / `userLng`（传了才下发 `distanceKm`）与 `sort=distance`。
  距离是 **Node 侧内存排序**（Haversine，不进 SQL），`SORTS` 白名单里故意没有 distance；
  无坐标的厂恒排末尾，没带用户坐标时回落综合排序。
- `GET /api/factory/public/:id` 每次访问 `view_count + 1`，同 IP 同厂 60 秒内只计一次；
  计数在响应发出之后 fire-and-forget，失败静默（浏览量不准可接受，详情页打不开不可接受）。
- `PUT /api/factory/me/profile` 改为全字段「显式传了才写」（含 contact/phone/address/intro），
  所以工厂端可以分开提交硬指标与坐标；后台 `PUT /api/factory/:id` 同样不会再把
  `province/city/c_end_enabled` 清成默认值（旧版「启停工厂」会顺手清空地区，Batch D1 修掉）。

小程序上线前要在微信公众平台把话说全，否则真机直接调用失败（开发者工具里看不出来）：
- `app.json` 已加 `permission.scope.userLocation` 与 `requiredPrivateInfos: ["getLocation","chooseLocation"]`；
- 后台「设置 → 服务内容声明 → 用户隐私保护指引」需勾选**位置信息**；
- 后台「开发管理 → 接口设置」需申请 `wx.getLocation` 与 `wx.chooseLocation`（未获批时找厂页距离胶囊不显示、
  「距离最近」排序项置灰，属预期降级，不是 bug）。

回填的是**市中心粗坐标**（同城厂之间距离会是 0.0km）；工厂在小程序「我的工厂 → 基本资料 → 地图选址」
选点后即为精确位置（会覆盖回填值）。

### 14.7 图集视频通道（Batch D3）

新列（`factory_media` 表末尾，均默认 NULL，存量行无影响）：`cover_url` `duration` `file_size`。
无新索引（图集一直走既有的 `idx_factory_audit(factory_id, audit_status)`），`node scripts/schema-sync.js --apply` 补齐即可。

上传通道与图片不同，走 multer 落盘而不是 base64：
- `src/middlewares/upload.js` 提供 `videoUpload`（20MB，mp4/mov）/ `coverUpload`（5MB 图）/ `imageUpload`（社区图片，Batch D4 用），
  文件直接落 `uploads/factory-media/`、`uploads/community/`，只把相对路径写进库；
  必须单独开这一路是因为 `app.js` 里 `express.json({limit:'2mb'})` 钉死了请求体，视频根本进不来（base64 还比原文件大 1/3）。
- 扩展名与 MIME **双白名单**，两者都要过：只校扩展名会把 .exe 改名成 .mp4 塞进来；服务端生成落盘文件名，不用客户端给的原始名。
- `POST /api/factory/me/media-video`（multipart：file + caption + duration）写入 `media_type='video'`、`audit_status='pending'` ——
  视频与资质证书同为**先审后发**，后台「设备图文」弹窗里点「通过」才对 C 端可见；实拍图仍先发后审，别把这条改回去。
- `POST /api/factory/me/media-video-cover`（multipart：file + mediaId）给本厂一条视频换首帧封面，不传也能用（端上给占位）。
- 删除图集条目会连 `cover_url` 指向的封面文件一起删；审核驳回同样连带清掉视频与封面文件。

可调环境变量：`MEDIA_VIDEO_MAX_MB`（默认 20，改了要重启）。小程序端 `pages/factory-me/factory-me.js` 的
`MAX_VIDEO_MB` 是同一值的副本，只改服务端不改端上会出现「端上放行、服务端拒收」，用户白等一场上传。

播放不需要额外配置：`app.js` 用 `express.static` 托管 `/uploads`，支持 Range 请求，mp4 可直接流播、可拖进度条。
上线后盯 `uploads/` 所在磁盘余量：历史文件只随条目删除而删除，**没有自动过期清理**，待审后被驳回/长期无人管的条目会一直占空间。

### 14.8 社区运营（Batch D4：UGC 分级审核）

六张新表（全部写进 init.sql，`CREATE TABLE` 里就带索引，存量库跑 `node scripts/schema-sync.js --apply` 建表即为终态）：
`community_category`（版块，init.sql 预置 6 个种子）/ `community_post` / `community_comment` /
`community_like` / `community_favorite` / `community_report`。无新列、无手工补索引（新表不靠 schema-sync 建索引）。

**权限点**：`community:view`（只读）、`community:manage`（审核/加精/置顶/删除/举报处置/版块维护）。
`super`/`admin` 由全量派生自动得到；`viewer` **不给**；**不写进 `FACTORY_ALL`**——工厂在后台只能发内容，不该看得到审核队列。
后台入口：「管理 → 社区审核」（`/api/admin/community/*`，`requireAdmin` + 逐路由 `requirePermission`）。

**分级审核矩阵**（与 `src/services/communityService.js` 头部注释同口径，改代码要同步改这里）：

| 触发 | 落库 status | 说明 |
|---|---|---|
| 工厂身份（`X-Factory-*`）发帖/评论 | `published` | 直接公开，不进人工队列（有厂名与执照背书） |
| 客户身份发帖/评论 | `published` + `audit_note='待人工抽查'` | **先发后审**，后台「待审帖子」视图按 note 筛出抽查对象 |
| 机审 `checkText` 返回 risky（或 review 且 `SEC_REVIEW_BLOCK=1`） | `pending` | 命中即压住，标题+正文合并成一次检测（省一次外部调用） |
| 累计 `report_count` 达 `COMMUNITY_REPORT_HOLD`（默认 3）且当前 published | 回退 `pending` + 写 `c_message` 留痕 | 同人同目标只计一次（唯一键），一人连点三次刷不动别人的正常内容 |
| 后台 approve / reject / remove | `published` / `rejected` / `removed` | reject、remove **必须填原因**，作者端会显示 `audit_note` |

**图片与视频没有机器审核**：`contentGuard` 只有 `msg_sec_check`，没接 `mediaCheckAsync`（需企业主体与回调域名）。
所以媒体只能靠「先发后审 + 举报回退 + 后台人工」，后台待审面板顶部的文案已把这句话写给运营看，**别在没接机审前把它改没**。

可调环境变量：`COMMUNITY_REPORT_HOLD`（默认 3，设 0 等于关掉自动回退，只在举报待处理列表里人工看）。限流是**内存滑窗**
（`writeGuard`）：发帖 5/小时、评论 20/小时、举报 10/小时，key 优先用身份 id、退回 IP。两个已知局限：
重启即清零，且 PM2 多实例时各算各的（当前部署是单实例，扩实例数要改成 Redis 计数）。

媒体上传走 multer 落 `uploads/community/`（图 5MB、视频 20MB，与工厂图集共目录不同实例）；
**落库前必校前缀 `/uploads/community/`**（`normalizeMediaUrl`），外链与 `data:` 一律 400，防止把社区变成钓鱼跳板。
社区视频没有单开封面接口：要封面就走 `POST /api/c/community/media-image` 拿 url 后作 `coverUrl` 提交。

小程序：`tabBar.list` 与 `custom-tab-bar` 的 `ALL_TABS` 同步加第 5 项「社区」（**微信上限就是 5 个**，客户视角过滤掉「接单」后显 4 项），
新增 4 页：`community`（列表）、`community-detail`（详情/评论/举报）、`post-create`（发布）、`community-mine`（我的帖子与收藏）。
**身份不由前端选**：小程序已有的 `X-Factory-*` 头带了就按工厂记，前端伪造 `author_type` 在服务层根本不会被读。

数据清理边界：`sql/purge-biz-data.sql` 会清 `community_post/comment/like/favorite/report`，但**保留 `community_category`**
（它是种子表，清了发帖接口会因「版块不存在」整体不可用）；磁盘上的 `uploads/community/` 需人工确认后另删。

上线后核对：

```sql
SELECT status, COUNT(*) FROM community_post GROUP BY status;   -- 预期只有 published/pending, rejected/removed 来自人工处置
-- 计数与明细严格相等（like_count 应等于该帖实际的点赞行数, 非 0 行就是计数跑偏了）
SELECT p.id, p.like_count, COUNT(l.id) n
  FROM community_post p LEFT JOIN community_like l ON l.target_type = 'post' AND l.target_id = p.id
 GROUP BY p.id, p.like_count HAVING p.like_count <> COUNT(l.id);
-- 达阈值却没回退的条目（应为 0 行）
SELECT target_type, target_id, COUNT(*) n FROM community_report
 WHERE status = 'pending' GROUP BY 1,2 HAVING COUNT(*) >= 3;
```

### 14.9 社区价格上下文（Batch E：规格/锚定价/答价/信任徽章）

**存量库必须先手工执行这段 DDL**，否则发帖与评论接口会因缺列报错（`schema-sync` 只会补普通列，
且**不建索引**）：

```sql
ALTER TABLE community_post
  ADD COLUMN spec json NULL, ADD COLUMN estimate json NULL,
  ADD COLUMN accepted_comment_id bigint NULL DEFAULT NULL;
ALTER TABLE community_comment
  ADD COLUMN is_quote tinyint NOT NULL DEFAULT 0,
  ADD COLUMN quote_price decimal(12,4) NULL,
  ADD COLUMN quote_valid_days int NULL,
  ADD COLUMN is_accepted tinyint NOT NULL DEFAULT 0,
  ADD INDEX idx_factory_quote(factory_id, is_quote, author_type, created_at);
```

新增列的语义：

| 列 | 说明 |
|---|---|
| `community_post.spec` | 发帖时提交的结构化规格（`productType/printMode/lengthMm/widthMm/heightMm/quantity/materialCode/processes/…`），**已服务端白名单归一** |
| `community_post.estimate` | 按平台计价模型算出的参考价**快照**（非实时重算），算不出或未填规格为 `NULL` |
| `community_post.accepted_comment_id` | 帖主采纳的报价评论 id，是社区反哺撮合的唯一强信号 |
| `community_comment.is_quote` / `quote_price` / `quote_valid_days` | 工厂答价三件套（`is_quote=1` 才算答价；有效期 1~30 天） |
| `community_comment.is_accepted` | 被帖主采纳（同一帖至多一条，服务层事务内互斥） |

**锚定价只用系统基准价（`factoryId=0`）**，不取任何一家工厂的真实报价：工厂价是商业敏感信息，
公开帖里展示等于替某家厂向同行报价；且若按最优工厂价展示，其余工厂就没有报价意愿了。
系统基准价与结果页 `systemQuote` 同口径，两处数字能对上。

**发帖不会因为算不出价而失败**：规格校验不过（品类不对、材料不在该品类白名单、工艺非法、尺寸/数量越界）
时丢弃 `spec` 与 `estimate`，照常落库，响应体带 `estimateError`，端上提示「参数组合不支持，未生成参考价」。

**参考价是快照不是实时值**：详情页超过 90 天会加一句「参考价发布于 N 天前，行情可能已变」，
后台不重算（成本与口径一致性都不划算）。核对快照是否被误重算：

```sql
-- 有规格却没生成参考价的行（多为白名单外组合，属预期，突增说明品类配置被改了）
SELECT category_code, COUNT(*) FROM community_post
 WHERE spec IS NOT NULL AND estimate IS NULL GROUP BY category_code;
-- 答价规模与采纳率（工厂侧供给活跃度）
SELECT factory_id, COUNT(*) quotes, SUM(is_accepted) accepted
  FROM community_comment
 WHERE author_type = 'factory' AND is_quote = 1 AND status = 'published'
   AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
 GROUP BY factory_id ORDER BY accepted DESC, quotes DESC;
-- 同一帖出现多条采纳（应为 0 行，服务层互斥失效才会出现）
SELECT post_id, COUNT(*) FROM community_comment
 WHERE is_accepted = 1 GROUP BY post_id HAVING COUNT(*) > 1;
```

社区分进撮合排序链的**最末尾**（`followed → 产能 → 口碑分 → 接单率 → 工艺命中 → 社区分`），
`score = min(被采纳×3 + 答价次数, 20)`，近 90 天窗口。放在末尾是故意的：发帖答价是低成本行为，
排到高分厂前面会让「爱聊天但做工一般」的厂挤掉口碑厂，属于激励反向。要调激进程度只改
`matchService` 那一行与 `communityReputation` 的系数，本版不预留配置开关。

信任徽章来源：`factory.verification_level` + `factory.license_verified` + 是否有
`factory_media.media_type='certificate' AND audit_status='approved'` 的图集；
客户作者的 `authorTrust` 一律为 `NULL`（不是空对象，避免端上把 null 误判成「已核验」）。

### 14.10 社区价格上下文的运营口径（Batch E，端上入口与解释）

三端入口一览，客服/运营被问到「这个价哪来的」时照此回答：

| 位置 | 行为 |
|---|---|
| 小程序发帖页「规格（选填，用于生成参考价）」 | 仅**报价求助 / 供需信息**两个版块默认展开，其它版块折叠；填不全就当没填 |
| 小程序社区列表卡 | `¥x.xx/个起` 取快照的 `estimate.unitPrice`；工厂作者显示 `验真 Lx / 执照核验 / 资质证书` |
| 小程序社区详情 | 参考价卡（单价 + 含税总价 + 数量 + 可展开成本拆解）→「按此参数算一算」把规格带回计算器 |
| 小程序计算器 | 「把这个需求发到社区求助」把当前表单写成 `communitySpec`，社区发帖页一次消费后即清 |
| 管理后台社区审核面板 | 帖子卡显示信任徽章与「参考价 ¥x」，评论列表显示答价与采纳状态 |

四条必须守住的运营口径：

1. **参考价 ≠ 工厂报价**。它只是平台计价模型的中性锚（`factoryId=0`），详情页已声明「实际以工厂报价为准」，
   任何「你平台报的价比 X 厂还低」的争议都以此回复；不对锚定价做赔付承诺。
2. **采纳只是信任信号，不自动生成询价单**。客户要下单仍走「按此参数算一算」→ 计算器 → 询价。
   看到 `accepted_comment_id` 有值但 `c_inquiry` 没单，是预期行为，不是漏单。
3. **答价与普通评论同一条审核线**（`contentGuard.checkText`，先发后审 + 举报 + 人工），不额外放宽、
   也不额外加严；`is_quote=1` 只表示「带价格的评论」，不代表平台背书。
4. **信任徽章只展示客观事实**：验真分级、执照核验、是否有过审的资质图集。没有徽章≠假厂，
   徽章来自 `factory` 与 `factory_media` 的审核结果，后台改审核状态后社区页需下拉刷新才变。

改 `admin/js/app.js` **必须同步升 `admin/index.html` 里 `app.js?v=`**（当前 v=38），否则运营看到的
还是旧缓存页面；只改 `admin/style.css` 时同理升 `style.css?v=`。

常见问题排查顺序：列表没显示参考价 → 查 `community_post.spec/estimate` 是否 NULL →
NULL 属预期（未填规格或算不出价，见 14.9 的两条 SQL）；工厂答价不显示采纳按钮 → 只有帖主可见
（详情接口的 `isAuthor`）；工厂看不到「附报价」开关 → 身份头缺失（`X-Factory-*`），不是权限问题。

### 14.11 报价校准回路与信任徽章进决策路径

**新表 `quote_calibration`**（`sql/init.sql` 已带建表语句，存量库执行一次即可）：

```powershell
node scripts/schema-sync.js --apply    # 只做加法，会 CREATE TABLE IF NOT EXISTS
# 若 schema-sync 不可用，手工执行 init.sql 里 quote_calibration 那段 CREATE TABLE（含 uk_dim 唯一索引）
```

**这层在做什么**：`c_inquiry.system_quote` 是下单当时的引擎输出快照，`order_main.unit_price` 是真实成交单价，
两者靠 `order_main.inquiry_id` 一一对应（唯一键）。每天聚合一次「同一规格下 引擎预估 vs 实际成交」的偏差，
写进 `quote_calibration`，再反向供给三处展示：结果页的报价信度、社区帖的参考价信度、工厂端「我方报价 vs 平台估价」偏差。

两个不能改的口径：

1. **用快照，不用当前引擎重算历史订单。** 重算会引入参数漂移的自指——引擎参数一旦被调到贴近成交价，
   重算偏差自动趋近 0，看着很准其实什么都没测到。快照 + 成交价才是纯粹的「预测 vs 实际」。
2. **样本不足不对外宣称偏差。** 低于 30 笔成交一律 `level='none'`，端上只显示「样本积累中（已收集 N 笔成交）」；
   30/100/300 分 low/medium/high 三档。`bias` 用 `SUM(实际)/SUM(预估)-1`（按金额加权），不是逐笔偏差取平均。

**维度编码用空串表示「不限」，不能用 NULL**：`uk_dim` 是普通唯一索引，MySQL 里 NULL 互不相等，
用 NULL 会让同一维度反复插行、越积越多。品类级口径即 `material_code='' AND print_mode=''`。

可调环境变量：`CALIBRATION_WINDOW_DAYS`（默认 180，统计窗口）/ `CALIBRATION_INTERVAL_HOURS`（默认 24，cron 重算间隔）。
`MIN_SAMPLE=30` 与分级表写在 `calibrationService.js` 里，是代码常量，改要发版。手动重算：

```powershell
node -e "require('./src/services/calibrationService').refresh().then(r => { console.log(r); process.exit(0); })"
```

重算失败不动已有校准行（先算完再批量 UPSERT），表不存在时启动阶段静默退化为「无校准数据」，报价照常可用。
线上核对：

```sql
SELECT product_type, material_code, print_mode, sample_n, bias, window_days, computed_at
  FROM quote_calibration ORDER BY sample_n DESC;
-- 配对样本总量（应与 refresh() 打印的「配对样本 N 笔」一致）
SELECT COUNT(*) FROM order_main o JOIN c_inquiry q ON q.id = o.inquiry_id
 WHERE o.unit_price > 0 AND o.created_at >= DATE_SUB(NOW(), INTERVAL 180 DAY);
```

**工厂侧新接口**（`src/routes/factorySelf.js`，鉴权均为 `X-Factory-*`）：

| 接口 | 用途 |
|---|---|
| `GET /api/factory/me/community-requests` | 工作台「待你答价的求助」：按本方产能打分排序，只出 7 天内、未被采纳、自己没答过的帖 |
| `GET /api/factory/me/quote-accuracy` | 本厂历史报价 vs 平台估价的偏差（近 180 天，样本不足只给「积累中」） |
| `GET /api/factory/me/trust` | 本厂验真等级 + 同行获单率对比（`MIN_PEER_PUSHES=10`，文案里带推送量） |

社区求助是答价与社区声望**唯一的数据来源**：工厂端此前没有社区入口，只能自己去 C 端碰运气，
反哺撮合的分数一直是空的。该接口失败时端上静默（社区是增量能力，不能拖停接单主流程）。

**信任徽章（`src/utils/trust.js`）**把 `verification_level` 与旧的 `license_verified` 归并成 0~3：
0 不出徽章 / 1 执照已核验 / 2 实地验厂 / 3 深度验厂。展示位：结果页撮合卡片、找厂列表（找厂页另有
「只看已验真」筛选，后端 `GET /api/factory/list?verified=1`）、工厂工作台顶部条。

**撮合没有做验真硬门槛**，这是有意的取舍：线上 53 家开 C 端的工厂里 `verification_level=0` 的有 41 家、
有过审资质图集（`media_type='certificate' AND audit_status='approved'`）的 0 家。硬门槛会让 77% 的工厂
永久失去曝光、让大量询价「匹配到 0 家工厂」。所以信任只作排序权重：
`已关注 → 闲置产能 → 评分 → 验真等级 → 接单率 → 工艺命中 → 社区分`。
验真率上来之后要收紧，改 `matchService.createCInquiry` 那一行排序 + 在 `capableIds` 后加过滤即可。

上线前先确认两套字段没有分叉（`license_verified=1` 但 `verification_level=0` 属历史数据，归一后会算 L1）：

```sql
SELECT verification_level, license_verified, COUNT(*) FROM factory WHERE status = 1 GROUP BY 1,2;
-- 有执照却没核验等级的（这些厂在端上显示「执照已核验」，需运营补等级）
SELECT id, name FROM factory WHERE status = 1 AND license_verified = 1 AND verification_level = 0;
```

### 14.12 校准区间（成交单价带）与找厂缺省序

样本攒到 30 笔之前，校准回路此前只会说「样本积累中」——真实信息被一句占位语吃掉。
所以新增两列，让 8 笔以上就能给出**成交单价区间**（区间自带「不确定」语义，不需要宣称偏差率）：

```sql
ALTER TABLE quote_calibration
  ADD COLUMN actual_unit_min decimal(12, 4) NULL DEFAULT NULL AFTER bias_max,
  ADD COLUMN actual_unit_max decimal(12, 4) NULL DEFAULT NULL AFTER actual_unit_min;
-- 已有库还需要重跑一次，把新列填上
node -e "require('./src/services/calibrationService').refresh()"
```

对外口径（`calibrationService.confidenceOf`）：

| 样本数 N | 文案 | level |
| --- | --- | --- |
| 0 | 样本积累中，暂无校准数据 | none |
| 1–7 | 样本积累中（已收集 N 笔成交） | none |
| 8–29 | 同类成交单价 ¥1.71–¥2.06（9 笔，近 180 天）+「历史成交区间，非报价承诺」 | none |
| ≥30 | 同类成交 N 笔，实际成交价平均低于平台估价 x%；成交 ¥…–¥… | low/medium/high |

- **门槛定 8**（`MIN_BAND_SAMPLE`）：两三笔的 min/max 就是那两三笔本身，等于把个案当行情。
- **偏差率门槛仍是 30**（`MIN_SAMPLE`）：区间可以给，偏差不许宣称，两件事不混。
- **小数位**剪尾零但至少保两位：`¥1.71–¥1.80`、`¥0.031–¥0.039` 都不失真。
- **免责句**只随区间的存在出现，端上两处渲染：结果页 `.price-disc`、社区详情 `.de-note-disc`。
- `bias_min/bias_max` 是**偏差率**，乘不出真实单价（每笔的 engine_i 不同），所以区间必须另存两列。

`refresh()` 会顺手清掉「本轮没算出来」的旧维度（按主键差集）：样本滑出 180 天窗口后，
旧行若一直留着，报价入口会拿过期区间当行情（内存缓存是唯一来源，没人去比对 `computed_at`）。
`computed_at` 一律写 `NOW()` 而不是驱动传 `Date`——本机 MySQL 的 `SYSTEM` 时区与驱动口径差 8 小时，
拿两者比大小会静默失效（第一版就是用它做清理条件，结果一行都没删掉）。

找厂列表（`GET /api/factory/list`）缺省序补上验真，与结果页撮合链同思路：
`rating DESC, (license_verified = 1 OR verification_level >= 1) DESC, total_accepts DESC`。
评分仍是第一权重，所以**已验真但评分 4.33 的厂会排到 5 星未验真厂之后**（实测：前 11 位全是已验真，
第 12 位是 5 星未验真）。这是有意的：评分来自真实成交评价，比一纸核验更能代表履约能力。

核对：

```sql
SELECT COUNT(*) FROM factory WHERE status = 1 AND (license_verified = 1 OR verification_level >= 1);
SELECT product_type, material_code, print_mode, sample_n, actual_unit_min, actual_unit_max, computed_at
  FROM quote_calibration ORDER BY sample_n DESC LIMIT 20;
```

### 14.13 工厂详情电话「登录即可查看 + 一键拨打」与直拨开关

**口径变更**：旧的 F-30 是「详情页电话一律脱敏，必须询价看价后才给完整号码」。
实际运行时客户想先问一句「能不能做 500 个异形盒」就要先走完整报价流程，非标品场景第一步就被卡住。
新口径三档：

| 访问者 / 工厂设置 | 下发 phone | phoneVisible | 端上按钮 |
| --- | --- | --- | --- |
| 匿名 | 脱敏 | false | 「查看号码」→ 弹登录 |
| 已登录 + 工厂接受直拨（默认） | 明文 | true | 「拨打」→ `wx.makePhoneCall` |
| 已登录 + 工厂关掉直拨 | 脱敏 | false | 不显示按钮，提示「可发起询价」 |

判定只在服务端做一次（`GET /api/factory/public/:id`）：`phoneVisible = !!req.user && accept_direct_call !== 0`。
端上不再靠「字符串里有没有 *」猜，直接读 `phoneVisible` / `acceptDirectCall`。
该接口挂 `optionalUser` 而不是 `requireUser`：未登录也必须能看工厂页，只是看不到号码；带无效 token 也照常 200。

**要跑的 SQL（先于发版执行，否则详情页 SELECT 报 Unknown column）**：

```sql
ALTER TABLE `factory`
  ADD COLUMN `accept_direct_call` tinyint(0) NOT NULL DEFAULT 1
  COMMENT '是否接受客户在详情页直接拨打：1=接受直拨（默认）0=只走询价';
```

53 家存量厂默认全部开启（不发一声就不让客户打电话，比默认关闭更符合「工厂想接单」的本意；
介意骚扰的厂自己在工厂端关掉）。`init.sql` 里该列**只能加在表末尾**：种子数据是
`INSERT INTO factory VALUES (...)` 的位置无关写法，插在中间会让 53 行整体错位。

**工厂端开关**（`我的工厂 → 资料 → 是否接受客户直拨`）：复用 `.cap-item` 芯片（不引入原生 switch），
点选即存、失败回滚页面选中态。后端 `PUT /api/factory/me/profile` 用白名单校验而不是 `Number()`：
`Number('')` 和 `Number(null)` 都是 0，空值会被静默当成「关闭」；所以只接受 `0/1/'0'/'1'`，
其余一律 400「是否接受直拨只能选「是」或「否」」。仍遵循「显式传了才写这一列」——
只改开关不会把联系人/电话/地址清空。后台「编辑工厂」暂不提供该开关（电话归工厂自己管）。

**顺手修掉的真 bug：`maskPhone` 对固话完全不脱敏。**
旧实现用 `/^\d{7,}$/` 判固话，而线上工厂电话大多是 `0577-64228225` 这种带区号横杠的格式，
一条都不匹配 → 原样返回。实测 53 家在营厂里 52 家有电话，其中 **13 家是带区号横杠的固话
（`0577-64228225` 这种），在找厂列表与详情页一直明文外泄**（旧脱敏只对纯数字手机号生效）。
新实现先归一成纯数字再判断：

| 输入 | 输出 |
| --- | --- |
| `13712345678` | `137****5678` |
| `0577-64228225` | `0577****8225`（保留区号，客户能认出是哪里的厂） |
| `+86 138 0013 8000` | `138****8000`（先剥国家码） |
| `6422822`（7 位短号） | `64****22` |
| `待核实` / `见微信` / 空 | 原样返回（不含数字的占位文本，不打码） |

注意另外 13 家厂的 phone 字段填的是「待核实」这种占位文本（不是号码），`maskPhone` 原样返回是对的，
端上照原样显示，不要当真号码去拨。

**自测**（临时脚本已删，40/40 通过）：匿名脱敏且 200 / 登录明文且与库一致 / 坏 token 仍 200 且脱敏 /
工厂关开关后登录用户也脱敏 / 只改开关不清电话 / 非法值 `2 -1 "abc" "" null true` 全部 400 且库不变 /
重开后恢复明文 / `/list` 仍下发电话且保持脱敏（一键拨打留给「列表并列电话」那一项）/
测试会话与开关全部复位、工厂数与电话未变。

**局限**：
- 找厂列表卡片的电话入口见 14.14（同一口径，卡片上多了电话按钮）。
- 13 家厂的 phone 是「待核实」占位文本：详情页照原样显示，但不给拨打/查看按钮（`phoneUsable` 按「含数字」判定）。
- 电话改动无法审计：`accept_direct_call` 没进 `opLog`，工厂点几次开关都查不到痕迹。
- 拨号是 `wx.makePhoneCall`，用户直接跳到系统拨号盘，平台拿不到「有无真正拨出」的转化数据。

核对：

```sql
SELECT accept_direct_call, COUNT(*) FROM factory WHERE status = 1 GROUP BY accept_direct_call;
SELECT id, name, phone FROM factory WHERE status = 1 AND phone REGEXP '-';
```

### 14.14 找厂列表卡片电话入口（14.13 的列表侧）

卡片底部由单个「报价 →」改成**电话（主）+ 报价（次）并列**（`fi-actions` / `fi-btn-cell`）：
电话是拿单最快的一步，询价仍保留为次按钮。

- 口径与详情页**同一套**：`/api/factory/list` 现在也返回 `phoneVisible` / `acceptDirectCall`，
  规则同样是「登录 && `accept_direct_call` !== 0 才下发明文」，两边不会出现「列表能拨、详情打码」的错位。
  两侧各算一次（列表批量、详情单条），没有抽公共函数——规则只有两行且都基于 `FACTORY_C_COLS` 的行，
  抽出去反而多一层要维护的间接。
- 端上三态：接受直拨 → 主按钮「拨打电话 / 查看号码」；关直拨 → **不显示电话按钮**，只剩询价，
  下方一行灰字说明「该厂暂不接受直接拨打」；没号码（含「待核实」占位）→ 同样只剩询价，不解释。
- 未登录点「查看号码」走 `askLogin()`；登录回来 `onShow` 会重拉列表（既有行为），号码随之变明文。
- `quickQuote` 拆出 `gotoQuote(id)`：关直拨的弹窗「去询价」要复用同一个跳转，不造假 event 再转一手。

**自测**（临时脚本已删，17/17 通过）：匿名 50 条全脱敏 / 登录后 `phoneVisible` 与工厂开关逐条一致、
可见厂号码与库一致 / 目标厂登录明文（`0577-64228225`）匿名脱敏（`0577****8225`）/
占位文本「待核实」原样下发且不含数字 / 工厂关直拨后该厂在列表里立刻脱敏 / 坏 token 仍 200 且全 false /
会话与开关复位、电话未变。

**卡片上不印号码**：曾把明文号码以浅灰小字印在按钮上方、支持长按复制，随后按产品要求撤下，只留按钮直接跳拨号盘；
号码文本的展示仍只在详情页（14.13）。撤下原因未记录，代码层面的取舍是：列表一屏 50 家，印出来等于批量可抄、可转发，
详情页一次只看一家，暴露面小得多。要不要恢复是产品决定，恢复时只需加回 wxml 的一行 `{{item.phone}}` 与 `.fi-phone` 样式。

**局限**：
- 客户在列表页拿不到号码文本，没法复制或转发给同事，只能自己拨。
- 未做增量刷新：每次进找厂页都整页重拉（列表原本就在 `onShow` 拉，没为此新增请求）。

### 14.15 工厂详情页吸顶 tab：点了滚到位、高亮却不跟

**症状**：点「能力 / 图集 / 视频」页面确实滚到了对应内容，但顶部 tab 的高亮仍停在「概况」。

**根因**（两个叠加，缺一个都不至于）：`onTabTap` 先 `setData({activeTab: key})` 再 `pageScrollTo`，
滚动过程中 `onPageScroll` 会逐帧反算当前段——`pageScrollTo` 是从当前滚动位置一路滚到目标段的，**必然先经过前面的段**，
于是刚点亮的目标被反算回「概况」；而 `onPageScroll` 原本有 120ms 节流，220ms 动画的**末帧正好落在节流窗口内被丢掉**，
最后一帧没能把高亮改回目标段。表现就是「滚到了、但没切」（不是没滚动，也不是没改 activeTab）。

**改法**（`factory-detail.js`）：

- 点击后 `lockActive(600)` 锁住高亮，`onPageScroll` 在锁定期内直接返回，不参与反算；
  `pageScrollTo` 的 `complete` 里再以点击目标为准 `setData` 一次，并延长 200ms 锁 + 120ms 后补测一次偏移。
- 去掉 `onPageScroll` 的节流：只是一次 4 段比较，只有结论变化才 `setData`（越界最多 4 次），
  不会出现「末帧被吞」。
- `measureSegments` 每次点击前重测一次（段位置会随渲染漂移），顺带量 `#fd-page` 容器记下**最大可滚距离**：
  末段不足一屏时它自己的 `top` 永远滚不到（滚到底还差一截），所以「滚到底」直接判定为最后一段。
  这里量容器而不是最后一段的底边——段底下面还有底部操作条和 `page-tab` 的 200rpx 留白，用段底会偏小。
- `#fd-page` 是给上面这步查询新加的 id，没有样式含义。

**自测**（临时脚本已删，13/13 通过，node 里仿真 `pageScrollTo` 逐帧滚动）：点能力/图集/视频后高亮分别是能力/图集/视频；
点视频（其 top 超出可滚距离）被 clamp 到底后高亮仍是视频；手动滑到 1200 高亮能力、滑到底高亮视频、回顶高亮概况；
从顶一路滑到底 `setData` 次数 ≤ 4。

**局限**：
- 仿真只覆盖「偏移 → 高亮」的判定逻辑，真机的 `pageScrollTo` 缓动、`onPageScroll` 触发频率仍需手动看一次。
- `.fd-tabs` 仍是 `position: sticky; top: 0`：吸顶后会贴到屏幕最上沿、和状态栏文字重叠（滚动后才看得到，
  未吸顶时正常）。要治得把 `top` 设成状态栏高度并把 `tops` 的基准一起减掉，这次没动，属独立视觉问题。
