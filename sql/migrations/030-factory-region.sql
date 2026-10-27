-- 030: 工厂地区字段(省/市结构化)
-- 注：MySQL 8.0 不支持 ADD COLUMN / ADD INDEX 的 IF NOT EXISTS 语法（属 MariaDB），
--     幂等由 scripts/migrate.js 的 schema_migrations 登记表保证。
ALTER TABLE `factory` ADD COLUMN `province` varchar(50) DEFAULT NULL COMMENT '省';
ALTER TABLE `factory` ADD COLUMN `city` varchar(50) DEFAULT NULL COMMENT '市';
ALTER TABLE `factory` ADD INDEX `idx_region` (`province`, `city`);
