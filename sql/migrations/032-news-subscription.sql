-- 032: 用户资讯订阅（分类偏好 + 推送开关）
CREATE TABLE IF NOT EXISTS `user_news_subscription` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT 'C端用户',
  `category` varchar(32) NOT NULL COMMENT 'policy|market|tech|material 或 all',
  `enabled` tinyint NOT NULL DEFAULT 1 COMMENT '是否推送',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_cat` (`user_id`, `category`),
  INDEX `idx_cat` (`category`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户资讯订阅分类';
