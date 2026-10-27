-- 033: 供应商手动关注 + 备注标签
CREATE TABLE IF NOT EXISTS `supplier_follow` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL COMMENT 'C端用户',
  `factory_id` int NOT NULL COMMENT '工厂ID',
  `tags` varchar(200) DEFAULT NULL COMMENT '逗号分隔自定义标签',
  `note` varchar(300) DEFAULT NULL COMMENT '备注',
  `pinned` tinyint NOT NULL DEFAULT 0 COMMENT '是否置顶',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_factory` (`user_id`, `factory_id`),
  INDEX `idx_user` (`user_id`, `pinned`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户关注供应商';
