-- 034: 工厂验真分级
-- 0=未核验 / 1=营业执照已核 / 2=实地/视频验厂 / 3=深度验厂(多年合作+评分)
ALTER TABLE `factory` ADD COLUMN `verification_level` tinyint NOT NULL DEFAULT 0 COMMENT '验真分级 0/1/2/3';
ALTER TABLE `factory` ADD COLUMN `verification_note` varchar(200) DEFAULT NULL COMMENT '审核备注';
ALTER TABLE `factory` ADD COLUMN `verified_at` datetime DEFAULT NULL COMMENT '最近核验时间';
ALTER TABLE `factory` ADD INDEX `idx_verif` (`verification_level`);
