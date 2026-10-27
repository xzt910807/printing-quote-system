-- =====================================================
-- 线上存量库补齐「印查查」四项功能结构（幂等，可反复执行）
-- 来源：原 027-yinchacha.sql（已归档 data/sql-migrations-backup-<日期>.zip），此处改写为判存版
--
-- ⚠️ 只作用于当前连接的库。请显式指定线上库名：
--      mysql -u <用户> -p <线上库名> < sql/online-add-yinchacha.sql
-- ⚠️ 绝对不要在生产库执行 sql/init.sql —— 它头部含 DROP DATABASE，会把整库删掉重建。
--      存量库的结构同步一律用本文件，或在服务器上用 node scripts/schema-sync.js --apply（只加不删）。
--
-- 与归档版的差异：ADD COLUMN 不加 AFTER 定位（避免线上缺 logo_url 时整条失败），
--                列顺序不影响业务代码（全部按列名读写）。
-- =====================================================

-- ---------- 1) 闲置产能状态（3 列） ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND COLUMN_NAME = 'capacity_status');
SET @s := IF(@c = 0,
  'ALTER TABLE `factory` ADD COLUMN `capacity_status` varchar(20) NOT NULL DEFAULT ''unknown'' COMMENT ''产能状态：idle=空闲 normal=正常 busy=饱和 unknown=未填报''',
  'SELECT ''capacity_status 已存在，跳过''');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND COLUMN_NAME = 'capacity_note');
SET @s := IF(@c = 0,
  'ALTER TABLE `factory` ADD COLUMN `capacity_note` varchar(100) DEFAULT NULL COMMENT ''产能备注（如"本周档期满""可接加急"）''',
  'SELECT ''capacity_note 已存在，跳过''');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND COLUMN_NAME = 'capacity_updated_at');
SET @s := IF(@c = 0,
  'ALTER TABLE `factory` ADD COLUMN `capacity_updated_at` timestamp NULL DEFAULT NULL COMMENT ''产能填报时间（超72h视为过期）''',
  'SELECT ''capacity_updated_at 已存在，跳过''');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------- 2) 工厂验真徽章 ----------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND COLUMN_NAME = 'license_verified');
SET @s := IF(@c = 0,
  'ALTER TABLE `factory` ADD COLUMN `license_verified` tinyint NOT NULL DEFAULT 0 COMMENT ''平台已核验资质徽章：1=已核验''',
  'SELECT ''license_verified 已存在，跳过''');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------- 3) 设备图文画像（建表天然幂等） ----------
CREATE TABLE IF NOT EXISTS `factory_media` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `factory_id` int NOT NULL COMMENT '工厂ID，关联 factory.id',
  `media_type` varchar(20) NOT NULL DEFAULT 'equipment' COMMENT '图片类型：equipment=设备 workshop=车间 product=样品',
  `url` varchar(500) NOT NULL COMMENT '图片相对路径（/uploads/factory-media/...）',
  `caption` varchar(100) DEFAULT NULL COMMENT '图注（如"海德堡对开机×2"）',
  `sort` int NOT NULL DEFAULT '0' COMMENT '排序（小在前）',
  `audit_status` varchar(20) NOT NULL DEFAULT 'approved' COMMENT '审核状态：pending=待审 approved=已过 rejected=驳回',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_factory_audit` (`factory_id`,`audit_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工厂设备/车间图文（C端详情图集）';

-- ---------- 4) IM 在线沟通（会话维度 = inquiry_id + factory_id） ----------
CREATE TABLE IF NOT EXISTS `inquiry_message` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `inquiry_id` bigint NOT NULL COMMENT '询价ID，关联 c_inquiry.id',
  `factory_id` int NOT NULL COMMENT '工厂ID，关联 factory.id（会话对家）',
  `sender_type` varchar(10) NOT NULL COMMENT '发送方：user=客户 factory=工厂',
  `sender_id` bigint NOT NULL COMMENT '发送者ID（user=c_end_user.id；factory=factory_user.id）',
  `content` varchar(500) NOT NULL COMMENT '消息内容',
  `is_read` tinyint NOT NULL DEFAULT '0' COMMENT '接收方是否已读 0否1是',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  PRIMARY KEY (`id`),
  KEY `idx_thread` (`inquiry_id`,`factory_id`,`id`),
  KEY `idx_unread_factory` (`factory_id`,`is_read`),
  KEY `idx_unread_user` (`inquiry_id`,`sender_type`,`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='询价会话消息（买卖双方 IM，会话键 inquiry×factory）';

-- ---------- 核对（应看到 4 行 capacity/license + 2 张表） ----------
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory'
  AND COLUMN_NAME IN ('capacity_status','capacity_note','capacity_updated_at','license_verified')
ORDER BY ORDINAL_POSITION;

SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('factory_media','inquiry_message');
