-- 028: 行业资讯
CREATE TABLE IF NOT EXISTS `industry_news` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `title` varchar(300) NOT NULL COMMENT '标题',
  `summary` varchar(500) DEFAULT NULL COMMENT '摘要',
  `content` text COMMENT '正文(HTML或纯文本)',
  `source_name` varchar(100) DEFAULT NULL COMMENT '来源名称',
  `source_url` varchar(500) DEFAULT NULL COMMENT '原文链接',
  `cover_image` varchar(500) DEFAULT NULL COMMENT '封面图',
  `category` varchar(50) DEFAULT 'market' COMMENT '分类：policy|market|tech|material',
  `published_at` datetime DEFAULT NULL COMMENT '原文发布时间',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_url` (`source_url`(200)),
  INDEX `idx_category` (`category`),
  INDEX `idx_published` (`published_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='行业资讯(RSS抓取)';
