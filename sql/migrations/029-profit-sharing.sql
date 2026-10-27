-- 029: 交易担保(分账)
-- 注：MySQL 8.0 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS（该语法属 MariaDB），
--     幂等由 scripts/migrate.js 的 schema_migrations 登记表保证，此处不再判存在。
ALTER TABLE `order_main` ADD COLUMN `escrow_status` varchar(20) DEFAULT 'none'
  COMMENT '担保状态：none=无担保 frozen=资金冻结 released=已放款 refunded=已退款 partial_refund=部分退款';
ALTER TABLE `order_main` ADD COLUMN `platform_fee` decimal(10,2) DEFAULT NULL COMMENT '平台服务费';
ALTER TABLE `order_main` ADD COLUMN `factory_amount` decimal(10,2) DEFAULT NULL COMMENT '工厂实收金额';
ALTER TABLE `order_main` ADD COLUMN `profit_sharing_no` varchar(64) DEFAULT NULL COMMENT '微信分账单号';
ALTER TABLE `order_main` ADD COLUMN `released_at` datetime DEFAULT NULL COMMENT '放款时间';

CREATE TABLE IF NOT EXISTS `profit_sharing_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `action` varchar(20) DEFAULT NULL COMMENT 'initiate|query|return|finish',
  `request_body` json DEFAULT NULL,
  `response_body` json DEFAULT NULL,
  `success` tinyint DEFAULT 0,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分账操作日志';
