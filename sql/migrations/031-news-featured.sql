-- 031: 行业资讯增强（编辑推荐 + 关键词）
-- 用于 admin 端"编辑推荐"面板 + 小程序首页"精选资讯"位
ALTER TABLE `industry_news` ADD COLUMN `featured` tinyint NOT NULL DEFAULT 0 COMMENT '是否精选 0/1';
ALTER TABLE `industry_news` ADD COLUMN `editor_note` varchar(300) DEFAULT NULL COMMENT '编辑推荐语';
ALTER TABLE `industry_news` ADD COLUMN `editor_id` bigint DEFAULT NULL COMMENT '推荐管理员ID';
ALTER TABLE `industry_news` ADD COLUMN `keywords` varchar(200) DEFAULT NULL COMMENT '逗号分隔关键词';
ALTER TABLE `industry_news` ADD INDEX `idx_featured` (`featured`, `published_at`);
