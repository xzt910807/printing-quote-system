-- 026: 协同文件传输
CREATE TABLE IF NOT EXISTS `file_transfer` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
  `ref_type` varchar(20) NOT NULL COMMENT '关联类型：inquiry|order',
  `ref_id` bigint NOT NULL COMMENT '关联询价/订单ID',
  `sender_type` varchar(10) NOT NULL COMMENT '发送方：user|factory|admin',
  `sender_id` bigint NOT NULL COMMENT '发送方ID',
  `file_name` varchar(255) NOT NULL COMMENT '原始文件名',
  `file_url` varchar(500) NOT NULL COMMENT '存储相对路径',
  `file_size` int NOT NULL COMMENT '字节',
  `mime_type` varchar(100) DEFAULT NULL COMMENT 'MIME类型',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ref` (`ref_type`, `ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='协同文件传输记录';
