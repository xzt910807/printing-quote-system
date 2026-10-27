-- =====================================================
-- 清空开发期业务流水数据（保留账号、档案、参考/种子数据）
-- 适用：本地开发库与上线前的测试环境；确认无真实业务数据后再执行
--
-- 执行前务必备份：
--   线上：./scripts/backup.sh            （mysqldump 全库到 /var/backups/printing-quote/）
--   本地：node scripts/purge-biz-data.js          （不带参数即试运行，只列清单；--apply 会自动备份再清）
--
-- 用法：
--   mysql -u root -p printing_quote < sql/purge-biz-data.sql
--   或 node scripts/run-sql.js sql/purge-biz-data.sql   （无 mysql 命令行时用）
--
-- 【保留不动】删了会出事：
--   admin_user / factory_user / c_end_user  登录账号（删了后台和工厂端都进不去）
--   factory / factory_capability / factory_price_override / product_config / 各类材料费率工艺表
--       ^ init.sql 里带 INSERT 的参考种子，删了报价引擎直接没数据
--   customer(客户档案与折扣) / factory_invite_code(邀请码) / design_template(排版模板)
--   biz_seq(单号发号器)  保留计数器，避免清完后新单号与历史导出文件重号
--   schema_migrations    scripts/migrate.js 版本登记表，非业务数据
-- =====================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- C 端询价链路
TRUNCATE TABLE `c_inquiry`;                  -- 询价主表
TRUNCATE TABLE `c_inquiry_quote_view`;       -- 询价×报价 关联视图表
TRUNCATE TABLE `factory_inquiry_push`;       -- 询价推送工厂记录
TRUNCATE TABLE `inquiry_message`;            -- 询价会话 IM 消息

-- 报价 / 订单 / 物流 / 财务
TRUNCATE TABLE `quote_order`;                -- 报价单
TRUNCATE TABLE `order_main`;                 -- 订单
TRUNCATE TABLE `order_logistics`;            -- 订单物流轨迹
TRUNCATE TABLE `platform_fee_ledger`;        -- 平台服务费台账
TRUNCATE TABLE `daily_stats`;                -- 每日统计快照

-- 消息 / 会话 / 日志
TRUNCATE TABLE `c_message`;                  -- 站内信与订阅消息记录
TRUNCATE TABLE `user_session`;               -- 登录会话（执行后所有设备需重新登录）
TRUNCATE TABLE `factory_operation_log`;      -- 工厂员工操作日志

-- 用户上传类
TRUNCATE TABLE `factory_media`;              -- 工厂设备图文（磁盘文件见下方说明）
TRUNCATE TABLE `user_address`;               -- 收货地址

SET FOREIGN_KEY_CHECKS = 1;

-- 清理后核对：以下行数应全部为 0
SELECT 'c_inquiry' t, COUNT(*) n FROM `c_inquiry`
UNION ALL SELECT 'c_inquiry_quote_view', COUNT(*) FROM `c_inquiry_quote_view`
UNION ALL SELECT 'factory_inquiry_push', COUNT(*) FROM `factory_inquiry_push`
UNION ALL SELECT 'inquiry_message', COUNT(*) FROM `inquiry_message`
UNION ALL SELECT 'quote_order', COUNT(*) FROM `quote_order`
UNION ALL SELECT 'order_main', COUNT(*) FROM `order_main`
UNION ALL SELECT 'order_logistics', COUNT(*) FROM `order_logistics`
UNION ALL SELECT 'platform_fee_ledger', COUNT(*) FROM `platform_fee_ledger`
UNION ALL SELECT 'daily_stats', COUNT(*) FROM `daily_stats`
UNION ALL SELECT 'c_message', COUNT(*) FROM `c_message`
UNION ALL SELECT 'user_session', COUNT(*) FROM `user_session`
UNION ALL SELECT 'factory_operation_log', COUNT(*) FROM `factory_operation_log`
UNION ALL SELECT 'factory_media', COUNT(*) FROM `factory_media`
UNION ALL SELECT 'user_address', COUNT(*) FROM `user_address`
-- 保留表行数（应保持不变，用于确认没误删）
UNION ALL SELECT 'admin_user(保留)', COUNT(*) FROM `admin_user`
UNION ALL SELECT 'factory_user(保留)', COUNT(*) FROM `factory_user`
UNION ALL SELECT 'c_end_user(保留)', COUNT(*) FROM `c_end_user`
UNION ALL SELECT 'factory(保留)', COUNT(*) FROM `factory`
UNION ALL SELECT 'customer(保留)', COUNT(*) FROM `customer`
UNION ALL SELECT 'biz_seq(保留)', COUNT(*) FROM `biz_seq`;

-- 提示：TRUNCATE 只删库里的记录，不删磁盘文件。
-- 如需一并清掉上传件，人工确认后删除以下目录内容（头像/设计稿/工厂图文）：
--   uploads/avatars/   uploads/designs/   uploads/factory-media/
