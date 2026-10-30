/*
 Navicat Premium Data Transfer

 Source Server         : test
 Source Server Type    : MySQL
 Source Server Version : 80039
 Source Host           : localhost:3306
 Source Schema         : printing_quote

 Target Server Type    : MySQL
 Target Server Version : 80039
 File Encoding         : 65001

 Date: 27/10/2026 10:27:40
*/

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Batch D0（2026-10-30）：本文件已并入 sql/migrations/026~034 的全部效果——
--   新表 5 张：issue_ticket / industry_news / user_news_subscription / supplier_follow / profit_sharing_log（按字母序就位，索引写在 CREATE TABLE 内）；
--   factory 加 province/city/verification_level/verification_note/verified_at，order_main 加 escrow_status/platform_fee/factory_amount/profit_sharing_no/released_at；
--   迁移文件已归档删除（data/sql-migrations-backup-20261030.zip），详见 docs/ops.md 第 1 节与第 11 节。

-- ----------------------------
-- Table structure for admin_user
-- ----------------------------
DROP TABLE IF EXISTS `admin_user`;
CREATE TABLE `admin_user`  (
  `id` int(0) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录名',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'scrypt: salt:hash',
  `nickname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '显示名',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin' COMMENT 'super=超级管理员(可管理账户) / admin=普通管理员',
  `status` tinyint(0) NOT NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '当前会话令牌(登录时刷新，单会话)',
  `token_expires` datetime(0) NULL DEFAULT NULL COMMENT '令牌过期时间（滑动续期，NULL=不限期）',
  `last_login_at` timestamp(0) NULL DEFAULT NULL,
  `created_at` timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_username`(`username`) USING BTREE,
  UNIQUE INDEX `uk_token`(`token`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 16 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '管理后台账户' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of admin_user
-- ----------------------------

-- ----------------------------
-- Table structure for biz_seq
-- ----------------------------
DROP TABLE IF EXISTS `biz_seq`;
CREATE TABLE `biz_seq`  (
  `name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` bigint(0) NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '业务单号递增序列' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of biz_seq
-- ----------------------------
INSERT INTO `biz_seq` VALUES ('bizno:CQ', 99);
INSERT INTO `biz_seq` VALUES ('bizno:CQ:20260925', 8);
INSERT INTO `biz_seq` VALUES ('bizno:CQ:20260928', 12);
INSERT INTO `biz_seq` VALUES ('bizno:CQ:20260929', 45);
INSERT INTO `biz_seq` VALUES ('bizno:CQ:20261019', 6);
INSERT INTO `biz_seq` VALUES ('bizno:CQ:20261020', 18);
INSERT INTO `biz_seq` VALUES ('bizno:OD', 6);
INSERT INTO `biz_seq` VALUES ('bizno:OD:20260925', 5);
INSERT INTO `biz_seq` VALUES ('bizno:OD:20260928', 1);
INSERT INTO `biz_seq` VALUES ('bizno:OD:20260929', 5);
INSERT INTO `biz_seq` VALUES ('bizno:OD:20261020', 8);

-- ----------------------------
-- Table structure for board_paper
-- ----------------------------
DROP TABLE IF EXISTS `board_paper`;
CREATE TABLE `board_paper`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '纸板编码，如 B_BC5',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '纸板名称，如 双坑BC楞',
  `flute` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '楞型代码：A/B/C/E/BC/BE/BCE',
  `layers` int(0) NULL DEFAULT NULL COMMENT '层数：3=三层 5=五层 7=七层',
  `price_per_sqm` decimal(10, 4) NOT NULL COMMENT '每平方米价格，单位 元/㎡',
  `supplier` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '纸板供应商',
  `is_local` tinyint(0) NULL DEFAULT 0 COMMENT '是否龙港本地：1=本地 0=外地',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用：1=启用 0=禁用',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '纸板价格表（按㎡计价，纸箱主力材质）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of board_paper
-- ----------------------------
INSERT INTO `board_paper` VALUES (1, 'B_B3', '单坑B楞', 'B', 3, 1.2500, '龙港纸板厂A', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `board_paper` VALUES (2, 'B_C3', '单坑C楞', 'C', 3, 1.3500, '龙港纸板厂A', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `board_paper` VALUES (3, 'B_E3', '单坑E楞', 'E', 3, 1.1000, '龙港纸板厂A', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `board_paper` VALUES (4, 'B_BC5', '双坑BC楞', 'BC', 5, 1.8500, '龙港纸板厂A', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `board_paper` VALUES (5, 'B_BE5', '双坑BE楞', 'BE', 5, 1.7000, '龙港纸板厂B', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `board_paper` VALUES (6, 'B_BCE7', '三坑BCE楞', 'BCE', 7, 2.4500, '龙港纸板厂B', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `board_paper` VALUES (7, 'B_A3', '单坑A楞', 'A', 3, 1.4500, '龙港纸板厂A', 1, 1, '2026-09-20 07:49:47', '2026-09-20 07:49:47');

-- ----------------------------
-- Table structure for c_end_user
-- ----------------------------
DROP TABLE IF EXISTS `c_end_user`;
CREATE TABLE `c_end_user`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `openid` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '微信openid（唯一）',
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'C端登录令牌',
  `token_expires` datetime(0) NULL DEFAULT NULL COMMENT '令牌过期时间（滑动续期，NULL=不限期）',
  `nickname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '微信昵称',
  `company` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '公司/单位名称（个人中心，询价带入）',
  `avatar_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '手机号',
  `company_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '公司名称',
  `source` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '来源渠道：miniapp/share/offline等',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'customer' COMMENT '身份：customer=普通客户 factory=工厂',
  `factory_id` int(0) NULL DEFAULT NULL COMMENT '绑定的工厂ID（role=factory 时有效）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `openid`(`openid`) USING BTREE,
  UNIQUE INDEX `token`(`token`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 35 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'C端用户表（小程序端）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of c_end_user
-- ----------------------------

-- ----------------------------
-- Table structure for c_inquiry
-- ----------------------------
DROP TABLE IF EXISTS `c_inquiry`;
CREATE TABLE `c_inquiry`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `inquiry_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '询价单号，如 CQ202609180001',
  `user_id` bigint(0) NULL DEFAULT NULL COMMENT 'C端用户ID，关联 c_end_user.id',
  `product_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '产品类型',
  `print_mode` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '印刷方式',
  `length_m` decimal(10, 4) NULL DEFAULT NULL COMMENT '长，单位 米',
  `width_m` decimal(10, 4) NULL DEFAULT NULL COMMENT '宽，单位 米',
  `height_m` decimal(10, 4) NULL DEFAULT NULL COMMENT '高，单位 米',
  `contact_phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '询价联系电话（推送时填写）',
  `contact_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '询价联系人（推送时填写）',
  `quantity` int(0) NULL DEFAULT NULL COMMENT '数量',
  `material_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '材料类型',
  `material_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '材料编码',
  `color_count` int(0) NULL DEFAULT 4 COMMENT '色数',
  `box_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '盒型：normal/lidBase/drawer（彩盒）',
  `n_up` int(0) NULL DEFAULT 1 COMMENT '拼版数量：一张大纸拼几个成品',
  `film_layers` int(0) NULL DEFAULT 1 COMMENT '软包装层数',
  `film_codes` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '软包装每层薄膜编码，逗号分隔',
  `processes` json NULL COMMENT '后道工艺数组',
  `system_quote` json NULL COMMENT '系统默认价计算的全套报价结果',
  `status` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'quoted' COMMENT '状态：quoted=已报价 matched=已推送 factory_quoted=工厂已报价 user_confirmed=用户已确认 accepted=工厂已接单(旧路径) converted=已转化',
  `matched_factory_id` int(0) NULL DEFAULT NULL COMMENT '最终匹配的工厂ID',
  `quoted_factory_id` int(0) NULL DEFAULT NULL COMMENT '选定工厂ID（撮合模式，选定后才可见报价）',
  `quoted_price` decimal(12, 2) NULL DEFAULT NULL COMMENT '用户看到的该厂报价',
  `quoted_at` timestamp(0) NULL DEFAULT NULL COMMENT '查看报价时间',
  `accepted_at` timestamp(0) NULL DEFAULT NULL COMMENT '工厂接单时间',
  `expires_at` datetime(0) NULL DEFAULT NULL COMMENT '报价有效期至（默认创建+7天）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `pattern_cover` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'mid' COMMENT '图案覆盖率：low/mid/high',
  `ink_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'NORMAL' COMMENT '油墨类型编码',
  `spot_colors` int(0) NULL DEFAULT 0 COMMENT '专色数量',
  `factory_quoted_price` decimal(12, 2) NULL DEFAULT NULL COMMENT '工厂正式报价金额（订单金额以此为准）',
  `factory_quoted_at` timestamp(0) NULL DEFAULT NULL COMMENT '工厂报价时间',
  `factory_quote_expires_at` datetime(0) NULL DEFAULT NULL COMMENT '工厂报价有效期',
  `factory_quote_remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '工厂报价备注（调价原因等）',
  `quote_revision` int(0) NOT NULL DEFAULT 1 COMMENT '工厂正式报价次数（首次=1, 客户确认前每改一次价 +1）',
  `prev_quoted_price` decimal(12, 2) NULL DEFAULT NULL COMMENT '被改价替换掉的上一版工厂报价（客户端展示议价前后对比）',
  `user_confirmed_at` timestamp(0) NULL DEFAULT NULL COMMENT '用户确认报价时间',
  `design_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT '设计需求：none=客户自带设计稿(可传稿图) public=用工厂公版 need=需要设计(描述+参考图+工厂单列设计费)',
  `design_note` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '设计需求描述（店名/风格/文案等，客户手填）',
  `design_images` json NULL COMMENT '设计参考图/排版成品图 URL 数组',
  `design_fee` decimal(10, 2) NULL DEFAULT NULL COMMENT '工厂正式报价中的设计费（元，017 报价流程填写）',
  `design_pdfs` json NULL COMMENT '印刷制版文件 URL 数组（排版工具产出的 PDF，随设计稿下发工厂）',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `inquiry_no`(`inquiry_no`) USING BTREE,
  INDEX `idx_user`(`user_id`) USING BTREE,
  INDEX `idx_status`(`status`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 30 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'C端询价记录表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of c_inquiry
-- ----------------------------

-- ----------------------------
-- Table structure for c_inquiry_quote_view
-- ----------------------------
DROP TABLE IF EXISTS `c_inquiry_quote_view`;
CREATE TABLE `c_inquiry_quote_view`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `inquiry_id` bigint(0) NOT NULL,
  `factory_id` int(0) NOT NULL,
  `user_id` bigint(0) NULL DEFAULT NULL,
  `viewed_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `selected` tinyint(0) NULL DEFAULT 0 COMMENT '是否最终选定该厂',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_inquiry`(`inquiry_id`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 4 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户查看工厂报价的记录' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of c_inquiry_quote_view
-- ----------------------------

-- ----------------------------
-- Table structure for c_message
-- ----------------------------
DROP TABLE IF EXISTS `c_message`;
CREATE TABLE `c_message`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` bigint(0) NOT NULL COMMENT '接收用户ID，关联 c_end_user.id',
  `type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system' COMMENT '消息类型：quote_accepted=工厂接单 system=系统通知',
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `content` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '内容',
  `ref_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '关联对象类型：inquiry/order',
  `ref_id` bigint(0) NULL DEFAULT NULL COMMENT '关联对象ID',
  `is_read` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否已读 0否1是',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_user_read`(`user_id`, `is_read`) USING BTREE,
  INDEX `idx_user_created`(`user_id`, `created_at`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 116 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'C端用户站内消息表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of c_message
-- ----------------------------

-- ----------------------------
-- Table structure for card_paper
-- ----------------------------
DROP TABLE IF EXISTS `card_paper`;
CREATE TABLE `card_paper`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '卡纸编码，如 CARD250',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '卡纸名称，如 250g白卡',
  `grammage` int(0) NOT NULL COMMENT '克重，单位 g/m²',
  `price_per_sqm` decimal(10, 4) NOT NULL COMMENT '每平方米价格，单位 元/㎡',
  `supplier` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '供应商名称',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用：1=启用 0=禁用',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 24 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '卡纸价格表（彩盒/卡片用）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of card_paper
-- ----------------------------
INSERT INTO `card_paper` VALUES (1, 'CARD250', '250g白卡', 250, 0.8500, '宁波中华纸业', 1, '2026-09-18 08:54:23');
INSERT INTO `card_paper` VALUES (2, 'CARD300', '300g白卡', 300, 1.0200, '宁波中华纸业', 1, '2026-09-18 08:54:23');
INSERT INTO `card_paper` VALUES (3, 'CARD350', '350g白卡', 350, 1.1800, '宁波中华纸业', 1, '2026-09-18 08:54:23');
INSERT INTO `card_paper` VALUES (4, 'COAT200', '200g铜版', 200, 0.6200, '金东纸业', 1, '2026-09-18 08:54:23');
INSERT INTO `card_paper` VALUES (5, 'COAT250', '250g铜版', 250, 0.7600, '金东纸业', 1, '2026-09-18 08:54:23');
INSERT INTO `card_paper` VALUES (6, 'KRAFT300', '300g牛皮纸', 300, 1.3500, '龙港A纸业', 1, '2026-09-20 06:50:47');
INSERT INTO `card_paper` VALUES (7, 'STK_COPPER', '铜版纸不干胶', 80, 0.7500, '金东纸业', 1, '2026-09-20 06:50:47');
INSERT INTO `card_paper` VALUES (8, 'STK_PET', '透明PET不干胶', 50, 1.6000, '浙江B材料', 1, '2026-09-20 06:50:47');
INSERT INTO `card_paper` VALUES (9, 'KRAFT120', '120g牛皮纸', 120, 0.8500, '龙港A纸业', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (10, 'KRAFT200', '200g牛皮纸', 200, 1.0500, '龙港A纸业', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (11, 'NW_80', '无纺布80g', 80, 8.0000, '龙港无纺布厂', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (12, 'NW_100', '无纺布100g', 100, 9.5000, '龙港无纺布厂', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (13, 'NW_120', '无纺布120g', 120, 11.0000, '龙港无纺布厂', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (14, 'HTF_FILM', '热转印花膜', 80, 5.5000, '龙港热转印材料', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (15, 'STK_SYNTH', '合成纸不干胶', 70, 1.3500, '金东纸业', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (16, 'STK_THERMAL', '热敏纸不干胶', 60, 1.2000, '金东纸业', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (17, 'STK_PETSILVER', 'PET哑银不干胶', 50, 1.8750, '浙江B材料', 1, '2026-09-20 07:49:47');
INSERT INTO `card_paper` VALUES (19, 'FOOD_CARD', '320g食品白卡', 320, 1.2800, '宁波中华纸业', 1, '2026-09-22 03:08:36');
INSERT INTO `card_paper` VALUES (20, 'FOOD_KRAFT', '300g食品牛皮卡', 300, 1.4500, '龙港A纸业', 1, '2026-09-22 03:08:36');
INSERT INTO `card_paper` VALUES (21, 'CUP_PE', '单PE淋膜杯纸', 250, 1.6500, '南亚材料', 1, '2026-09-22 03:08:36');
INSERT INTO `card_paper` VALUES (22, 'CUP_PLA', 'PLA淋膜杯纸', 250, 2.2000, '浙江C材料', 1, '2026-09-22 03:08:36');

-- ----------------------------
-- Table structure for community_category
-- ----------------------------
DROP TABLE IF EXISTS `community_category`;
CREATE TABLE `community_category`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版块编码（帖子按 code 关联，改 code 等于让老帖掉出版块）',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版块名称',
  `sort` int(0) NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
  `is_active` tinyint(0) NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用（停用后小程序不再列出，已有帖子不受影响）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 7 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '社区版块分类（Batch D4）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of community_category
-- 六个版块对齐印查查社区结构，后台可增删；新增版块只需在此补一行（或走后台「分类维护」）
-- ----------------------------
INSERT INTO `community_category` VALUES (1, 'experience', '经验交流', 10, 1, '2026-10-30 08:00:00');
INSERT INTO `community_category` VALUES (2, 'tech', '工艺问答', 20, 1, '2026-10-30 08:00:00');
INSERT INTO `community_category` VALUES (3, 'price', '报价求助', 30, 1, '2026-10-30 08:00:00');
INSERT INTO `community_category` VALUES (4, 'material', '素材模板', 40, 1, '2026-10-30 08:00:00');
INSERT INTO `community_category` VALUES (5, 'chat', '行业闲聊', 50, 1, '2026-10-30 08:00:00');
INSERT INTO `community_category` VALUES (6, 'demand', '供需信息', 60, 1, '2026-10-30 08:00:00');

-- ----------------------------
-- Table structure for community_comment
-- ----------------------------
DROP TABLE IF EXISTS `community_comment`;
CREATE TABLE `community_comment`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `post_id` bigint(0) NOT NULL COMMENT '所属帖子',
  `user_id` bigint(0) NOT NULL COMMENT '作者ID（按 author_type 分别指向 c_end_user / factory_user）',
  `author_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '作者身份：user=客户 factory=工厂员工（服务端由令牌推导，不采信请求体）',
  `factory_id` bigint(0) NULL DEFAULT NULL COMMENT '工厂ID（author_type=factory 时有值，用于亮工厂徽章）',
  `parent_id` bigint(0) NULL DEFAULT NULL COMMENT '父评论（一层回复，NULL=顶级评论）',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评论内容',
  `like_count` int(0) NOT NULL DEFAULT 0 COMMENT '点赞数（原子累加）',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'published' COMMENT 'published/pending/rejected/removed（分级审核与帖子同一套）',
  `audit_note` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '审核备注（驳回/下架原因，对作者可见）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `is_quote` tinyint(0) NOT NULL DEFAULT 0 COMMENT '1=工厂答价（带价格的结构化报价，Batch E）',
  `quote_price` decimal(12, 4) NULL DEFAULT NULL COMMENT '答价（元/个，仅工厂答价时有值）',
  `quote_valid_days` int(0) NULL DEFAULT NULL COMMENT '报价有效期天数（1-30，缺省 7）',
  `is_accepted` tinyint(0) NOT NULL DEFAULT 0 COMMENT '1=被帖主采纳（同一帖至多一条，服务层互斥）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_post`(`post_id`, `status`) USING BTREE,
  INDEX `idx_parent`(`parent_id`) USING BTREE,
  INDEX `idx_factory_quote`(`factory_id`, `is_quote`, `author_type`, `created_at`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '社区评论（Batch D4）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of community_comment
-- ----------------------------

-- ----------------------------
-- Table structure for community_favorite
-- ----------------------------
DROP TABLE IF EXISTS `community_favorite`;
CREATE TABLE `community_favorite`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `post_id` bigint(0) NOT NULL COMMENT '被收藏的帖子',
  `user_id` bigint(0) NOT NULL COMMENT '收藏人ID（按 author_type 解释）',
  `author_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '收藏人身份',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_post_user`(`post_id`, `author_type`, `user_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '社区收藏（Batch D4）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of community_favorite
-- ----------------------------

-- ----------------------------
-- Table structure for community_like
-- ----------------------------
DROP TABLE IF EXISTS `community_like`;
CREATE TABLE `community_like`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `target_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '点赞对象类型：post/comment',
  `target_id` bigint(0) NOT NULL COMMENT '点赞对象ID',
  `user_id` bigint(0) NOT NULL COMMENT '点赞人ID（按 author_type 解释）',
  `author_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '点赞人身份：客户与工厂员工的 id 各自独立自增，不纳入唯一键会互相顶掉',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_target`(`target_type`, `target_id`, `author_type`, `user_id`) USING BTREE,
  INDEX `idx_user`(`author_type`, `user_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '社区点赞（唯一键幂等，Batch D4）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of community_like
-- ----------------------------

-- ----------------------------
-- Table structure for community_post
-- ----------------------------
DROP TABLE IF EXISTS `community_post`;
CREATE TABLE `community_post`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` bigint(0) NOT NULL COMMENT '作者ID（按 author_type 分别指向 c_end_user / factory_user）',
  `author_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '作者身份：user=客户 factory=工厂员工（服务端由令牌推导，不采信请求体）',
  `factory_id` bigint(0) NULL DEFAULT NULL COMMENT '工厂ID（author_type=factory 时有值，用于亮工厂徽章与工厂主页跳转）',
  `category_code` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版块编码（community_category.code）',
  `title` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '正文',
  `images` json NULL COMMENT '图片地址数组（/uploads/community/ 前缀，最多 9 张）',
  `video_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '视频地址（/uploads/community/ 前缀）',
  `cover_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '视频封面',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending/published/rejected/removed（表默认 pending：宁可不出现也不能漏审）',
  `audit_note` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '审核备注（先发后审留痕与驳回原因，对作者可见）',
  `view_count` int(0) NOT NULL DEFAULT 0 COMMENT '详情页浏览量（同身份 60 秒去重，允许不准）',
  `like_count` int(0) NOT NULL DEFAULT 0 COMMENT '点赞数（与 community_like 行数严格一致）',
  `comment_count` int(0) NOT NULL DEFAULT 0 COMMENT '评论数（只统计 published）',
  `favorite_count` int(0) NOT NULL DEFAULT 0 COMMENT '收藏数',
  `report_count` int(0) NOT NULL DEFAULT 0 COMMENT '被举报次数（同一举报人对同一目标只计一次）',
  `is_top` tinyint(0) NOT NULL DEFAULT 0 COMMENT '1=置顶（后台运营位，信息流排前）',
  `is_essence` tinyint(0) NOT NULL DEFAULT 0 COMMENT '1=加精（后台运营位，列表亮徽章）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '发布时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  `spec` json NULL COMMENT '结构化规格（报价求助/供需用）：productType/printMode/lengthMm/widthMm/heightMm/quantity/materialCode/processes/boxType/nUp/filmLayers',
  `estimate` json NULL COMMENT '发帖时按平台计价模型算出的参考价快照（unitPrice/finalPrice/breakdown/calculatedAt），无规格或算不出为 NULL',
  `accepted_comment_id` bigint(0) NULL DEFAULT NULL COMMENT '帖主采纳的报价评论 id（社区反哺撮合的唯一强信号）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_feed`(`status`, `is_top`, `is_essence`, `created_at`) USING BTREE,
  INDEX `idx_cat`(`category_code`, `status`) USING BTREE,
  INDEX `idx_author`(`author_type`, `user_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '社区帖子（Batch D4，分级审核）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of community_post
-- ----------------------------

-- ----------------------------
-- Table structure for community_report
-- ----------------------------
DROP TABLE IF EXISTS `community_report`;
CREATE TABLE `community_report`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `target_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '举报对象类型：post/comment',
  `target_id` bigint(0) NOT NULL COMMENT '举报对象ID',
  `reporter_id` bigint(0) NOT NULL COMMENT '举报人ID（按 reporter_type 解释）',
  `reporter_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '举报人身份',
  `reason` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'porn/ad/abuse/fake/other',
  `detail` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '补充说明',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending/handled/dismissed',
  `handler_id` bigint(0) NULL DEFAULT NULL COMMENT '处置人（admin_user.id）',
  `handle_note` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '处置备注',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '举报时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_reporter`(`target_type`, `target_id`, `reporter_type`, `reporter_id`) USING BTREE,
  INDEX `idx_status`(`status`, `created_at`) USING BTREE,
  INDEX `idx_target`(`target_type`, `target_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 1 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '社区举报（Batch D4，唯一键使同人重复举报不能刷回退阈值）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of community_report
-- ----------------------------

-- ----------------------------
-- Table structure for customer
-- ----------------------------
DROP TABLE IF EXISTS `customer`;
CREATE TABLE `customer`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `factory_id` int(0) NULL DEFAULT 0 COMMENT '所属工厂ID（0=系统默认）',
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '客户名称',
  `contact` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系人',
  `phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系电话',
  `address` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '客户地址',
  `level` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'normal' COMMENT '客户等级：normal=普通 vip=VIP',
  `discount` decimal(5, 4) NULL COMMENT '专属折扣率，如0.05=5%',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 3 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'B端客户表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of customer
-- ----------------------------

-- ----------------------------
-- Table structure for daily_stats
-- ----------------------------
DROP TABLE IF EXISTS `daily_stats`;
CREATE TABLE `daily_stats`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `stat_date` date NOT NULL COMMENT '统计日期',
  `new_inquiries` int(0) NULL DEFAULT 0 COMMENT '新增询价数',
  `quote_views` int(0) NULL DEFAULT 0 COMMENT '看价次数（c_inquiry_quote_view）',
  `factory_selected` int(0) NULL DEFAULT 0 COMMENT '选定工厂次数',
  `inquiries_accepted` int(0) NULL DEFAULT 0 COMMENT '接单数',
  `new_orders` int(0) NULL DEFAULT 0 COMMENT '新成交订单数',
  `order_amount` decimal(14, 2) NULL COMMENT '成交金额',
  `new_users` int(0) NULL DEFAULT 0 COMMENT '新增用户',
  `new_factories` int(0) NULL DEFAULT 0 COMMENT '新增工厂',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_date`(`stat_date`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 893 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '每日运营指标（F-77/F-78）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of daily_stats
-- ----------------------------

-- ----------------------------
-- Table structure for design_template
-- ----------------------------
DROP TABLE IF EXISTS `design_template`;
CREATE TABLE `design_template`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `product_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '适用产品类型（nonWovenBag/paperBag 等）',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `canvas` json NOT NULL COMMENT '画布与文字槽位布局',
  `is_active` tinyint(0) NOT NULL DEFAULT 1 COMMENT '启用状态',
  `sort` int(0) NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  `size_w_mm` int(0) NOT NULL DEFAULT 0 COMMENT '成品宽 mm（0=未配置，渲染维持原 1800x2400 逻辑稿）',
  `size_h_mm` int(0) NOT NULL DEFAULT 0 COMMENT '成品高 mm',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_product`(`product_type`, `is_active`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 14 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '设计排版模板（参数化文字排版，覆盖印字类需求）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of design_template
-- ----------------------------
INSERT INTO `design_template` VALUES (1, 'nonWovenBag', '经典大字款（藏青底白字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#172554\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#93c5fd\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 240, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 84, \"align\": \"center\", \"color\": \"#bfdbfe\", \"label\": \"副标题/Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 96, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"联系电话\"}]}', 1, 1, '2026-10-19 08:22:16', '2026-10-20 04:05:15', 300, 400);
INSERT INTO `design_template` VALUES (2, 'nonWovenBag', '清新抹茶款（绿底白字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#047857\", \"lines\": [{\"x\": 650, \"y\": 1080, \"x2\": 1150, \"width\": 8, \"stroke\": \"#a7f3d0\"}], \"texts\": [{\"x\": 900, \"y\": 980, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1160, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#d1fae5\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 96, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"联系电话\"}]}', 1, 2, '2026-10-19 08:22:16', '2026-10-20 04:05:15', 300, 400);
INSERT INTO `design_template` VALUES (3, 'paperBag', '牛皮简约款（牛皮底深棕字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#c8a06e\", \"lines\": [{\"x\": 650, \"y\": 1110, \"x2\": 1150, \"width\": 8, \"stroke\": \"#5b4232\"}], \"texts\": [{\"x\": 900, \"y\": 1020, \"key\": \"title\", \"max\": 8, \"size\": 210, \"align\": \"center\", \"color\": \"#3f2d1e\", \"label\": \"品牌/店名\"}, {\"x\": 900, \"y\": 1200, \"key\": \"sub\", \"max\": 16, \"size\": 78, \"align\": \"center\", \"color\": \"#5b4232\", \"label\": \"副标题\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#3f2d1e\", \"label\": \"联系电话\"}]}', 1, 1, '2026-10-19 08:22:16', '2026-10-20 04:05:15', 225, 300);
INSERT INTO `design_template` VALUES (4, 'nonWovenBag', '奶白简约款（奶白底墨字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#faf6ef\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#b91c1c\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#1c1917\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#78716c\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#1c1917\", \"label\": \"联系电话\"}]}', 1, 3, '2026-10-20 02:03:19', '2026-10-20 04:05:15', 300, 400);
INSERT INTO `design_template` VALUES (5, 'nonWovenBag', '酒红金字款（酒红底金字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#7f1d1d\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#fde68a\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#fde68a\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#fecaca\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#fde68a\", \"label\": \"联系电话\"}]}', 1, 4, '2026-10-20 02:03:19', '2026-10-20 04:05:15', 300, 400);
INSERT INTO `design_template` VALUES (6, 'nonWovenBag', '碳黑活力橙款（黑底橙字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#18181b\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#fb923c\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#fb923c\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#d4d4d8\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#fb923c\", \"label\": \"联系电话\"}]}', 1, 5, '2026-10-20 02:03:19', '2026-10-20 04:05:15', 300, 400);
INSERT INTO `design_template` VALUES (7, 'paperBag', '米白文艺款（米白底深灰字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#f1e9d7\", \"lines\": [{\"x\": 650, \"y\": 1110, \"x2\": 1150, \"width\": 8, \"stroke\": \"#a16207\"}], \"texts\": [{\"x\": 900, \"y\": 1020, \"key\": \"title\", \"max\": 8, \"size\": 210, \"align\": \"center\", \"color\": \"#3f3f46\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1200, \"key\": \"sub\", \"max\": 16, \"size\": 78, \"align\": \"center\", \"color\": \"#71717a\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#3f3f46\", \"label\": \"联系电话\"}]}', 1, 2, '2026-10-20 02:03:19', '2026-10-20 04:05:15', 225, 300);
INSERT INTO `design_template` VALUES (8, 'paperBag', '墨绿金字款（墨绿底白字金线）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#14532d\", \"lines\": [{\"x\": 650, \"y\": 1110, \"x2\": 1150, \"width\": 8, \"stroke\": \"#fbbf24\"}], \"texts\": [{\"x\": 900, \"y\": 1020, \"key\": \"title\", \"max\": 8, \"size\": 210, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1200, \"key\": \"sub\", \"max\": 16, \"size\": 78, \"align\": \"center\", \"color\": \"#bbf7d0\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"联系电话\"}]}', 1, 3, '2026-10-20 02:03:19', '2026-10-20 04:05:15', 225, 300);
INSERT INTO `design_template` VALUES (9, 'nonWovenBag', '奶白简约款（奶白底墨字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#faf6ef\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#b91c1c\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#1c1917\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#78716c\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#1c1917\", \"label\": \"联系电话\"}]}', 1, 3, '2026-10-22 06:05:57', '2026-10-22 06:05:57', 0, 0);
INSERT INTO `design_template` VALUES (10, 'nonWovenBag', '酒红金字款（酒红底金字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#7f1d1d\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#fde68a\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#fde68a\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#fecaca\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#fde68a\", \"label\": \"联系电话\"}]}', 1, 4, '2026-10-22 06:05:57', '2026-10-22 06:05:57', 0, 0);
INSERT INTO `design_template` VALUES (11, 'nonWovenBag', '碳黑活力橙款（黑底橙字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#18181b\", \"lines\": [{\"x\": 650, \"y\": 1100, \"x2\": 1150, \"width\": 8, \"stroke\": \"#fb923c\"}], \"texts\": [{\"x\": 900, \"y\": 1000, \"key\": \"title\", \"max\": 8, \"size\": 220, \"align\": \"center\", \"color\": \"#fb923c\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1180, \"key\": \"sub\", \"max\": 16, \"size\": 80, \"align\": \"center\", \"color\": \"#d4d4d8\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#fb923c\", \"label\": \"联系电话\"}]}', 1, 5, '2026-10-22 06:05:57', '2026-10-22 06:05:57', 0, 0);
INSERT INTO `design_template` VALUES (12, 'paperBag', '米白文艺款（米白底深灰字）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#f1e9d7\", \"lines\": [{\"x\": 650, \"y\": 1110, \"x2\": 1150, \"width\": 8, \"stroke\": \"#a16207\"}], \"texts\": [{\"x\": 900, \"y\": 1020, \"key\": \"title\", \"max\": 8, \"size\": 210, \"align\": \"center\", \"color\": \"#3f3f46\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1200, \"key\": \"sub\", \"max\": 16, \"size\": 78, \"align\": \"center\", \"color\": \"#71717a\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#3f3f46\", \"label\": \"联系电话\"}]}', 1, 2, '2026-10-22 06:05:57', '2026-10-22 06:05:57', 0, 0);
INSERT INTO `design_template` VALUES (13, 'paperBag', '墨绿金字款（墨绿底白字金线）', '{\"h\": 2400, \"w\": 1800, \"bg\": \"#14532d\", \"lines\": [{\"x\": 650, \"y\": 1110, \"x2\": 1150, \"width\": 8, \"stroke\": \"#fbbf24\"}], \"texts\": [{\"x\": 900, \"y\": 1020, \"key\": \"title\", \"max\": 8, \"size\": 210, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"店名/主标题\"}, {\"x\": 900, \"y\": 1200, \"key\": \"sub\", \"max\": 16, \"size\": 78, \"align\": \"center\", \"color\": \"#bbf7d0\", \"label\": \"主营/ Slogan\"}, {\"x\": 900, \"y\": 2150, \"key\": \"phone\", \"max\": 20, \"size\": 92, \"align\": \"center\", \"color\": \"#ffffff\", \"label\": \"联系电话\"}]}', 1, 3, '2026-10-22 06:05:57', '2026-10-22 06:05:57', 0, 0);

-- ----------------------------
-- Table structure for factory
-- ----------------------------
DROP TABLE IF EXISTS `factory`;
CREATE TABLE `factory`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工厂编码，如 F001',
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工厂名称',
  `contact` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系人姓名',
  `phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系电话',
  `address` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '工厂地址',
  `intro` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '介绍',
  `default_margin` decimal(5, 4) NULL DEFAULT 0.1500 COMMENT '默认毛利率，如0.15=15%',
  `default_tax_rate` decimal(5, 4) NULL DEFAULT 0.1000 COMMENT '默认税率，如0.10=10%',
  `default_waste_rate` decimal(5, 4) NULL DEFAULT 0.0400 COMMENT '默认损耗率，如0.04=4%',
  `c_end_enabled` tinyint(0) NULL DEFAULT 1 COMMENT '是否开放C端接单：1=开启 0=关闭',
  `status` tinyint(0) NULL DEFAULT 1 COMMENT '工厂状态：1=正常 0=停用',
  `audit_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved',
  `applied_at` timestamp(0) NULL DEFAULT NULL,
  `last_login_at` timestamp(0) NULL DEFAULT NULL COMMENT '最后登录时间',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  `total_pushes` int(0) NULL DEFAULT 0 COMMENT '累计推送询价数',
  `total_accepts` int(0) NULL DEFAULT 0 COMMENT '累计接单数',
  `avg_response_hours` decimal(6, 2) NULL COMMENT '平均响应时长（小时）',
  `rating` decimal(3, 2) NULL DEFAULT 5.00 COMMENT '评分 1-5，默认 5',
  `rating_count` int(0) NULL DEFAULT 0 COMMENT '评分人数',
  `logo_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '工厂 LOGO',
  `capacity_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unknown' COMMENT '产能状态：idle=空闲 normal=正常 busy=饱和 unknown=未填报',
  `capacity_note` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '产能备注（如\"本周档期满\"\"可接加急\"）',
  `capacity_updated_at` timestamp(0) NULL DEFAULT NULL COMMENT '产能填报时间（超72h视为过期，展示降为未填报、不再加权）',
  `license_verified` tinyint(0) NOT NULL DEFAULT 0 COMMENT '平台已核验资质徽章：1=已核验（营业执照/印刷经营许可证）',
  `province` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '省（地区筛选用，写入时已规范化）',
  `city` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '市（地区筛选用，写入时已规范化）',
  `verification_level` tinyint(0) NOT NULL DEFAULT 0 COMMENT '验真分级：0=未核验 1=营业执照已核 2=实地/视频验厂 3=深度验厂（多年合作+评分）',
  `verification_note` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '验真审核备注',
  `verified_at` datetime(0) NULL DEFAULT NULL COMMENT '最近核验时间',
  `factory_area` int(0) NULL DEFAULT NULL COMMENT '厂房面积(㎡)',
  `annual_volume` decimal(12, 2) NULL DEFAULT NULL COMMENT '年交易额(万元)',
  `employee_count` int(0) NULL DEFAULT NULL COMMENT '员工总数',
  `equipment_count` int(0) NULL DEFAULT NULL COMMENT '主要设备台数',
  `assembly_lines` int(0) NULL DEFAULT NULL COMMENT '流水线条数',
  `outer_processing` tinyint(0) NULL DEFAULT NULL COMMENT '是否对外加工：1=是 0=否',
  `view_count` int(0) NOT NULL DEFAULT 0 COMMENT '详情页浏览量',
  `lat` decimal(10, 6) NULL DEFAULT NULL COMMENT '纬度（找厂距离排序）',
  `lng` decimal(10, 6) NULL DEFAULT NULL COMMENT '经度（找厂距离排序）',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE,
  UNIQUE INDEX `uk_factory_username`(`username`) USING BTREE,
  INDEX `idx_region`(`province`, `city`) USING BTREE,
  INDEX `idx_verif`(`verification_level`) USING BTREE,
  INDEX `idx_latlng`(`lat`, `lng`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 57 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '印刷厂主表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory
-- 参考厂数据：username/password_hash 一律置 NULL（既不把真实登录账号写进仓库，
-- 也避开 uk_factory_username 唯一约束——上一版用固定 'DUMMY_USER' 占位会让新库建到第二行就 Duplicate entry）；
-- 新装的厂若需登录，走「工厂管理 → 开户」或小程序注册流程重新设账号
-- 硬指标/坐标/浏览量一律 NULL（浏览量 0）：这些是厂方自报或后台核验后才有的数据，
-- 参考厂不该假装填过；存量库坐标由 node scripts/backfill-factory-geo.js 按市回填
-- ----------------------------
INSERT INTO `factory` VALUES (1, 'F001',NULL, NULL, '浙江新雅包装有限公司','DUMMY','DUMMY', '龙港市世纪大道新雅工业园40-42号楼', '标签、酒盒、药品包装盒、纸袋、日化包装盒、化妆品包装盒、礼品包装盒及防伪包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-10-26 07:06:49', '2026-09-21 08:10:04', '2026-10-26 07:06:49', 8, 8, 2.08, 5.00, 2, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 3, '深度验厂：营业执照+实地核查+近半年5笔以上成交，评分达标', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (2, 'F002',NULL, NULL, '诚德科技股份有限公司','DUMMY','DUMMY', '龙港市世纪大道888-1088号', '食品、日化、医药行业塑料复合包装膜（袋），中国包装百强企业，国家高新技术企业', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-10-23 06:50:12', '2026-09-21 08:10:04', '2026-10-23 06:50:12', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 2, '视频验厂通过：车间实拍与设备清单核对一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (3, 'F003',NULL, NULL, '浙江新振印刷科技有限公司','DUMMY','DUMMY', '龙港市兴科路555号新城创业园E区115-185号', '药盒包装、精品礼盒、防伪药盒、手提袋、日化包装、文教书刊', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 2, '视频验厂通过：车间实拍与设备清单核对一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (4, 'F004',NULL, NULL, '浙江鑫祥印业有限公司','DUMMY','DUMMY', '龙港市岑东路169号', '药盒、礼品盒、酒盒、金银卡盒、瓦楞彩箱、食品盒、书刊画册、手提袋、不干胶商标', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-09-29 01:06:14', '2026-09-21 08:10:04', '2026-10-22 06:05:57', 5, 4, 7.85, 4.33, 3, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 3, '深度验厂：营业执照+实地核查+近半年5笔以上成交，评分达标', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (5, 'F005',NULL, NULL, '温州豪格防伪科技有限公司','DUMMY','DUMMY', '龙港市世纪大道新雅工业园28幢', '防伪标签、一物一码贴纸、卷筒不干胶标签、可变数据防伪标签、RFID射频标签、二维码标签', 0.1800, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 1, '营业执照联网核验一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (6, 'F006',NULL, NULL, '浙江镭博包装有限公司','DUMMY','DUMMY', '龙港市产业大道450-610号龙港新城创业园46幢404-504室', '卷筒不干胶标签、药品/化妆品/酒类防伪标签，拥有日本SANKI七色辊印机', 0.1800, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 1, '营业执照联网核验一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (7, 'F007',NULL, NULL, '温州德龙包装制品有限公司','DUMMY','DUMMY', '龙港市', '包装制品综合生产', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (8, 'F008',NULL, NULL, '温州金驰科技有限公司','DUMMY','DUMMY', '龙港市', '数字化改造样本企业，全流程数字化管控', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (9, 'F009',NULL, NULL, '浙江博润印刷科技有限公司','DUMMY','DUMMY', '龙港市彩虹智慧创业园28幢101-102号', '高档彩盒、礼品盒、卡牌、纸杯、说明书、不干胶、贺卡、纸袋，覆盖多场景包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 2, '视频验厂通过：车间实拍与设备清单核对一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (10, 'F010',NULL, NULL, '浙江华旭实业有限公司','DUMMY','DUMMY', '龙港市', '综合印刷包装，版权登记优秀企业', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-10-26 07:07:34', '2026-09-21 08:10:04', '2026-10-26 07:07:34', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 1, '营业执照联网核验一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (11, 'F011',NULL, NULL, '浙江谦林包装科技有限公司','DUMMY','DUMMY', '龙港市', '包装科技研发与生产', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (12, 'F012',NULL, NULL, '浙江思享包装科技有限公司','DUMMY','DUMMY', '龙港市', '数字化改造样本企业', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (13, 'F013',NULL, NULL, '浙江宝驰印刷科技有限公司','DUMMY','DUMMY', '龙港市彩虹大道511-731号彩虹智慧创业园9幢1层', '手提袋、礼品盒、纸盒、药盒、酒盒、红包、对联、不干胶标签', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 1, '营业执照联网核验一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (14, 'F014',NULL, NULL, '浙江晴耕雨读实业有限公司','DUMMY','DUMMY', '龙港市', '版权登记优秀企业，文创包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (15, 'F015',NULL, NULL, '浙江温盛包装科技有限公司','DUMMY','DUMMY', '龙港市黄河产业园9幢', '药品盒、食品盒、化妆品盒、高端礼品盒、手提袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 1, '营业执照联网核验一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (16, 'F016',NULL, NULL, '浙江小渔包装科技有限公司','DUMMY','DUMMY', '龙港市发展路511号', '酒盒、化妆品盒、茶叶盒等纸质包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (17, 'F017',NULL, NULL, '浙江金燕印业有限公司','DUMMY','DUMMY', '龙港市世纪大道607-647号', '热转印花膜、模内贴标IML，10色电子轴高性能印刷机，广泛应用于电器、文具、化妆品、玩具等', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 2, '视频验厂通过：车间实拍与设备清单核对一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (18, 'F018',NULL, NULL, '温州创大印业有限公司','DUMMY','DUMMY', '龙港市西三街55号', '综合印刷', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (19, 'F019',NULL, NULL, '温州佳丰科技有限公司','DUMMY','DUMMY', '龙港市', '包装科技', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (20, 'F020',NULL, NULL, '浙江云创印刷科技有限公司','DUMMY','DUMMY', '龙港市', '数码印刷、文创包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (21, 'F021',NULL, NULL, '浙江开泰印业有限公司','DUMMY','DUMMY', '龙港市龙港小包装工业园1幢1号', '酒盒、药盒、礼品盒、手提袋、食品包装、广告画册、PVC盒、纸盒、纸袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 1, '浙江省', '温州市', 1, '营业执照联网核验一致', '2026-10-27 16:55:39', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (22, 'F022',NULL, NULL, '浙江佳大印务有限公司','DUMMY','DUMMY', '龙港市上厂街265-271号', '彩盒、印刷品', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (23, 'F023',NULL, NULL, '温州雅致印业有限公司','DUMMY','DUMMY', '龙港市蔡家街240-260号', '精品礼盒', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (24, 'F024',NULL, NULL, '浙江鑫利美包装科技有限公司','DUMMY','DUMMY', '龙港市新城创业园3幢2单元', '纸包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (25, 'F025',NULL, NULL, '温州艺森包装有限公司','DUMMY','DUMMY', '龙港市西城二街133号', '彩盒、礼品盒', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (26, 'F026',NULL, NULL, '浙江港发软包装有限公司','DUMMY','DUMMY', '龙港市兴业路69-93号', '食品、饮品、保健品、调味品、农副产品、日化品、化妆品等软包装膜（袋）', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (27, 'F027',NULL, NULL, '温州霞光印刷有限公司','DUMMY','DUMMY', '龙港市东一路202-256号', '手提袋、包装盒、精美画册、彩页、纸卡、贺卡、红包、说明书', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (28, 'F028',NULL, NULL, '浙江唐风工艺品有限公司','DUMMY','DUMMY', '龙港市仓盛路78号', '工艺品包装、礼品盒', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (29, 'F029',NULL, NULL, '温州万发印业有限公司','DUMMY','DUMMY', '龙港市彩虹智慧创业园25幢1层101室、102室', '彩盒、纸袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (30, 'F030',NULL, NULL, '温州新港印刷有限公司','DUMMY','DUMMY', '龙港市小包装工业园18幢12号', '酒标、塑料制品、凹凸画、广告扇、PVC/PP塑片、吸塑海报、鼠标垫等促销礼品', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (31, 'F031',NULL, NULL, '龙港盈创纸箱厂','DUMMY','DUMMY', '龙港市九龙路14号一层', '纸箱生产', 0.1200, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 1, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (32, 'F032',NULL, NULL, '龙港市科利纸箱厂','DUMMY','DUMMY', '龙港市巴曹镇南路200号一层', '纸箱生产', 0.1200, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-09-25 14:53:14', '2026-09-21 08:10:04', '2026-10-22 06:05:57', 3, 3, 9.54, 4.00, 2, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (33, 'F033',NULL, NULL, '龙港市瑞俊纸箱加工厂','DUMMY','DUMMY', '龙港市', '纸箱加工', 0.1200, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 1, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (34, 'F034',NULL, NULL, '龙港市嘉澜包装股份有限公司','DUMMY','DUMMY', '龙港市时代大道384-448号第二幢东首3楼', '纸箱、彩箱', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-10-22 07:37:41', '2026-09-21 08:10:04', '2026-10-22 07:37:41', 13, 9, 0.22, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (35, 'F035',NULL, NULL, '温州宏愿热转印有限公司','DUMMY','DUMMY', '龙港市新城小微园41幢3层302室', '服装烫画、热升华转印，年产300吨无纺布印刷品', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (36, 'F036',NULL, NULL, '龙港市鑫志不干胶标签加工厂','DUMMY','DUMMY', '龙港市洪宫二巷47-49号一层', '不干胶标签', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (37, 'F037',NULL, NULL, '温州深蓝印刷有限公司','DUMMY','DUMMY', '龙港市嘉宏工业园7幢', '不干胶标签', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (38, 'F038',NULL, NULL, '温州五辉不干胶','DUMMY','DUMMY', '龙港市人民路460-462号', '不干胶标签', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (39, 'F039',NULL, NULL, '温州市恒生包装有限公司','DUMMY','DUMMY', '龙港市兴业路1288号', '包装印刷、标签', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (40, 'F040',NULL, NULL, '龙港市华联软包装有限公司','DUMMY','DUMMY', '龙港市龙港新城创业园E区53幢', '软包装、复合袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (41, 'F041',NULL, NULL, '浙江恒光包装有限公司','DUMMY','DUMMY', '龙港新城兴业路58号1栋', '软包装袋、卷膜', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (42, 'F042',NULL, NULL, '浙江立森包装科技有限公司','DUMMY','DUMMY', '龙港市新雅纸塑工业园30幢1层西边', '软包装、复合膜', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (43, 'F043',NULL, NULL, '苍南县龙港文光绿色包装有限公司','DUMMY','DUMMY', '龙港市', '环保包装、软包装', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (44, 'F044',NULL, NULL, '温州如仓包装有限公司','DUMMY','DUMMY', '龙港市建新路137号', '无纺布袋、环保袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (45, 'F045',NULL, NULL, '龙港市欣望包装厂','DUMMY','DUMMY', '龙港市兴联路1栋12号一层', '无纺布袋、纸袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (46, 'F046',NULL, NULL, '龙港市奥龙包装有限公司','DUMMY','DUMMY', '龙港市新城海西路777号浙森科技园1幢', '无纺布袋、纸袋、纸杯、纸碗、餐盒，年产1500万个纸袋、2000万个无纺布袋', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (47, 'F047',NULL, NULL, '龙港市栩杭热转印厂','DUMMY','DUMMY', '龙港市龙港新城创业园41幢302室', '热转印', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (48, 'F048',NULL, NULL, '龙港宗孝热转印有限公司','DUMMY','DUMMY', '龙港市', '热转印加工', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (49, 'F049',NULL, NULL, '浙江森林控股有限公司','DUMMY','DUMMY', '龙港市凤祥路160号', '外贸文具套装、笔记本、文件夹、装饰贴、出版物，出口欧洲、美国、日本', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (50, 'F050',NULL, NULL, '温州格洛博电子有限公司','DUMMY','DUMMY', '龙港市', '电子标签、RFID', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, NULL, '2026-09-21 08:10:04', '2026-10-22 06:05:57', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, '浙江省', '温州市', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (51, 'T22287421',NULL, NULL, '冒烟测试工厂22287421','DUMMY','DUMMY', NULL, NULL, 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-09-25 07:44:47', '2026-09-25 07:44:47', '2026-10-23 08:53:35', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (52, 'T22979019',NULL, NULL, '冒烟测试工厂22979019','DUMMY','DUMMY', NULL, NULL, 0.1500, 0.1000, 0.0400, 1, 1, 'approved', NULL, '2026-09-25 07:56:19', '2026-09-25 07:56:19', '2026-10-23 08:22:22', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);
INSERT INTO `factory` VALUES (56, 'F053',NULL, NULL, '我的测试工厂','DUMMY','DUMMY', NULL, '测试专用', 0.1500, 0.1000, 0.0400, 1, 1, 'approved', '2026-10-22 07:30:37', '2026-10-26 07:12:22', '2026-10-22 07:30:37', '2026-10-26 07:12:22', 0, 0, 0.00, 5.00, 0, NULL, 'unknown', NULL, NULL, 0, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL);

-- ----------------------------
-- Table structure for factory_capability
-- ----------------------------
DROP TABLE IF EXISTS `factory_capability`;
CREATE TABLE `factory_capability`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID，关联 factory.id',
  `capability_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '能力类型：productType/printMode/process/material',
  `capability_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '能力编码，对应各目录表的 code',
  `remark` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注，如\"海德堡对开机\"',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_factory_cap`(`factory_id`, `capability_type`, `capability_code`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE,
  INDEX `idx_type`(`capability_type`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 563 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂能力表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_capability
-- ----------------------------
INSERT INTO `factory_capability` VALUES (1, 1, 'productType', 'cardBox', '酒盒/药盒/日化盒/礼品盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (2, 1, 'productType', 'paperBag', '纸袋/手提袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (3, 1, 'productType', 'sticker', '标签', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (4, 1, 'printMode', 'offset', '大型综合彩色印刷', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (5, 1, 'printMode', 'digital', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (6, 1, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (7, 1, 'process', 'GLOSS_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (8, 1, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (9, 1, 'process', 'EMBOSS_PROC', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (10, 1, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (11, 1, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (12, 1, 'process', 'ROPE', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (13, 1, 'process', 'TRACE_QR', '防伪包装', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (14, 1, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (15, 1, 'material', 'CARD300', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (16, 1, 'material', 'KRAFT120', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (17, 1, 'material', 'STK_COPPER', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (32, 2, 'productType', 'flexiblePackaging', '食品/药品/日化复合膜袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (33, 2, 'printMode', 'gravure', '凹印', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (34, 2, 'printMode', 'flexo', '柔印', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (35, 2, 'process', 'LAMINATE', '复合', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (36, 2, 'process', 'BAG_3SEAL', '三边封', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (37, 2, 'process', 'BAG_CENTER', '中封', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (38, 2, 'process', 'BAG_STAND', '自立袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (39, 2, 'process', 'BAG_ZIP', '拉链袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (40, 2, 'process', 'PACK', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (41, 2, 'material', 'PP_40', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (42, 2, 'material', 'PE_50', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (43, 2, 'material', 'PET_35', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (44, 2, 'material', 'PA_30', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (45, 2, 'material', 'ALU_70', '铝箔复合', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (47, 3, 'productType', 'cardBox', '药盒/精品礼盒/防伪药盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (48, 3, 'productType', 'paperBag', '手提袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (49, 3, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (50, 3, 'printMode', 'digital', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (51, 3, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (52, 3, 'process', 'UV_COAT', 'UV镭射/雪花纹', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (53, 3, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (54, 3, 'process', 'EMBOSS_PROC', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (55, 3, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (56, 3, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (57, 3, 'process', 'TRACE_QR', '一物一码防伪溯源', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (58, 3, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (59, 3, 'material', 'CARD300', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (62, 4, 'productType', 'cardBox', '药盒/酒盒/礼品盒/食品盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (63, 4, 'productType', 'carton', '瓦楞彩箱', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (64, 4, 'productType', 'paperBag', '手提袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (65, 4, 'productType', 'sticker', '不干胶商标', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (66, 4, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (67, 4, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (68, 4, 'process', 'GLOSS_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (69, 4, 'process', 'HOT_STAMP', '金银卡盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (70, 4, 'process', 'EMBOSS_PROC', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (71, 4, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (72, 4, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (73, 4, 'process', 'ROPE', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (74, 4, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (75, 4, 'material', 'CARD300', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (76, 4, 'material', 'B_BC5', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (77, 5, 'productType', 'antiCounterfeitLabel', '防伪标签/可变数据标签/RFID', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (78, 5, 'productType', 'sticker', '卷筒不干胶标签', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (79, 5, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (80, 5, 'printMode', 'flexo', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (81, 5, 'printMode', 'digital', 'HP Indigo ws4500', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (82, 5, 'process', 'LASER_AF', '激光防伪', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (83, 5, 'process', 'SCRATCH', '刮刮银', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (84, 5, 'process', 'FLUOR', '荧光油墨', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (85, 5, 'process', 'VOID_AF', '揭开留底', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (86, 5, 'process', 'TRACE_QR', '二维码溯源', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (87, 5, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (88, 5, 'material', 'STK_COPPER', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (89, 5, 'material', 'STK_PET', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (90, 5, 'material', 'STK_PETSILVER', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (92, 6, 'productType', 'sticker', '卷筒不干胶标签', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (93, 6, 'productType', 'antiCounterfeitLabel', '药品/化妆品防伪标签', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (94, 6, 'printMode', 'flexo', '日本SANKI七色辊印机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (95, 6, 'printMode', 'offset', '韦冈PS版卷筒印刷机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (96, 6, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (97, 6, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (98, 6, 'process', 'SCRATCH', '刮刮银', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (99, 6, 'process', 'TRACE_QR', '二维码', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (100, 6, 'material', 'STK_COPPER', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (101, 6, 'material', 'STK_PET', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (102, 6, 'material', 'STK_PETSILVER', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (107, 9, 'productType', 'cardBox', '彩盒/礼品盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (108, 9, 'productType', 'paperBag', '儿童礼品袋/纸袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (109, 9, 'productType', 'sticker', '不干胶', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (110, 9, 'productType', 'card', '贺卡/卡牌', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (111, 9, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (112, 9, 'printMode', 'digital', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (113, 9, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (114, 9, 'process', 'GLOSS_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (115, 9, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (116, 9, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (117, 9, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (118, 9, 'process', 'ROPE', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (119, 9, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (120, 9, 'material', 'CARD300', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (121, 9, 'material', 'KRAFT120', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (122, 13, 'productType', 'cardBox', '药盒/酒盒/礼品盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (123, 13, 'productType', 'paperBag', '牛皮纸手提袋/白卡纸手提袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (124, 13, 'productType', 'nonWovenBag', '无纺布袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (125, 13, 'productType', 'sticker', '不干胶标签', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (126, 13, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (127, 13, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (128, 13, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (129, 13, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (130, 13, 'process', 'ROPE', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (131, 13, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (132, 13, 'process', 'SEWING', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (133, 13, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (134, 13, 'material', 'KRAFT120', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (135, 13, 'material', 'NW_100', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (137, 15, 'productType', 'cardBox', '药品盒/食品盒/化妆品盒/礼品盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (138, 15, 'productType', 'paperBag', '手提袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (139, 15, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (140, 15, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (141, 15, 'process', 'GLOSS_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (142, 15, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (143, 15, 'process', 'EMBOSS_PROC', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (144, 15, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (145, 15, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (146, 15, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (147, 15, 'material', 'CARD300', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (152, 16, 'productType', 'cardBox', '酒盒/化妆品盒/茶叶盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (153, 16, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (154, 16, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (155, 16, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (156, 16, 'process', 'EMBOSS_PROC', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (157, 16, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (158, 16, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (159, 16, 'material', 'CARD300', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (160, 16, 'material', 'CARD350', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (167, 17, 'productType', 'heatTransfer', '热转印花膜/模内贴标', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (168, 17, 'printMode', 'gravure', '10色电子轴高性能印刷机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (169, 17, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (170, 17, 'process', 'LAMINATE', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (171, 17, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (172, 17, 'process', 'PACK', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (173, 17, 'material', 'HTF_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (174, 26, 'productType', 'flexiblePackaging', '食品/药品/日化复合膜袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (175, 26, 'printMode', 'gravure', '12色北人凹印机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (176, 26, 'printMode', 'flexo', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (177, 26, 'process', 'LAMINATE', '复合', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (178, 26, 'process', 'BAG_3SEAL', '食品袋/农药袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (179, 26, 'process', 'BAG_STAND', '立体拉链袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (180, 26, 'process', 'BAG_ZIP', '拉链袋', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (181, 26, 'process', 'PACK', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (182, 26, 'material', 'PP_40', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (183, 26, 'material', 'PE_50', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (184, 26, 'material', 'PET_35', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (185, 26, 'material', 'ALU_70', '铝箔复合避光', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (189, 35, 'productType', 'heatTransfer', '服装烫画/热升华转印', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (190, 35, 'productType', 'nonWovenBag', '无纺布印刷品', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (191, 35, 'printMode', 'screen', '全自动/半自动丝印机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (192, 35, 'printMode', 'digital', '数码打印机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (193, 35, 'process', 'LAMINATE', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (194, 35, 'process', 'SEWING', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (195, 35, 'process', 'PACK', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (196, 35, 'material', 'HTF_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (197, 35, 'material', 'NW_80', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (204, 46, 'productType', 'paperBag', '纸袋（年产1500万个）', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (205, 46, 'productType', 'nonWovenBag', '无纺布袋（年产2000万个）', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (206, 46, 'productType', 'paperContainer', '纸杯/纸碗/餐盒', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (207, 46, 'printMode', 'offset', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (208, 46, 'printMode', 'screen', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (209, 46, 'process', 'ROPE', '穿绳', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (210, 46, 'process', 'SEWING', '车缝', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (211, 46, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (212, 46, 'process', 'PACK', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (213, 46, 'material', 'KRAFT120', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (214, 46, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (215, 46, 'material', 'NW_100', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (219, 49, 'productType', 'card', '笔记本/文件夹/文具套装', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (220, 49, 'productType', 'cardBox', '工艺礼品包装', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (221, 49, 'printMode', 'offset', '高宝利必达对开四色胶印机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (222, 49, 'printMode', 'flexo', '1000型四色柔板卷筒印刷机', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (223, 49, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (224, 49, 'process', 'GLOSS_FILM', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (225, 49, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (226, 49, 'process', 'DIE_CUT', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (227, 49, 'process', 'FOLD', '折页', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (228, 49, 'process', 'PACK', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (229, 49, 'material', 'CARD250', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (230, 49, 'material', 'COAT200', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (231, 49, 'material', 'KRAFT120', '', '2026-09-21 08:18:09');
INSERT INTO `factory_capability` VALUES (234, 7, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (235, 7, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (236, 7, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (237, 7, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (238, 7, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (239, 7, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (241, 8, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (242, 8, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (243, 8, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (244, 8, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (245, 8, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (246, 8, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (248, 10, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (249, 10, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (250, 10, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (251, 10, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (252, 10, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (255, 11, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (256, 11, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (257, 11, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (258, 11, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (259, 11, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (262, 12, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (263, 12, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (264, 12, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (265, 12, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (266, 12, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (269, 14, 'productType', 'cardBox', '文创包装', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (270, 14, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (271, 14, 'printMode', 'digital', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (272, 14, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (273, 14, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (274, 14, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (275, 14, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (276, 18, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (277, 18, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (278, 18, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (279, 18, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (280, 18, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (283, 19, 'productType', 'cardBox', '待核实', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (284, 19, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (285, 19, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (286, 19, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (287, 19, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (290, 20, 'productType', 'cardBox', '文创包装', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (291, 20, 'printMode', 'digital', '数码印刷', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (292, 20, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (293, 20, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (294, 20, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (295, 20, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (297, 21, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (298, 22, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (299, 23, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (300, 24, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (301, 25, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (302, 21, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (303, 22, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (304, 23, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (305, 24, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (306, 25, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (307, 21, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (308, 22, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (309, 23, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (310, 24, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (311, 25, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (312, 21, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (313, 22, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (314, 23, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (315, 24, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (316, 25, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (317, 21, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (318, 22, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (319, 23, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (320, 24, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (321, 25, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (322, 21, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (323, 22, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (324, 23, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (325, 24, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (326, 25, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (328, 27, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (329, 28, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (330, 29, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (331, 30, 'productType', 'cardBox', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (332, 27, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (333, 28, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (334, 29, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (335, 30, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (336, 27, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (337, 28, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (338, 29, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (339, 30, 'process', 'MATTE_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (340, 27, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (341, 28, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (342, 29, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (343, 30, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (344, 27, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (345, 28, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (346, 29, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (347, 30, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (348, 27, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (349, 28, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (350, 29, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (351, 30, 'material', 'CARD250', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (359, 31, 'productType', 'carton', '纸箱', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (360, 32, 'productType', 'carton', '纸箱', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (361, 33, 'productType', 'carton', '纸箱', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (362, 34, 'productType', 'carton', '纸箱', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (363, 31, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (364, 32, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (365, 33, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (366, 34, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (367, 31, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (368, 32, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (369, 33, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (370, 34, 'process', 'GLUE_BOX', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (371, 31, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (372, 32, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (373, 33, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (374, 34, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (375, 31, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (376, 32, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (377, 33, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (378, 34, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (379, 31, 'material', 'B_BC5', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (380, 32, 'material', 'B_BC5', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (381, 33, 'material', 'B_BC5', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (382, 34, 'material', 'B_BC5', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (383, 31, 'material', 'B_B3', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (384, 32, 'material', 'B_B3', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (385, 33, 'material', 'B_B3', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (386, 34, 'material', 'B_B3', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (390, 36, 'productType', 'sticker', '不干胶标签', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (391, 37, 'productType', 'sticker', '不干胶标签', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (392, 38, 'productType', 'sticker', '不干胶标签', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (393, 39, 'productType', 'sticker', '不干胶标签', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (394, 36, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (395, 37, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (396, 38, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (397, 39, 'printMode', 'offset', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (398, 36, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (399, 37, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (400, 38, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (401, 39, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (402, 36, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (403, 37, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (404, 38, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (405, 39, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (406, 36, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (407, 37, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (408, 38, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (409, 39, 'process', 'HOT_STAMP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (410, 36, 'material', 'STK_COPPER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (411, 37, 'material', 'STK_COPPER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (412, 38, 'material', 'STK_COPPER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (413, 39, 'material', 'STK_COPPER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (421, 40, 'productType', 'flexiblePackaging', '软包装', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (422, 41, 'productType', 'flexiblePackaging', '软包装', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (423, 42, 'productType', 'flexiblePackaging', '软包装', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (424, 43, 'productType', 'flexiblePackaging', '软包装', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (425, 40, 'printMode', 'gravure', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (426, 41, 'printMode', 'gravure', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (427, 42, 'printMode', 'gravure', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (428, 43, 'printMode', 'gravure', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (429, 40, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (430, 41, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (431, 42, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (432, 43, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (433, 40, 'process', 'LAMINATE', '复合', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (434, 41, 'process', 'LAMINATE', '复合', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (435, 42, 'process', 'LAMINATE', '复合', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (436, 43, 'process', 'LAMINATE', '复合', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (437, 40, 'process', 'BAG_3SEAL', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (438, 41, 'process', 'BAG_3SEAL', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (439, 42, 'process', 'BAG_3SEAL', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (440, 43, 'process', 'BAG_3SEAL', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (441, 40, 'process', 'BAG_CENTER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (442, 41, 'process', 'BAG_CENTER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (443, 42, 'process', 'BAG_CENTER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (444, 43, 'process', 'BAG_CENTER', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (445, 40, 'process', 'BAG_STAND', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (446, 41, 'process', 'BAG_STAND', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (447, 42, 'process', 'BAG_STAND', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (448, 43, 'process', 'BAG_STAND', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (449, 40, 'process', 'BAG_ZIP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (450, 41, 'process', 'BAG_ZIP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (451, 42, 'process', 'BAG_ZIP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (452, 43, 'process', 'BAG_ZIP', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (453, 40, 'material', 'PP_40', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (454, 41, 'material', 'PP_40', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (455, 42, 'material', 'PP_40', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (456, 43, 'material', 'PP_40', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (457, 40, 'material', 'PE_50', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (458, 41, 'material', 'PE_50', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (459, 42, 'material', 'PE_50', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (460, 43, 'material', 'PE_50', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (461, 40, 'material', 'PET_35', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (462, 41, 'material', 'PET_35', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (463, 42, 'material', 'PET_35', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (464, 43, 'material', 'PET_35', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (484, 44, 'productType', 'nonWovenBag', '无纺布袋/环保袋', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (485, 45, 'productType', 'nonWovenBag', '无纺布袋/环保袋', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (486, 44, 'printMode', 'screen', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (487, 45, 'printMode', 'screen', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (488, 44, 'process', 'SEWING', '车缝', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (489, 45, 'process', 'SEWING', '车缝', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (490, 44, 'process', 'ROPE', '穿绳', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (491, 45, 'process', 'ROPE', '穿绳', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (492, 44, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (493, 45, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (494, 44, 'material', 'NW_100', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (495, 45, 'material', 'NW_100', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (499, 47, 'productType', 'heatTransfer', '热转印', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (500, 48, 'productType', 'heatTransfer', '热转印', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (501, 47, 'printMode', 'gravure', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (502, 48, 'printMode', 'gravure', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (503, 47, 'printMode', 'screen', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (504, 48, 'printMode', 'screen', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (505, 47, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (506, 48, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (507, 47, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (508, 48, 'process', 'PACK', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (509, 47, 'material', 'HTF_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (510, 48, 'material', 'HTF_FILM', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (514, 50, 'productType', 'antiCounterfeitLabel', '电子标签/RFID', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (515, 50, 'printMode', 'flexo', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (516, 50, 'printMode', 'digital', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (517, 50, 'process', 'TRACE_QR', '二维码/RFID', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (518, 50, 'process', 'DIE_CUT', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (519, 50, 'material', 'STK_PET', '', '2026-09-21 08:18:19');
INSERT INTO `factory_capability` VALUES (521, 1, 'productType', 'paperContainer', '纸杯纸碗产线', '2026-09-21 08:54:24');
INSERT INTO `factory_capability` VALUES (522, 2, 'productType', 'paperContainer', '纸罐产线', '2026-09-21 08:54:24');
INSERT INTO `factory_capability` VALUES (523, 3, 'productType', 'paperContainer', '纸容器配套', '2026-09-21 08:54:24');
INSERT INTO `factory_capability` VALUES (524, 1, 'printMode', 'flexo', '纸杯柔印机', '2026-09-22 03:08:36');
INSERT INTO `factory_capability` VALUES (525, 1, 'process', 'CUP_FORMING', '杯成型机', '2026-09-22 03:08:36');
INSERT INTO `factory_capability` VALUES (526, 1, 'process', 'RIM_ROLLING', '卷边机', '2026-09-22 03:08:36');
INSERT INTO `factory_capability` VALUES (527, 1, 'process', 'BOTTOM_SEAL', '', '2026-09-22 03:08:36');
INSERT INTO `factory_capability` VALUES (528, 1, 'material', 'FOOD_CARD', '常备食品白卡', '2026-09-22 03:08:36');
INSERT INTO `factory_capability` VALUES (529, 1, 'material', 'CUP_PE', '常备淋膜杯纸', '2026-09-22 03:08:36');
INSERT INTO `factory_capability` VALUES (536, 10, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (537, 11, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (538, 12, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (539, 14, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (540, 18, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (541, 19, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (542, 20, 'process', 'GLUE_BOX', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (543, 7, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (544, 8, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (545, 10, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (546, 11, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (547, 12, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (548, 14, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (549, 18, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (550, 19, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (551, 20, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (552, 22, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (553, 23, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (554, 24, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (555, 25, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (556, 28, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (557, 29, 'material', 'CARD300', '', '2026-09-22 07:40:05');
INSERT INTO `factory_capability` VALUES (561, 1, 'printMode', 'screen', '丝印（无纺布袋/纸袋单色）', '2026-10-22 06:05:57');
INSERT INTO `factory_capability` VALUES (562, 2, 'printMode', 'screen', '丝印（标签/纸袋）', '2026-10-22 06:05:57');

-- ----------------------------
-- Table structure for factory_inquiry_push
-- ----------------------------
DROP TABLE IF EXISTS `factory_inquiry_push`;
CREATE TABLE `factory_inquiry_push`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `inquiry_id` bigint(0) NOT NULL COMMENT '询价ID，关联 c_inquiry.id',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID，关联 factory.id',
  `factory_quote` decimal(12, 2) NULL DEFAULT NULL COMMENT '按该工厂价格计算的报价',
  `push_time` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '推送时间',
  `view_time` timestamp(0) NULL DEFAULT NULL COMMENT '工厂查看时间',
  `respond_time` timestamp(0) NULL DEFAULT NULL COMMENT '工厂响应时间',
  `response` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'pending' COMMENT '工厂响应：pending=待处理 accept=接单 decline=拒绝',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_inquiry_factory`(`inquiry_id`, `factory_id`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂询价推送表（C端询价推送给匹配工厂的记录）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_inquiry_push
-- ----------------------------

-- ----------------------------
-- Table structure for factory_invite_code
-- ----------------------------
DROP TABLE IF EXISTS `factory_invite_code`;
CREATE TABLE `factory_invite_code`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邀请码（8位随机，去掉易混淆字符）',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID，关联 factory.id',
  `used` tinyint(0) NULL DEFAULT 0 COMMENT '是否已使用：0=未使用 1=已使用',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂邀请码（C端用户输码绑定工厂身份）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_invite_code
-- ----------------------------

-- ----------------------------
-- Table structure for factory_media
-- ----------------------------
DROP TABLE IF EXISTS `factory_media`;
CREATE TABLE `factory_media`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID，关联 factory.id',
  `media_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'equipment' COMMENT '内容类型：equipment=设备 workshop=车间 product=样品 certificate=资质证书 video=视频',
  `url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '相对路径（图片 /uploads/factory-media/...，视频同目录）',
  `caption` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '图注（如\"海德堡对开机×2\"）',
  `sort` int(0) NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
  `audit_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'approved' COMMENT '审核状态：pending=待审 approved=已过 rejected=驳回',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `cover_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '视频首帧封面图（仅 video 用，列表/详情没封面时给占位图）',
  `duration` int(0) NULL DEFAULT NULL COMMENT '视频时长(秒)，由上传端传上来（服务端不解容器元数据）',
  `file_size` int(0) NULL DEFAULT NULL COMMENT '文件字节数（video 上传时 multer 回的 size）',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_factory_audit`(`factory_id`, `audit_status`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂设备/车间图文与视频（C端详情图集）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_media
-- ----------------------------

-- ----------------------------
-- Table structure for factory_operation_log
-- ----------------------------
DROP TABLE IF EXISTS `factory_operation_log`;
CREATE TABLE `factory_operation_log`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `factory_id` int(0) NOT NULL COMMENT '工厂ID',
  `factory_user_id` int(0) NULL DEFAULT NULL COMMENT '操作员工ID（factory_user.id；系统动作可为 NULL）',
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '操作账号冗余（员工删除后仍可追溯）',
  `action` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作编码：login/accept/decline/ship/pricing/staff/refund 等',
  `detail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '动作详情（单号/参数摘要）',
  `ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '操作IP',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_factory`(`factory_id`, `created_at`) USING BTREE,
  INDEX `idx_user`(`factory_user_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 135 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂员工操作日志（F-158）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_operation_log
-- ----------------------------

-- ----------------------------
-- Table structure for factory_price_override
-- ----------------------------
DROP TABLE IF EXISTS `factory_price_override`;
CREATE TABLE `factory_price_override`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID，关联 factory.id',
  `target_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '覆盖对象类型：rawPaper/boardPaper/cardPaper/plateType/printingRate/finishing',
  `target_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '覆盖对象的编码，如 B_BC5',
  `field_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '覆盖字段名，如 price_per_sqm / start_fee',
  `field_value` decimal(12, 4) NOT NULL COMMENT '覆盖值',
  `remark` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注，如\"A厂自有纸板线\"',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_factory_target`(`factory_id`, `target_type`, `target_code`, `field_name`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 718 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂价格覆盖表（多租户核心：覆盖优先级高于系统默认价）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_price_override
-- ----------------------------
INSERT INTO `factory_price_override` VALUES (1, 1, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.7400, '大批量采购', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (2, 1, 'boardPaper', 'B_B3', 'price_per_sqm', 1.1800, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (3, 1, 'boardPaper', 'B_C3', 'price_per_sqm', 1.2700, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (4, 1, 'boardPaper', 'B_E3', 'price_per_sqm', 1.0400, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (5, 1, 'boardPaper', 'B_BE5', 'price_per_sqm', 1.6000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (6, 1, 'boardPaper', 'B_BCE7', 'price_per_sqm', 2.3000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (7, 1, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8000, '长期合作价', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (8, 1, 'cardPaper', 'CARD300', 'price_per_sqm', 0.9600, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (9, 1, 'cardPaper', 'CARD350', 'price_per_sqm', 1.1100, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (10, 1, 'cardPaper', 'COAT200', 'price_per_sqm', 0.5800, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (11, 1, 'printingRate', 'offset', 'start_fee', 720.0000, '海德堡对开机', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (12, 1, 'printingRate', 'offset', 'extra_per_1000', 70.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (13, 1, 'printingRate', 'flexo', 'color_rate', 0.0950, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (14, 1, 'printingRate', 'digital', 'min_charge', 4.8000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (15, 1, 'finishing', 'MATTE_FILM', 'rate', 0.5800, '自有覆膜设备', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (16, 1, 'finishing', 'GLOSS_FILM', 'rate', 0.5400, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (17, 1, 'finishing', 'HOT_STAMP', 'plate_fee', 320.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (18, 1, 'finishing', 'HOT_STAMP', 'rate', 0.8000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (19, 1, 'finishing', 'DIE_CUT', 'plate_fee', 450.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (20, 1, 'finishing', 'DIE_CUT', 'rate', 0.4600, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (21, 1, 'finishing', 'GLUE_BOX', 'rate', 0.0700, '自动化糊盒线', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (22, 1, 'finishing', 'ROPE', 'rate', 0.1300, '自动穿绳机', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (23, 1, 'finishing', 'CUP_FORMING', 'rate', 0.0700, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (24, 1, 'finishing', 'RIM_ROLLING', 'rate', 0.0260, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (25, 1, 'finishing', 'BOTTOM_SEAL', 'rate', 0.0260, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (26, 1, 'finishing', 'TRACE_QR', 'rate', 0.0180, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (27, 1, 'finishing', 'PACK', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (32, 2, 'printingRate', 'gravure', 'start_fee', 1380.0000, '12色凹印机', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (33, 2, 'printingRate', 'gravure', 'extra_per_1000', 55.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (34, 2, 'printingRate', 'flexo', 'color_rate', 0.0950, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (35, 2, 'finishing', 'LAMINATE', 'rate', 0.8500, '无溶剂复合', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (36, 2, 'finishing', 'BAG_3SEAL', 'rate', 0.0550, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (37, 2, 'finishing', 'BAG_CENTER', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (38, 2, 'finishing', 'BAG_STAND', 'rate', 0.1400, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (39, 2, 'finishing', 'BAG_ZIP', 'rate', 0.2350, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (40, 2, 'finishing', 'PACK', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (47, 3, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.7500, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (48, 3, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8050, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (49, 3, 'cardPaper', 'CARD300', 'price_per_sqm', 0.9650, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (50, 3, 'cardPaper', 'COAT200', 'price_per_sqm', 0.5850, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (51, 3, 'printingRate', 'offset', 'start_fee', 730.0000, '海德堡设备', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (52, 3, 'printingRate', 'offset', 'extra_per_1000', 71.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (53, 3, 'printingRate', 'digital', 'min_charge', 4.8000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (54, 3, 'finishing', 'MATTE_FILM', 'rate', 0.5900, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (55, 3, 'finishing', 'UV_COAT', 'rate', 0.3200, 'UV镭射设备', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (56, 3, 'finishing', 'HOT_STAMP', 'plate_fee', 320.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (57, 3, 'finishing', 'HOT_STAMP', 'rate', 0.8100, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (58, 3, 'finishing', 'TRACE_QR', 'rate', 0.0180, '一物一码系统', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (59, 3, 'finishing', 'GLUE_BOX', 'rate', 0.0720, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (60, 3, 'finishing', 'ROPE', 'rate', 0.1350, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (61, 3, 'finishing', 'PACK', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (62, 4, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.7600, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (63, 4, 'boardPaper', 'B_B3', 'price_per_sqm', 1.1900, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (64, 4, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8100, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (65, 4, 'cardPaper', 'CARD300', 'price_per_sqm', 0.9700, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (66, 4, 'cardPaper', 'COAT200', 'price_per_sqm', 0.5900, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (67, 4, 'printingRate', 'offset', 'start_fee', 740.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (68, 4, 'printingRate', 'offset', 'extra_per_1000', 72.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (69, 4, 'finishing', 'MATTE_FILM', 'rate', 0.5900, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (70, 4, 'finishing', 'GLOSS_FILM', 'rate', 0.5500, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (71, 4, 'finishing', 'HOT_STAMP', 'plate_fee', 330.0000, '金银卡专精', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (72, 4, 'finishing', 'HOT_STAMP', 'rate', 0.8100, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (73, 4, 'finishing', 'DIE_CUT', 'plate_fee', 460.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (74, 4, 'finishing', 'DIE_CUT', 'rate', 0.4700, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (75, 4, 'finishing', 'GLUE_BOX', 'rate', 0.0730, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (76, 4, 'finishing', 'ROPE', 'rate', 0.1350, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (77, 4, 'finishing', 'PACK', 'rate', 0.0460, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (93, 5, 'cardPaper', 'STK_COPPER', 'price_per_sqm', 0.7100, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (94, 5, 'cardPaper', 'STK_PET', 'price_per_sqm', 1.5200, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (95, 5, 'cardPaper', 'STK_PETSILVER', 'price_per_sqm', 1.7800, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (96, 5, 'printingRate', 'offset', 'start_fee', 720.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (97, 5, 'printingRate', 'offset', 'extra_per_1000', 68.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (98, 5, 'printingRate', 'flexo', 'color_rate', 0.0900, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (99, 5, 'printingRate', 'digital', 'min_charge', 4.5000, 'HP Indigo', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (100, 5, 'finishing', 'LASER_AF', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (101, 5, 'finishing', 'SCRATCH', 'rate', 0.0360, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (102, 5, 'finishing', 'FLUOR', 'rate', 0.0270, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (103, 5, 'finishing', 'VOID_AF', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (104, 5, 'finishing', 'TRACE_QR', 'rate', 0.0170, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (105, 5, 'finishing', 'DIE_CUT', 'plate_fee', 450.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (106, 5, 'finishing', 'DIE_CUT', 'rate', 0.4600, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (107, 5, 'finishing', 'PACK', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (108, 6, 'cardPaper', 'STK_COPPER', 'price_per_sqm', 0.7200, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (109, 6, 'cardPaper', 'STK_PET', 'price_per_sqm', 1.5400, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (110, 6, 'cardPaper', 'STK_PETSILVER', 'price_per_sqm', 1.7900, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (111, 6, 'printingRate', 'flexo', 'color_rate', 0.0920, 'SANKI七色机', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (112, 6, 'printingRate', 'offset', 'start_fee', 730.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (113, 6, 'printingRate', 'offset', 'extra_per_1000', 70.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (114, 6, 'finishing', 'HOT_STAMP', 'plate_fee', 330.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (115, 6, 'finishing', 'HOT_STAMP', 'rate', 0.8100, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (116, 6, 'finishing', 'SCRATCH', 'rate', 0.0370, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (117, 6, 'finishing', 'TRACE_QR', 'rate', 0.0180, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (118, 6, 'finishing', 'DIE_CUT', 'plate_fee', 460.0000, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (119, 6, 'finishing', 'DIE_CUT', 'rate', 0.4700, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (120, 6, 'finishing', 'PACK', 'rate', 0.0450, '', '2026-09-22 08:01:44', '2026-09-22 08:01:44');
INSERT INTO `factory_price_override` VALUES (123, 9, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8300, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (124, 9, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (125, 9, 'cardPaper', 'KRAFT120', 'price_per_sqm', 0.8300, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (126, 9, 'printingRate', 'offset', 'start_fee', 780.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (127, 9, 'printingRate', 'offset', 'extra_per_1000', 78.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (128, 9, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (129, 9, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (130, 9, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (131, 9, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (132, 9, 'finishing', 'ROPE', 'rate', 0.1450, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (133, 9, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (138, 13, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (139, 13, 'cardPaper', 'KRAFT120', 'price_per_sqm', 0.8300, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (140, 13, 'cardPaper', 'NW_100', 'price_per_sqm', 9.4000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (141, 13, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (142, 13, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (143, 13, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (144, 13, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (145, 13, 'finishing', 'ROPE', 'rate', 0.1480, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (146, 13, 'finishing', 'SEWING', 'rate', 0.4900, '车缝车间', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (147, 13, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (153, 15, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (154, 15, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (155, 15, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (156, 15, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (157, 15, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (158, 15, 'finishing', 'GLOSS_FILM', 'rate', 0.5900, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (159, 15, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (160, 15, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (161, 15, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (162, 15, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (168, 16, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (169, 16, 'cardPaper', 'CARD350', 'price_per_sqm', 1.1700, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (170, 16, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (171, 16, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (172, 16, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (173, 16, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (174, 16, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (175, 16, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (176, 16, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (183, 17, 'cardPaper', 'HTF_FILM', 'price_per_sqm', 5.3000, '热转印膜自产', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (184, 17, 'printingRate', 'gravure', 'start_fee', 1420.0000, '10色电子轴', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (185, 17, 'printingRate', 'gravure', 'extra_per_1000', 58.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (186, 17, 'finishing', 'LAMINATE', 'rate', 0.8800, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (187, 17, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (188, 17, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:01:55', '2026-09-22 08:01:55');
INSERT INTO `factory_price_override` VALUES (190, 21, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (191, 22, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (192, 23, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (193, 24, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (194, 25, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (195, 27, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (196, 28, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (197, 29, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (198, 30, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (199, 21, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (200, 22, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (201, 23, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (202, 24, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (203, 25, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (204, 27, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (205, 28, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (206, 29, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (207, 30, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (208, 21, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (209, 22, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (210, 23, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (211, 24, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (212, 25, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (213, 27, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (214, 28, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (215, 29, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (216, 30, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (217, 21, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (218, 22, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (219, 23, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (220, 24, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (221, 25, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (222, 27, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (223, 28, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (224, 29, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (225, 30, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (226, 21, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (227, 22, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (228, 23, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (229, 24, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (230, 25, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (231, 27, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (232, 28, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (233, 29, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (234, 30, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (235, 21, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (236, 22, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (237, 23, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (238, 24, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (239, 25, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (240, 27, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (241, 28, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (242, 29, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (243, 30, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:02:09', '2026-09-22 08:02:09');
INSERT INTO `factory_price_override` VALUES (253, 31, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.9100, '小批量采购', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (254, 32, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.9100, '小批量采购', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (255, 33, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.9100, '小批量采购', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (256, 34, 'boardPaper', 'B_BC5', 'price_per_sqm', 1.9100, '小批量采购', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (257, 31, 'boardPaper', 'B_B3', 'price_per_sqm', 1.2900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (258, 32, 'boardPaper', 'B_B3', 'price_per_sqm', 1.2900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (259, 33, 'boardPaper', 'B_B3', 'price_per_sqm', 1.2900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (260, 34, 'boardPaper', 'B_B3', 'price_per_sqm', 1.2900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (261, 31, 'boardPaper', 'B_C3', 'price_per_sqm', 1.3900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (262, 32, 'boardPaper', 'B_C3', 'price_per_sqm', 1.3900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (263, 33, 'boardPaper', 'B_C3', 'price_per_sqm', 1.3900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (264, 34, 'boardPaper', 'B_C3', 'price_per_sqm', 1.3900, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (265, 31, 'boardPaper', 'B_E3', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (266, 32, 'boardPaper', 'B_E3', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (267, 33, 'boardPaper', 'B_E3', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (268, 34, 'boardPaper', 'B_E3', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (269, 31, 'boardPaper', 'B_BE5', 'price_per_sqm', 1.7500, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (270, 32, 'boardPaper', 'B_BE5', 'price_per_sqm', 1.7500, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (271, 33, 'boardPaper', 'B_BE5', 'price_per_sqm', 1.7500, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (272, 34, 'boardPaper', 'B_BE5', 'price_per_sqm', 1.7500, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (273, 31, 'printingRate', 'offset', 'start_fee', 850.0000, '设备规格较小', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (274, 32, 'printingRate', 'offset', 'start_fee', 850.0000, '设备规格较小', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (275, 33, 'printingRate', 'offset', 'start_fee', 850.0000, '设备规格较小', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (276, 34, 'printingRate', 'offset', 'start_fee', 850.0000, '设备规格较小', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (277, 31, 'printingRate', 'offset', 'extra_per_1000', 85.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (278, 32, 'printingRate', 'offset', 'extra_per_1000', 85.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (279, 33, 'printingRate', 'offset', 'extra_per_1000', 85.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (280, 34, 'printingRate', 'offset', 'extra_per_1000', 85.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (281, 31, 'finishing', 'GLUE_BOX', 'rate', 0.0850, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (282, 32, 'finishing', 'GLUE_BOX', 'rate', 0.0850, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (283, 33, 'finishing', 'GLUE_BOX', 'rate', 0.0850, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (284, 34, 'finishing', 'GLUE_BOX', 'rate', 0.0850, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (285, 31, 'finishing', 'DIE_CUT', 'plate_fee', 520.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (286, 32, 'finishing', 'DIE_CUT', 'plate_fee', 520.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (287, 33, 'finishing', 'DIE_CUT', 'plate_fee', 520.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (288, 34, 'finishing', 'DIE_CUT', 'plate_fee', 520.0000, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (289, 31, 'finishing', 'PACK', 'rate', 0.0520, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (290, 32, 'finishing', 'PACK', 'rate', 0.0520, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (291, 33, 'finishing', 'PACK', 'rate', 0.0520, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (292, 34, 'finishing', 'PACK', 'rate', 0.0520, '', '2026-09-22 08:02:14', '2026-09-22 08:02:14');
INSERT INTO `factory_price_override` VALUES (316, 36, 'cardPaper', 'STK_COPPER', 'price_per_sqm', 0.7100, '卷筒料大批量', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (317, 37, 'cardPaper', 'STK_COPPER', 'price_per_sqm', 0.7100, '卷筒料大批量', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (318, 38, 'cardPaper', 'STK_COPPER', 'price_per_sqm', 0.7100, '卷筒料大批量', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (319, 39, 'cardPaper', 'STK_COPPER', 'price_per_sqm', 0.7100, '卷筒料大批量', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (320, 36, 'cardPaper', 'STK_PET', 'price_per_sqm', 1.5200, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (321, 37, 'cardPaper', 'STK_PET', 'price_per_sqm', 1.5200, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (322, 38, 'cardPaper', 'STK_PET', 'price_per_sqm', 1.5200, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (323, 39, 'cardPaper', 'STK_PET', 'price_per_sqm', 1.5200, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (324, 36, 'cardPaper', 'STK_SYNTH', 'price_per_sqm', 1.2800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (325, 37, 'cardPaper', 'STK_SYNTH', 'price_per_sqm', 1.2800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (326, 38, 'cardPaper', 'STK_SYNTH', 'price_per_sqm', 1.2800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (327, 39, 'cardPaper', 'STK_SYNTH', 'price_per_sqm', 1.2800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (328, 36, 'cardPaper', 'STK_THERMAL', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (329, 37, 'cardPaper', 'STK_THERMAL', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (330, 38, 'cardPaper', 'STK_THERMAL', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (331, 39, 'cardPaper', 'STK_THERMAL', 'price_per_sqm', 1.1400, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (332, 36, 'cardPaper', 'STK_PETSILVER', 'price_per_sqm', 1.7800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (333, 37, 'cardPaper', 'STK_PETSILVER', 'price_per_sqm', 1.7800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (334, 38, 'cardPaper', 'STK_PETSILVER', 'price_per_sqm', 1.7800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (335, 39, 'cardPaper', 'STK_PETSILVER', 'price_per_sqm', 1.7800, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (336, 36, 'printingRate', 'flexo', 'color_rate', 0.0920, '卷筒柔印', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (337, 37, 'printingRate', 'flexo', 'color_rate', 0.0920, '卷筒柔印', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (338, 38, 'printingRate', 'flexo', 'color_rate', 0.0920, '卷筒柔印', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (339, 39, 'printingRate', 'flexo', 'color_rate', 0.0920, '卷筒柔印', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (340, 36, 'printingRate', 'offset', 'start_fee', 760.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (341, 37, 'printingRate', 'offset', 'start_fee', 760.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (342, 38, 'printingRate', 'offset', 'start_fee', 760.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (343, 39, 'printingRate', 'offset', 'start_fee', 760.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (344, 36, 'printingRate', 'offset', 'extra_per_1000', 76.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (345, 37, 'printingRate', 'offset', 'extra_per_1000', 76.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (346, 38, 'printingRate', 'offset', 'extra_per_1000', 76.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (347, 39, 'printingRate', 'offset', 'extra_per_1000', 76.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (348, 36, 'finishing', 'DIE_CUT', 'plate_fee', 470.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (349, 37, 'finishing', 'DIE_CUT', 'plate_fee', 470.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (350, 38, 'finishing', 'DIE_CUT', 'plate_fee', 470.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (351, 39, 'finishing', 'DIE_CUT', 'plate_fee', 470.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (352, 36, 'finishing', 'DIE_CUT', 'rate', 0.4700, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (353, 37, 'finishing', 'DIE_CUT', 'rate', 0.4700, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (354, 38, 'finishing', 'DIE_CUT', 'rate', 0.4700, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (355, 39, 'finishing', 'DIE_CUT', 'rate', 0.4700, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (356, 36, 'finishing', 'HOT_STAMP', 'plate_fee', 340.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (357, 37, 'finishing', 'HOT_STAMP', 'plate_fee', 340.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (358, 38, 'finishing', 'HOT_STAMP', 'plate_fee', 340.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (359, 39, 'finishing', 'HOT_STAMP', 'plate_fee', 340.0000, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (360, 36, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (361, 37, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (362, 38, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (363, 39, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:20', '2026-09-22 08:02:20');
INSERT INTO `factory_price_override` VALUES (379, 40, 'printingRate', 'gravure', 'start_fee', 1425.0000, '高速凹印机', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (380, 41, 'printingRate', 'gravure', 'start_fee', 1425.0000, '高速凹印机', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (381, 42, 'printingRate', 'gravure', 'start_fee', 1425.0000, '高速凹印机', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (382, 43, 'printingRate', 'gravure', 'start_fee', 1425.0000, '高速凹印机', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (383, 40, 'printingRate', 'gravure', 'extra_per_1000', 57.0000, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (384, 41, 'printingRate', 'gravure', 'extra_per_1000', 57.0000, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (385, 42, 'printingRate', 'gravure', 'extra_per_1000', 57.0000, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (386, 43, 'printingRate', 'gravure', 'extra_per_1000', 57.0000, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (387, 40, 'printingRate', 'flexo', 'color_rate', 0.0960, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (388, 41, 'printingRate', 'flexo', 'color_rate', 0.0960, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (389, 42, 'printingRate', 'flexo', 'color_rate', 0.0960, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (390, 43, 'printingRate', 'flexo', 'color_rate', 0.0960, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (391, 40, 'finishing', 'LAMINATE', 'rate', 0.8600, '无溶剂复合', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (392, 41, 'finishing', 'LAMINATE', 'rate', 0.8600, '无溶剂复合', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (393, 42, 'finishing', 'LAMINATE', 'rate', 0.8600, '无溶剂复合', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (394, 43, 'finishing', 'LAMINATE', 'rate', 0.8600, '无溶剂复合', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (395, 40, 'finishing', 'BAG_3SEAL', 'rate', 0.0570, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (396, 41, 'finishing', 'BAG_3SEAL', 'rate', 0.0570, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (397, 42, 'finishing', 'BAG_3SEAL', 'rate', 0.0570, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (398, 43, 'finishing', 'BAG_3SEAL', 'rate', 0.0570, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (399, 40, 'finishing', 'BAG_CENTER', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (400, 41, 'finishing', 'BAG_CENTER', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (401, 42, 'finishing', 'BAG_CENTER', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (402, 43, 'finishing', 'BAG_CENTER', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (403, 40, 'finishing', 'BAG_STAND', 'rate', 0.1440, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (404, 41, 'finishing', 'BAG_STAND', 'rate', 0.1440, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (405, 42, 'finishing', 'BAG_STAND', 'rate', 0.1440, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (406, 43, 'finishing', 'BAG_STAND', 'rate', 0.1440, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (407, 40, 'finishing', 'BAG_ZIP', 'rate', 0.2400, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (408, 41, 'finishing', 'BAG_ZIP', 'rate', 0.2400, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (409, 42, 'finishing', 'BAG_ZIP', 'rate', 0.2400, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (410, 43, 'finishing', 'BAG_ZIP', 'rate', 0.2400, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (411, 40, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (412, 41, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (413, 42, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (414, 43, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:02:46', '2026-09-22 08:02:46');
INSERT INTO `factory_price_override` VALUES (442, 44, 'cardPaper', 'NW_80', 'price_per_sqm', 7.4000, '无纺布本地采购', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (443, 45, 'cardPaper', 'NW_80', 'price_per_sqm', 7.4000, '无纺布本地采购', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (444, 46, 'cardPaper', 'NW_80', 'price_per_sqm', 7.4000, '无纺布本地采购', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (445, 44, 'cardPaper', 'NW_100', 'price_per_sqm', 8.8000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (446, 45, 'cardPaper', 'NW_100', 'price_per_sqm', 8.8000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (447, 46, 'cardPaper', 'NW_100', 'price_per_sqm', 8.8000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (448, 44, 'cardPaper', 'NW_120', 'price_per_sqm', 10.2000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (449, 45, 'cardPaper', 'NW_120', 'price_per_sqm', 10.2000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (450, 46, 'cardPaper', 'NW_120', 'price_per_sqm', 10.2000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (451, 44, 'cardPaper', 'KRAFT120', 'price_per_sqm', 0.8100, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (452, 45, 'cardPaper', 'KRAFT120', 'price_per_sqm', 0.8100, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (453, 46, 'cardPaper', 'KRAFT120', 'price_per_sqm', 0.8100, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (454, 44, 'printingRate', 'screen', 'start_fee', 90.0000, '丝印机多', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (455, 45, 'printingRate', 'screen', 'start_fee', 90.0000, '丝印机多', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (456, 46, 'printingRate', 'screen', 'start_fee', 90.0000, '丝印机多', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (457, 44, 'printingRate', 'screen', 'extra_per_1000', 23.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (458, 45, 'printingRate', 'screen', 'extra_per_1000', 23.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (459, 46, 'printingRate', 'screen', 'extra_per_1000', 23.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (460, 44, 'printingRate', 'offset', 'start_fee', 770.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (461, 45, 'printingRate', 'offset', 'start_fee', 770.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (462, 46, 'printingRate', 'offset', 'start_fee', 770.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (463, 44, 'printingRate', 'offset', 'extra_per_1000', 77.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (464, 45, 'printingRate', 'offset', 'extra_per_1000', 77.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (465, 46, 'printingRate', 'offset', 'extra_per_1000', 77.0000, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (466, 44, 'finishing', 'SEWING', 'rate', 0.4600, '车缝车间', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (467, 45, 'finishing', 'SEWING', 'rate', 0.4600, '车缝车间', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (468, 46, 'finishing', 'SEWING', 'rate', 0.4600, '车缝车间', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (469, 44, 'finishing', 'ROPE', 'rate', 0.1380, '自动穿绳', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (470, 45, 'finishing', 'ROPE', 'rate', 0.1380, '自动穿绳', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (471, 46, 'finishing', 'ROPE', 'rate', 0.1380, '自动穿绳', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (472, 44, 'finishing', 'PACK', 'rate', 0.0460, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (473, 45, 'finishing', 'PACK', 'rate', 0.0460, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (474, 46, 'finishing', 'PACK', 'rate', 0.0460, '', '2026-09-22 08:02:50', '2026-09-22 08:02:50');
INSERT INTO `factory_price_override` VALUES (505, 47, 'cardPaper', 'HTF_FILM', 'price_per_sqm', 5.2000, '热转印膜产业带', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (506, 48, 'cardPaper', 'HTF_FILM', 'price_per_sqm', 5.2000, '热转印膜产业带', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (507, 47, 'printingRate', 'gravure', 'start_fee', 1440.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (508, 48, 'printingRate', 'gravure', 'start_fee', 1440.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (509, 47, 'printingRate', 'gravure', 'extra_per_1000', 58.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (510, 48, 'printingRate', 'gravure', 'extra_per_1000', 58.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (511, 47, 'printingRate', 'screen', 'start_fee', 95.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (512, 48, 'printingRate', 'screen', 'start_fee', 95.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (513, 47, 'printingRate', 'screen', 'extra_per_1000', 24.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (514, 48, 'printingRate', 'screen', 'extra_per_1000', 24.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (515, 47, 'finishing', 'DIE_CUT', 'plate_fee', 480.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (516, 48, 'finishing', 'DIE_CUT', 'plate_fee', 480.0000, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (517, 47, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (518, 48, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:02:55', '2026-09-22 08:02:55');
INSERT INTO `factory_price_override` VALUES (520, 49, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8300, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (521, 50, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8300, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (522, 49, 'cardPaper', 'COAT200', 'price_per_sqm', 0.6100, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (523, 50, 'cardPaper', 'COAT200', 'price_per_sqm', 0.6100, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (524, 49, 'printingRate', 'offset', 'start_fee', 780.0000, '高宝四色机', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (525, 50, 'printingRate', 'offset', 'start_fee', 780.0000, '高宝四色机', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (526, 49, 'printingRate', 'offset', 'extra_per_1000', 78.0000, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (527, 50, 'printingRate', 'offset', 'extra_per_1000', 78.0000, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (528, 49, 'printingRate', 'flexo', 'color_rate', 0.0960, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (529, 50, 'printingRate', 'flexo', 'color_rate', 0.0960, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (530, 49, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (531, 50, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (532, 49, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (533, 50, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (534, 49, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (535, 50, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (536, 49, 'finishing', 'FOLD', 'rate', 0.0480, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (537, 49, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (538, 50, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:03:00', '2026-09-22 08:03:00');
INSERT INTO `factory_price_override` VALUES (551, 7, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (552, 7, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (553, 7, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (554, 7, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (555, 7, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (556, 7, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (557, 7, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (558, 7, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (559, 7, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (566, 8, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8300, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (567, 8, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (568, 8, 'printingRate', 'offset', 'start_fee', 780.0000, '数字化管控效率高', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (569, 8, 'printingRate', 'offset', 'extra_per_1000', 78.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (570, 8, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (571, 8, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (572, 8, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (573, 8, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (574, 8, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (581, 10, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (582, 10, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (583, 10, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (584, 10, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (585, 10, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (586, 10, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (587, 10, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (588, 10, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (589, 10, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (596, 11, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (597, 11, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (598, 11, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (599, 11, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (600, 11, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (601, 11, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (602, 11, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (603, 11, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (604, 11, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (611, 12, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8300, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (612, 12, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (613, 12, 'printingRate', 'offset', 'start_fee', 780.0000, '数字化管控效率高', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (614, 12, 'printingRate', 'offset', 'extra_per_1000', 78.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (615, 12, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (616, 12, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (617, 12, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (618, 12, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (619, 12, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (626, 14, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8500, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (627, 14, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0200, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (628, 14, 'printingRate', 'offset', 'start_fee', 800.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (629, 14, 'printingRate', 'offset', 'extra_per_1000', 80.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (630, 14, 'printingRate', 'digital', 'min_charge', 5.2000, '文创小批量', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (631, 14, 'finishing', 'MATTE_FILM', 'rate', 0.6500, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (632, 14, 'finishing', 'HOT_STAMP', 'plate_fee', 350.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (633, 14, 'finishing', 'DIE_CUT', 'plate_fee', 500.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (634, 14, 'finishing', 'GLUE_BOX', 'rate', 0.0800, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (635, 14, 'finishing', 'PACK', 'rate', 0.0500, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (641, 18, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (642, 18, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (643, 18, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (644, 18, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (645, 18, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (646, 18, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (647, 18, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (648, 18, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (649, 18, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (656, 19, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (657, 19, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (658, 19, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (659, 19, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (660, 19, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (661, 19, 'finishing', 'HOT_STAMP', 'plate_fee', 345.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (662, 19, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (663, 19, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (664, 19, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (671, 20, 'cardPaper', 'CARD250', 'price_per_sqm', 0.8400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (672, 20, 'cardPaper', 'CARD300', 'price_per_sqm', 1.0100, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (673, 20, 'printingRate', 'offset', 'start_fee', 790.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (674, 20, 'printingRate', 'offset', 'extra_per_1000', 79.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (675, 20, 'printingRate', 'digital', 'min_charge', 4.5000, '数码印刷专精', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (676, 20, 'finishing', 'MATTE_FILM', 'rate', 0.6400, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (677, 20, 'finishing', 'DIE_CUT', 'plate_fee', 490.0000, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (678, 20, 'finishing', 'GLUE_BOX', 'rate', 0.0780, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (679, 20, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:24', '2026-09-22 08:04:24');
INSERT INTO `factory_price_override` VALUES (686, 26, 'printingRate', 'gravure', 'start_fee', 1400.0000, '12色北人凹印机', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (687, 26, 'printingRate', 'gravure', 'extra_per_1000', 56.0000, '效率高', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (688, 26, 'printingRate', 'flexo', 'color_rate', 0.0950, '', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (689, 26, 'finishing', 'LAMINATE', 'rate', 0.8700, '药包材资质', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (690, 26, 'finishing', 'BAG_3SEAL', 'rate', 0.0560, '', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (691, 26, 'finishing', 'BAG_CENTER', 'rate', 0.0460, '', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (692, 26, 'finishing', 'BAG_STAND', 'rate', 0.1420, '立体拉链袋', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (693, 26, 'finishing', 'BAG_ZIP', 'rate', 0.2400, '', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (694, 26, 'finishing', 'PACK', 'rate', 0.0470, '', '2026-09-22 08:04:30', '2026-09-22 08:04:30');
INSERT INTO `factory_price_override` VALUES (701, 35, 'cardPaper', 'HTF_FILM', 'price_per_sqm', 5.2500, '热转印膜自产', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (702, 35, 'cardPaper', 'NW_80', 'price_per_sqm', 7.6000, '无纺布本地采购', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (703, 35, 'printingRate', 'screen', 'start_fee', 95.0000, '全自动丝印机', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (704, 35, 'printingRate', 'screen', 'extra_per_1000', 24.0000, '', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (705, 35, 'printingRate', 'digital', 'min_charge', 4.8000, '数码打印机', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (706, 35, 'finishing', 'LAMINATE', 'rate', 0.9000, '', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (707, 35, 'finishing', 'SEWING', 'rate', 0.4800, '', '2026-09-22 08:04:36', '2026-09-22 08:04:36');
INSERT INTO `factory_price_override` VALUES (708, 35, 'finishing', 'PACK', 'rate', 0.0480, '', '2026-09-22 08:04:36', '2026-09-22 08:04:36');

-- ----------------------------
-- Table structure for factory_user
-- ----------------------------
DROP TABLE IF EXISTS `factory_user`;
CREATE TABLE `factory_user`  (
  `id` int(0) NOT NULL AUTO_INCREMENT,
  `factory_id` int(0) NOT NULL COMMENT '所属工厂',
  `username` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录名（全局唯一）',
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '密码散列',
  `real_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '真实姓名',
  `phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '手机号',
  `role` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sales' COMMENT 'owner/manager/sales/finance/designer/viewer',
  `status` tinyint(0) NULL DEFAULT 1 COMMENT '1=启用 0=禁用',
  `openid` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '绑定的微信 openid（微信一键登录用，全局唯一）',
  `last_login_at` timestamp(0) NULL DEFAULT NULL,
  `created_by` int(0) NULL DEFAULT NULL COMMENT '创建人（factory_user.id）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `username`(`username`) USING BTREE,
  UNIQUE INDEX `uk_factory_user_openid`(`openid`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 160 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '工厂员工账号表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of factory_user
-- ----------------------------

-- ----------------------------
-- Table structure for finishing_process
-- ----------------------------
DROP TABLE IF EXISTS `finishing_process`;
CREATE TABLE `finishing_process`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工艺编码，如 MATTE_FILM',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '工艺名称，如 覆哑膜',
  `mode` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '计价模式：perSqm / perSqm_withPlate / perUnit',
  `rate` decimal(10, 4) NOT NULL COMMENT '费率（perSqm按㎡；perUnit按件）',
  `plate_fee` decimal(10, 2) NULL COMMENT '版费（perSqm_withPlate模式使用）',
  `waste_rate` decimal(5, 4) NULL COMMENT '损耗率，如0.05=5%',
  `print_mode` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'all' COMMENT '适用印刷方式：all=全部',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用：1=启用 0=禁用',
  `small_qty_threshold` int(0) NULL DEFAULT 0 COMMENT '小批量阈值：数量低于此值触发上浮，0=不启用',
  `small_qty_factor` decimal(3, 2) NULL DEFAULT 1.00 COMMENT '小批量上浮系数，如1.50=上浮50%',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 45 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '后道工艺费率表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of finishing_process
-- ----------------------------
INSERT INTO `finishing_process` VALUES (1, 'MATTE_FILM', '覆哑膜', 'perSqm', 0.6500, 0.00, 0.0500, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (2, 'GLOSS_FILM', '覆光膜', 'perSqm', 0.6000, 0.00, 0.0500, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (3, 'UV_COAT', 'UV上光', 'perSqm', 0.3500, 0.00, 0.0300, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (4, 'CALENDAR', '压光', 'perSqm', 0.6000, 0.00, 0.0300, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (5, 'CORRUGATE', '瓦楞', 'perSqm', 1.7500, 0.00, 0.0200, 'offset', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (6, 'HOT_STAMP', '烫金', 'perSqm_withPlate', 0.8500, 350.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (7, 'EMBOSS_PROC', '击凸', 'perSqm_withPlate', 0.7000, 450.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (8, 'DIE_CUT', '模切异形', 'perSqm_withPlate', 0.5000, 500.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (9, 'GLUE_BOX', '粘箱', 'perUnit', 0.0800, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (10, 'PACK', '打包', 'perUnit', 0.0500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (11, 'ROPE', '穿绳打扣', 'perUnit', 0.1500, 0.00, 0.0000, 'all', 1, 3000, 1.50);
INSERT INTO `finishing_process` VALUES (12, 'FLOCK', '植绒', 'perSqm', 1.2000, 0.00, 0.0300, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (13, 'TEXTURE', '压纹', 'perSqm_withPlate', 0.4000, 300.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (14, 'FOLD', '折页', 'perUnit', 0.0500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (15, 'PUNCH', '打孔', 'perUnit', 0.0300, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (16, 'PERF', '打拢线', 'perUnit', 0.0300, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (17, 'SADDLE', '骑马订', 'perUnit', 0.1500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (18, 'PERFECT_BIND', '无线胶装', 'perUnit', 0.6000, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (19, 'SEW_BIND', '锁线胶装', 'perUnit', 1.2000, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (20, 'LAMINATE', '复合', 'perSqm', 0.9000, 0.00, 0.0200, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (21, 'BAG_3SEAL', '三边封制袋', 'perUnit', 0.0600, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (22, 'BAG_CENTER', '中封制袋', 'perUnit', 0.0500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (23, 'BAG_STAND', '自立袋制袋', 'perUnit', 0.1500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (24, 'BAG_ZIP', '拉链袋制袋', 'perUnit', 0.2500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (25, 'ROPE_COTTON', '棉绳拎手', 'perUnit', 0.2500, 0.00, 0.0000, 'all', 1, 3000, 1.50);
INSERT INTO `finishing_process` VALUES (26, 'CLASP', '塑料扣', 'perUnit', 0.2000, 0.00, 0.0000, 'all', 1, 3000, 1.50);
INSERT INTO `finishing_process` VALUES (27, 'SEWING', '车缝', 'perUnit', 0.5000, 0.00, 0.0000, 'all', 1, 3000, 1.50);
INSERT INTO `finishing_process` VALUES (28, 'LASER_AF', '激光防伪', 'perUnit', 0.0500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (29, 'SCRATCH', '刮刮银', 'perUnit', 0.0400, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (30, 'FLUOR', '荧光油墨', 'perUnit', 0.0300, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (31, 'VOID_AF', '揭开留底', 'perUnit', 0.0500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (32, 'TRACE_QR', '二维码溯源', 'perUnit', 0.0200, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (34, 'CUP_FORMING', '杯成型', 'perUnit', 0.0800, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (35, 'RIM_ROLLING', '卷边', 'perUnit', 0.0300, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (36, 'BOTTOM_SEAL', '底封', 'perUnit', 0.0300, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (37, 'TUBE_WINDING', '卷管', 'perUnit', 0.0600, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (38, 'LABELING', '贴标', 'perUnit', 0.0500, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (39, 'ASSEMBLY', '组装', 'perUnit', 0.1000, 0.00, 0.0000, 'all', 1, 0, 1.00);
INSERT INTO `finishing_process` VALUES (40, 'LINING', '内衬', 'perUnit', 0.1200, 0.00, 0.0000, 'all', 1, 0, 1.00);

-- ----------------------------
-- Table structure for flute_factor
-- ----------------------------
DROP TABLE IF EXISTS `flute_factor`;
CREATE TABLE `flute_factor`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `flute` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '楞型代码：A/B/C/E/BC/BE',
  `height` decimal(5, 2) NULL DEFAULT NULL COMMENT '楞高，单位 mm',
  `count` int(0) NULL DEFAULT NULL COMMENT '每30cm的楞数',
  `factor` decimal(5, 2) NOT NULL COMMENT '楞率系数，用于面积换算（数值越大用纸越多）',
  `description` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '楞型说明，如\"A楞 缓冲性好\"',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `flute`(`flute`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 7 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '楞型系数表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of flute_factor
-- ----------------------------
INSERT INTO `flute_factor` VALUES (1, 'A', 4.80, 34, 1.58, 'A楞 缓冲性好');
INSERT INTO `flute_factor` VALUES (2, 'B', 2.80, 50, 1.32, 'B楞 平面抗压好');
INSERT INTO `flute_factor` VALUES (3, 'C', 3.80, 38, 1.48, 'C楞 综合性能');
INSERT INTO `flute_factor` VALUES (4, 'E', 1.15, 93, 1.22, 'E楞 精细包装');
INSERT INTO `flute_factor` VALUES (5, 'BC', 3.30, 44, 1.90, '双坑组合');
INSERT INTO `flute_factor` VALUES (6, 'BE', 1.90, 71, 1.62, '双坑组合');

-- ----------------------------
-- Table structure for industry_news
-- ----------------------------
DROP TABLE IF EXISTS `industry_news`;
CREATE TABLE `industry_news`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `title` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '摘要',
  `content` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '正文(HTML或纯文本)',
  `source_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '来源名称',
  `source_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '原文链接',
  `cover_image` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '封面图',
  `category` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'market' COMMENT '分类：policy|market|tech|material',
  `published_at` datetime(0) NULL DEFAULT NULL COMMENT '原文发布时间',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `featured` tinyint(0) NOT NULL DEFAULT 0 COMMENT '是否精选 0/1',
  `editor_note` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '编辑推荐语',
  `editor_id` bigint(0) NULL DEFAULT NULL COMMENT '推荐管理员ID',
  `keywords` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '逗号分隔关键词',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_url`(`source_url`(200)) USING BTREE,
  INDEX `idx_category`(`category`) USING BTREE,
  INDEX `idx_published`(`published_at` DESC) USING BTREE,
  INDEX `idx_featured`(`featured`, `published_at`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '行业资讯(RSS抓取)' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of industry_news
-- ----------------------------

-- ----------------------------
-- Table structure for ink_type
-- ----------------------------
DROP TABLE IF EXISTS `ink_type`;
CREATE TABLE `ink_type`  (
  `id` int(0) NOT NULL AUTO_INCREMENT,
  `code` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '油墨编码',
  `name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '油墨名称',
  `price_factor` decimal(5, 2) NOT NULL DEFAULT 1.00 COMMENT '价格系数',
  `remark` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `is_active` tinyint(0) NULL DEFAULT 1,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '油墨类型表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of ink_type
-- ----------------------------
INSERT INTO `ink_type` VALUES (1, 'NORMAL', '普通油墨', 1.00, '标准CMYK四色', 1);
INSERT INTO `ink_type` VALUES (2, 'UV', 'UV油墨', 1.30, 'UV印刷，附着力强、光泽高', 1);
INSERT INTO `ink_type` VALUES (3, 'METALLIC', '金属油墨', 1.50, '金、银等金属色，成本高', 1);
INSERT INTO `ink_type` VALUES (4, 'FLUOR', '荧光油墨', 1.80, '荧光色，特殊工艺', 1);
INSERT INTO `ink_type` VALUES (5, 'SOY', '大豆油墨', 1.15, '环保油墨，食品包装常用', 1);

-- ----------------------------
-- Table structure for inquiry_message
-- ----------------------------
DROP TABLE IF EXISTS `inquiry_message`;
CREATE TABLE `inquiry_message`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `inquiry_id` bigint(0) NOT NULL COMMENT '询价ID，关联 c_inquiry.id',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID，关联 factory.id（会话对家）',
  `sender_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发送方：user=客户 factory=工厂 system=系统留痕（如工厂改价, sender_id=0）',
  `sender_id` bigint(0) NOT NULL COMMENT '发送者ID（user=c_end_user.id；factory=factory_user.id）',
  `content` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息内容（文件消息存预览文案：图片就「[图片]」、文档「[文件] 名字」, 供会话列表与站内信用）',
  `msg_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text' COMMENT '消息类型：text=文本 file=协同文件（渲染时按 file_id 关联 file_transfer 取名字/大小）',
  `file_id` bigint(0) NULL DEFAULT NULL COMMENT '关联 file_transfer.id（仅 msg_type=file）',
  `is_read` tinyint(0) NOT NULL DEFAULT 0 COMMENT '接收方是否已读 0否1是',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '发送时间',
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_thread`(`inquiry_id`, `factory_id`, `id`) USING BTREE,
  INDEX `idx_unread_factory`(`factory_id`, `is_read`) USING BTREE,
  INDEX `idx_unread_user`(`inquiry_id`, `sender_type`, `is_read`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '询价会话消息（买卖双方 IM，会话键 inquiry×factory）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of inquiry_message
-- ----------------------------

-- ----------------------------
-- Table structure for issue_ticket
-- ----------------------------
DROP TABLE IF EXISTS `issue_ticket`;
CREATE TABLE `issue_ticket`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `ticket_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '工单编号 IT+日期+序列',
  `order_id` bigint(0) NOT NULL COMMENT '关联订单ID',
  `user_id` bigint(0) NOT NULL COMMENT '发起用户',
  `factory_id` int(0) NOT NULL COMMENT '被诉工厂',
  `type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '问题类型：quality|delay|reprint|other',
  `title` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '标题',
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '详细描述',
  `images` json NULL COMMENT '截图URL数组(最多6)',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open' COMMENT '状态：open|processing|resolved|closed',
  `factory_reply` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '工厂回复',
  `factory_reply_at` datetime(0) NULL DEFAULT NULL COMMENT '工厂回复时间',
  `admin_note` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '管理员备注',
  `resolved_at` datetime(0) NULL DEFAULT NULL COMMENT '解决时间',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_ticket_no`(`ticket_no`) USING BTREE,
  INDEX `idx_order`(`order_id`) USING BTREE,
  INDEX `idx_user`(`user_id`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE,
  INDEX `idx_status`(`status`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '异常反馈工单' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of issue_ticket
-- ----------------------------

-- ----------------------------
-- Table structure for file_transfer
-- ----------------------------
DROP TABLE IF EXISTS `file_transfer`;
CREATE TABLE `file_transfer`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `ref_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联类型：inquiry=询价会话 order=订单 issue=工单凭证',
  `ref_id` bigint(0) NOT NULL COMMENT '关联询价/订单/工单ID',
  `sender_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '发送方：user=客户 factory=工厂 admin=运营（sender_id 为工厂时存 factory.id 而非 factory_user.id）',
  `sender_id` bigint(0) NOT NULL COMMENT '发送方ID',
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原始文件名（上传时按 UTF-8 还原, 非落盘名）',
  `file_url` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '存储相对路径（/uploads/files/xxx, 拼 URL 时须按段转义, 名字里可能有中文）',
  `file_size` int(0) NOT NULL COMMENT '字节',
  `mime_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'MIME类型（图片判定优先看它）',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_ref`(`ref_type`, `ref_id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '协同文件传输记录' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of file_transfer
-- ----------------------------

-- ----------------------------
-- Table structure for order_logistics
-- ----------------------------
DROP TABLE IF EXISTS `order_logistics`;
CREATE TABLE `order_logistics`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `order_id` bigint(0) NOT NULL COMMENT '关联order_main.id',
  `express_company` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '快递公司编码（快递100）：SF/ZTO/YTO/STO/YD/EMS/JD/JTSD/DB',
  `express_company_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '快递公司中文名（录入时冗余，编码列表变更不影响历史单）',
  `express_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '快递单号',
  `sender_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '发件人',
  `receiver_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '收件人',
  `receiver_phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '收件电话',
  `receiver_address` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '收件地址快照（发货时从订单地址快照复制，改地址簿不影响在途单）',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'pending' COMMENT '物流状态：pending已录入/shipped已揽件/delivering运输中/signed已签收',
  `track_detail` json NULL COMMENT '最新物流轨迹缓存（快递100归一化：[{time,context}]）',
  `last_track_time` timestamp(0) NULL DEFAULT NULL COMMENT '最新物流轨迹更新时间',
  `ship_time` timestamp(0) NULL DEFAULT NULL COMMENT '发货时间',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_order`(`order_id`) USING BTREE,
  INDEX `idx_express_no`(`express_no`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '订单物流信息表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of order_logistics
-- ----------------------------

-- ----------------------------
-- Table structure for order_main
-- ----------------------------
DROP TABLE IF EXISTS `order_main`;
CREATE TABLE `order_main`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单号，如 OD202609190001',
  `inquiry_id` bigint(0) NULL DEFAULT NULL COMMENT '关联询价 c_inquiry.id（唯一，防止重复生成）',
  `user_id` bigint(0) NULL DEFAULT NULL COMMENT '下单用户 c_end_user.id（匿名询价可为空）',
  `factory_id` int(0) NOT NULL COMMENT '承接工厂ID，关联 factory.id',
  `customer_id` int(0) NULL DEFAULT NULL COMMENT '管理端客户ID（可选）',
  `product_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '产品类型：carton/cardBox/card',
  `print_mode` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '印刷方式',
  `length_m` decimal(10, 4) NULL DEFAULT NULL COMMENT '长（米）',
  `width_m` decimal(10, 4) NULL DEFAULT NULL COMMENT '宽（米）',
  `height_m` decimal(10, 4) NULL DEFAULT NULL COMMENT '高（米）',
  `quantity` int(0) NOT NULL DEFAULT 0 COMMENT '数量',
  `material_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '材料类型：rawPaper/boardPaper/cardPaper',
  `material_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '材料编码',
  `color_count` int(0) NULL DEFAULT 4 COMMENT '色数',
  `processes` json NULL COMMENT '后道工艺代码数组',
  `unit_price` decimal(12, 4) NULL DEFAULT NULL COMMENT '单价（工厂报价折算）',
  `total_price` decimal(12, 2) NULL DEFAULT NULL COMMENT '订单总价（工厂报价）',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '状态：pending=待确认 confirmed=已确认 producing=生产中 shipped=已发货 completed=已完成 cancelled=已取消',
  `pay_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid' COMMENT '支付状态：unpaid=未支付 paid=已支付 refunded=已退款',
  `pay_method` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '支付方式（预留：wechat/alipay/mock）',
  `paid_at` timestamp(0) NULL DEFAULT NULL COMMENT '支付时间',
  `contact_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系人',
  `contact_phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '联系电话',
  `address` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '收货地址',
  `address_id` bigint(0) NULL DEFAULT NULL COMMENT '收货地址ID（user_address.id）',
  `address_snapshot` json NULL COMMENT '下单时地址快照（改地址簿不影响历史订单）',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  `shipping_fee` decimal(10, 2) NULL COMMENT '运费（工厂确认订单时按默认模板计算）',
  `sample_fee` decimal(10, 2) NULL COMMENT '打样费（随首款一并支付）',
  `sample_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'none' COMMENT '打样进度：none=无打样 sent=样品已寄 confirmed=客户已确认',
  `weight_kg` decimal(10, 3) NULL DEFAULT NULL COMMENT '货物重量kg（按重计费的模板需要，工厂确认时填写）',
  `shipped_at` timestamp(0) NULL DEFAULT NULL COMMENT '发货时间',
  `logistics_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'pending' COMMENT '物流状态：pending/shipped/delivering/signed',
  `rating` tinyint(0) NULL DEFAULT NULL COMMENT '用户评分 1-5',
  `rated_at` timestamp(0) NULL DEFAULT NULL COMMENT '评分时间',
  `escrow_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'none' COMMENT '担保状态：none=无担保 frozen=资金冻结 released=已放款 refunded=已退款 partial_refund=部分退款',
  `platform_fee` decimal(10, 2) NULL DEFAULT NULL COMMENT '平台服务费',
  `factory_amount` decimal(10, 2) NULL DEFAULT NULL COMMENT '工厂实收金额',
  `profit_sharing_no` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '微信分账单号',
  `released_at` datetime(0) NULL DEFAULT NULL COMMENT '放款时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `order_no`(`order_no`) USING BTREE,
  UNIQUE INDEX `uk_inquiry`(`inquiry_id`) USING BTREE,
  INDEX `idx_user`(`user_id`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE,
  INDEX `idx_status`(`status`) USING BTREE,
  INDEX `idx_escrow`(`escrow_status`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 41 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '订单主表（工厂接单后生成）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of order_main
-- ----------------------------

-- ----------------------------
-- Table structure for plastic_film
-- ----------------------------
DROP TABLE IF EXISTS `plastic_film`;
CREATE TABLE `plastic_film`  (
  `id` int(0) NOT NULL AUTO_INCREMENT,
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '薄膜编码，如 PP_40',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '薄膜名称，如 PP 4丝',
  `material` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '材质：PP/PE/PET/PA/ALU',
  `thickness_um` int(0) NOT NULL COMMENT '厚度，单位μm（1丝=10μm）',
  `density` decimal(6, 4) NOT NULL COMMENT '比重，单位 g/cm³',
  `price_per_kg` decimal(10, 2) NOT NULL COMMENT '每公斤单价，元/kg',
  `supplier` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '供应商',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用：1=启用 0=禁用',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 20 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '塑料薄膜价格表（软包装按重量计价）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of plastic_film
-- ----------------------------
INSERT INTO `plastic_film` VALUES (1, 'PP_40', 'PP 4丝', 'PP', 40, 0.9100, 14.60, '金田集团', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');
INSERT INTO `plastic_film` VALUES (2, 'PP_60', 'PP 6丝', 'PP', 60, 0.9100, 14.20, '金田集团', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');
INSERT INTO `plastic_film` VALUES (3, 'PE_50', 'PE 5丝', 'PE', 50, 0.9200, 13.80, '强盟实业', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');
INSERT INTO `plastic_film` VALUES (4, 'PE_80', 'PE 8丝', 'PE', 80, 0.9200, 13.50, '强盟实业', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');
INSERT INTO `plastic_film` VALUES (5, 'PET_35', 'PET 3.5丝', 'PET', 35, 1.3800, 16.50, '浙江B材料', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');
INSERT INTO `plastic_film` VALUES (6, 'PA_30', '尼龙 3丝', 'PA', 30, 1.1400, 26.00, '浙江B材料', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');
INSERT INTO `plastic_film` VALUES (7, 'ALU_70', '铝箔 7丝', 'ALU', 70, 2.7000, 32.00, '华东铝业', 1, '2026-09-20 07:49:46', '2026-09-20 07:49:46');

-- ----------------------------
-- Table structure for plate_type
-- ----------------------------
DROP TABLE IF EXISTS `plate_type`;
CREATE TABLE `plate_type`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版材编码，如 CTP',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '版材名称，如 CTP胶印版',
  `unit_price` decimal(10, 2) NOT NULL COMMENT '单价，单位 元/张 或 元/版',
  `unit` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT '元/张' COMMENT '计价单位',
  `print_mode` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '适用印刷方式：offset/flexo/gravure/all',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用：1=启用 0=禁用',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 8 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '版材价格表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of plate_type
-- ----------------------------
INSERT INTO `plate_type` VALUES (1, 'CTP', 'CTP胶印版', 80.00, '元/张', 'offset', 1);
INSERT INTO `plate_type` VALUES (2, 'FLEXO', '柔性版', 400.00, '元/版', 'flexo', 1);
INSERT INTO `plate_type` VALUES (3, 'GRAVURE', '凹印版辊', 800.00, '元/版', 'gravure', 1);
INSERT INTO `plate_type` VALUES (4, 'HOTFOIL', '烫金版', 350.00, '元/版', 'all', 1);
INSERT INTO `plate_type` VALUES (5, 'EMBOSS', '击凸版', 450.00, '元/版', 'all', 1);
INSERT INTO `plate_type` VALUES (6, 'DIECUT', '模切刀版', 500.00, '元/版', 'all', 1);
INSERT INTO `plate_type` VALUES (7, 'SPOT_COLOR', '专色版', 350.00, '元/色', 'offset', 1);

-- ----------------------------
-- Table structure for platform_fee_ledger
-- ----------------------------
DROP TABLE IF EXISTS `platform_fee_ledger`;
CREATE TABLE `platform_fee_ledger`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `order_id` bigint(0) NOT NULL COMMENT '订单ID',
  `order_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单号',
  `inquiry_no` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '询价单号',
  `order_amount` decimal(12, 2) NOT NULL COMMENT '订单成交金额',
  `fee_rate` decimal(5, 4) NOT NULL COMMENT '服务费率（如 0.0500）',
  `fee_amount` decimal(12, 2) NOT NULL COMMENT '服务费金额',
  `pay_method` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '支付渠道：wechat/offline/mock',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending=待分账（服务商资质下发后执行分账）；settled=已分账',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `settled_at` timestamp(0) NULL DEFAULT NULL COMMENT '分账完成时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_order`(`order_id`) USING BTREE,
  INDEX `idx_status`(`status`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 10 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '平台服务费台账（F-57；分账链路 F-44 待支付服务商资质）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of platform_fee_ledger
-- ----------------------------

-- ----------------------------
-- Table structure for printing_rate
-- ----------------------------
DROP TABLE IF EXISTS `printing_rate`;
CREATE TABLE `printing_rate`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `print_mode` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '印刷方式：offset=胶印 flexo=柔印 gravure=凹印 digital=数码',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '印刷方式名称',
  `mode` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '计价模式：perSqm=按㎡ perUnit=按件 startFee=开机费+加印',
  `color_rate` decimal(10, 4) NULL COMMENT '每色每㎡费率（perSqm模式使用）',
  `start_fee` decimal(10, 2) NULL COMMENT '开机费（startFee模式使用）',
  `extra_per_1000` decimal(10, 2) NULL COMMENT '每千印加价（startFee模式使用）',
  `min_charge` decimal(10, 2) NULL COMMENT '最低收费 / perUnit模式的单件费率',
  `description` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注说明',
  `ink_factor_low` decimal(5, 2) NULL DEFAULT 1.00 COMMENT '少量图案油墨系数',
  `ink_factor_mid` decimal(5, 2) NULL DEFAULT 1.30 COMMENT '中等图案油墨系数',
  `ink_factor_high` decimal(5, 2) NULL DEFAULT 1.80 COMMENT '满版图案油墨系数',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `print_mode`(`print_mode`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 6 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '印工费率表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of printing_rate
-- ----------------------------
INSERT INTO `printing_rate` VALUES (1, 'offset', '胶印', 'startFee', 0.0000, 800.00, 80.00, 800.00, '对开四色开机800元/套', 1.00, 1.30, 1.80);
INSERT INTO `printing_rate` VALUES (2, 'flexo', '柔印', 'perSqm', 0.1000, 0.00, 0.00, 300.00, '每色每㎡约0.10元', 1.00, 1.30, 1.80);
INSERT INTO `printing_rate` VALUES (3, 'gravure', '凹印', 'startFee', 0.0000, 1500.00, 60.00, 1500.00, '凹印版辊成本高', 1.00, 1.30, 1.80);
INSERT INTO `printing_rate` VALUES (4, 'digital', '数码印', 'perUnit', 0.0000, 0.00, 0.00, 5.00, '无版费，按张计费', 1.00, 1.30, 1.80);
INSERT INTO `printing_rate` VALUES (5, 'screen', '丝印', 'startFee', 0.0000, 100.00, 25.00, 100.00, '丝印制版费低·按色加收·适合无纺布袋/纸袋单色', 1.00, 1.30, 1.80);

-- ----------------------------
-- Table structure for product_config
-- ----------------------------
DROP TABLE IF EXISTS `product_config`;
CREATE TABLE `product_config`  (
  `id` int(0) NOT NULL AUTO_INCREMENT,
  `product_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '产品类型代码',
  `product_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '产品中文名',
  `allowed_print_modes` json NULL COMMENT '允许的印刷方式数组',
  `allowed_materials` json NULL COMMENT '允许的材料编码数组',
  `allowed_processes` json NULL COMMENT '允许的后道工艺编码数组',
  `sort_order` int(0) NULL DEFAULT 0 COMMENT '排序',
  `moq` int(0) NULL DEFAULT NULL COMMENT '起订量（低于则加收小单费）',
  `moq_factor` decimal(4, 2) NULL DEFAULT NULL COMMENT '低于起订量时的加价系数（默认1.5）',
  `is_active` tinyint(0) NULL DEFAULT 1,
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  `show_pattern_cover` tinyint(0) NULL DEFAULT 1 COMMENT '是否显示图案覆盖率',
  `show_ink_type` tinyint(0) NULL DEFAULT 1 COMMENT '是否显示油墨类型',
  `show_spot_colors` tinyint(0) NULL DEFAULT 1 COMMENT '是否显示专色数量',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `product_type`(`product_type`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 14 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '产品类型联动配置' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of product_config
-- ----------------------------
INSERT INTO `product_config` VALUES (1, 'carton', '纸箱', '[\"offset\", \"flexo\", \"digital\"]', '[\"B_A3\", \"B_B3\", \"B_C3\", \"B_E3\", \"B_BC5\", \"B_BE5\", \"B_BCE7\"]', '[\"MATTE_FILM\", \"GLOSS_FILM\", \"HOT_STAMP\", \"DIE_CUT\", \"GLUE_BOX\", \"PACK\"]', 1, 500, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 1, 1, 1);
INSERT INTO `product_config` VALUES (2, 'cardBox', '彩盒', '[\"offset\", \"digital\"]', '[\"CARD250\", \"CARD300\", \"COAT200\", \"KRAFT120\", \"KRAFT200\"]', '[\"MATTE_FILM\", \"GLOSS_FILM\", \"UV_COAT\", \"HOT_STAMP\", \"EMBOSS_PROC\", \"DIE_CUT\", \"FLOCK\", \"TEXTURE\", \"GLUE_BOX\", \"PACK\"]', 2, 500, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 1, 1, 1);
INSERT INTO `product_config` VALUES (3, 'card', '卡片', '[\"offset\", \"digital\"]', '[\"CARD250\", \"CARD300\", \"COAT200\", \"KRAFT120\"]', '[\"MATTE_FILM\", \"GLOSS_FILM\", \"UV_COAT\", \"HOT_STAMP\", \"EMBOSS_PROC\", \"DIE_CUT\", \"PUNCH\", \"PERF\", \"PACK\"]', 3, 100, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 1, 1, 1);
INSERT INTO `product_config` VALUES (4, 'paperBag', '纸袋', '[\"offset\", \"flexo\", \"digital\", \"screen\"]', '[\"KRAFT120\", \"KRAFT200\", \"KRAFT300\", \"CARD250\", \"CARD300\"]', '[\"MATTE_FILM\", \"GLOSS_FILM\", \"UV_COAT\", \"HOT_STAMP\", \"EMBOSS_PROC\", \"DIE_CUT\", \"ROPE\", \"ROPE_COTTON\", \"CLASP\", \"PACK\"]', 4, 500, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 1, 1, 1);
INSERT INTO `product_config` VALUES (5, 'sticker', '不干胶', '[\"offset\", \"flexo\", \"digital\"]', '[\"STK_COPPER\", \"STK_PET\", \"STK_SYNTH\", \"STK_THERMAL\", \"STK_PETSILVER\"]', '[\"MATTE_FILM\", \"GLOSS_FILM\", \"HOT_STAMP\", \"DIE_CUT\", \"PUNCH\", \"PERF\", \"PACK\"]', 5, 1000, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 1, 1, 1);
INSERT INTO `product_config` VALUES (6, 'flexiblePackaging', '软包装', '[\"flexo\", \"gravure\"]', '[\"PP_40\", \"PP_60\", \"PE_50\", \"PE_80\", \"PET_35\", \"PA_30\", \"ALU_70\"]', '[\"LAMINATE\", \"BAG_3SEAL\", \"BAG_CENTER\", \"BAG_STAND\", \"BAG_ZIP\", \"PACK\"]', 6, 5000, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 0, 0, 0);
INSERT INTO `product_config` VALUES (7, 'nonWovenBag', '无纺布袋', '[\"offset\", \"digital\", \"screen\"]', '[\"NW_80\", \"NW_100\", \"NW_120\"]', '[\"SEWING\", \"ROPE\", \"ROPE_COTTON\", \"CLASP\", \"PACK\"]', 7, 500, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 0, 0, 0);
INSERT INTO `product_config` VALUES (8, 'antiCounterfeitLabel', '防伪标签', '[\"offset\", \"flexo\", \"digital\"]', '[\"STK_COPPER\", \"STK_PET\", \"STK_PETSILVER\", \"STK_SYNTH\"]', '[\"LASER_AF\", \"SCRATCH\", \"FLUOR\", \"VOID_AF\", \"TRACE_QR\", \"DIE_CUT\", \"PACK\"]', 8, 1000, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 0, 1, 1);
INSERT INTO `product_config` VALUES (9, 'heatTransfer', '热转印', '[\"gravure\", \"offset\"]', '[\"HTF_FILM\"]', '[\"DIE_CUT\", \"PACK\"]', 9, 500, 1.50, 1, '2026-09-20 08:37:58', '2026-10-23 07:50:43', 0, 0, 0);
INSERT INTO `product_config` VALUES (10, 'paperContainer', '纸容器', '[\"flexo\", \"offset\", \"digital\"]', '[\"CUP_PE\", \"CUP_PLA\", \"FOOD_CARD\", \"FOOD_KRAFT\"]', '[\"DIE_CUT\", \"CUP_FORMING\", \"RIM_ROLLING\", \"BOTTOM_SEAL\", \"TUBE_WINDING\", \"LABELING\", \"ASSEMBLY\", \"LINING\", \"PACK\"]', 10, 10000, 1.50, 1, '2026-09-21 08:41:18', '2026-10-23 07:50:43', 0, 1, 0);

-- ----------------------------
-- Table structure for profit_sharing_log
-- ----------------------------
DROP TABLE IF EXISTS `profit_sharing_log`;
CREATE TABLE `profit_sharing_log`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `order_id` bigint(0) NOT NULL COMMENT '关联订单ID',
  `action` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'initiate|query|return|finish',
  `request_body` json NULL COMMENT '请求原文',
  `response_body` json NULL COMMENT '响应原文',
  `success` tinyint(0) NULL DEFAULT 0 COMMENT '是否成功',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_order`(`order_id`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '分账操作日志' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of profit_sharing_log
-- ----------------------------

-- ----------------------------
-- Table structure for quote_order
-- ----------------------------
DROP TABLE IF EXISTS `quote_order`;
CREATE TABLE `quote_order`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `quote_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '报价单号，如 Q202609180001',
  `factory_id` int(0) NOT NULL DEFAULT 0 COMMENT '工厂ID（0=系统默认价）',
  `factory_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '工厂名称快照',
  `customer_id` int(0) NULL DEFAULT NULL COMMENT '客户ID',
  `customer_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '客户名称快照',
  `discount_rate` decimal(5, 4) NOT NULL DEFAULT 1.0000 COMMENT '客户折扣快照（1=原价，0.95=九五折）',
  `product_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '产品类型：carton=纸箱 cardBox=彩盒 card=卡片',
  `print_mode` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '印刷方式：offset/flexo/gravure/digital',
  `length_m` decimal(10, 4) NOT NULL COMMENT '长，单位 米',
  `width_m` decimal(10, 4) NOT NULL COMMENT '宽，单位 米',
  `height_m` decimal(10, 4) NULL COMMENT '高，单位 米',
  `quantity` int(0) NOT NULL COMMENT '数量',
  `material_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '材料类型：rawPaper/boardPaper/cardPaper',
  `material_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '材料编码',
  `material_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '材料名称快照',
  `color_count` int(0) NULL DEFAULT 4 COMMENT '色数',
  `plate_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '版材编码',
  `processes` json NULL COMMENT '后道工艺代码数组，如[\"MATTE_FILM\",\"GLUE_BOX\"]',
  `waste_rate` decimal(5, 4) NULL DEFAULT 0.0400 COMMENT '损耗率',
  `target_margin` decimal(5, 4) NULL DEFAULT 0.1500 COMMENT '目标毛利率',
  `tax_rate` decimal(5, 4) NULL DEFAULT 0.1000 COMMENT '税率',
  `subtotal` decimal(12, 2) NULL DEFAULT NULL COMMENT '成本小计（不含利润、不含税）',
  `unit_cost` decimal(10, 4) NULL DEFAULT NULL COMMENT '单件成本',
  `unit_price` decimal(10, 4) NULL DEFAULT NULL COMMENT '单件报价（含利润，不含税）',
  `total_price` decimal(12, 2) NULL DEFAULT NULL COMMENT '报价总价（不含税）',
  `tax_amount` decimal(12, 2) NULL DEFAULT NULL COMMENT '税额',
  `final_price` decimal(12, 2) NULL DEFAULT NULL COMMENT '最终含税价',
  `discount_amount` decimal(12, 2) NOT NULL COMMENT '优惠金额（原含税价-折后含税价）',
  `breakdown` json NULL COMMENT '成本拆解（材料/版费/印工/后道明细）',
  `status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT 'draft' COMMENT '状态：draft/sent/accepted/rejected',
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `quote_no`(`quote_no`) USING BTREE,
  INDEX `idx_factory`(`factory_id`) USING BTREE,
  INDEX `idx_customer`(`customer_id`) USING BTREE,
  INDEX `idx_status`(`status`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = 'B端报价单' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of quote_order
-- ----------------------------

-- ----------------------------
-- Table structure for raw_paper
-- ----------------------------
DROP TABLE IF EXISTS `raw_paper`;
CREATE TABLE `raw_paper`  (
  `id` int(0) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原纸编码，如 KRAFT170',
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '原纸名称，如 牛卡170',
  `grammage` int(0) NOT NULL COMMENT '克重，单位 g/m²',
  `price_per_ton` decimal(10, 2) NOT NULL COMMENT '每吨价格，单位 元/吨',
  `paper_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '纸类型：kraft=牛皮卡纸 corrugating=瓦楞芯纸 linerboard=箱板纸',
  `supplier` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '供应商名称',
  `is_local` tinyint(0) NULL DEFAULT 0 COMMENT '是否龙港本地供应商：1=本地 0=外地',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用：1=启用 0=禁用',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0) COMMENT '更新时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `code`(`code`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 8 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '原纸价格表（按吨采购）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of raw_paper
-- ----------------------------
INSERT INTO `raw_paper` VALUES (1, 'KRAFT170', '牛卡170', 170, 3800.00, 'kraft', '龙港A纸业', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `raw_paper` VALUES (2, 'KRAFT140', '牛卡140', 140, 3600.00, 'kraft', '龙港A纸业', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `raw_paper` VALUES (3, 'KRAFT200', '牛卡200', 200, 4000.00, 'kraft', '龙港A纸业', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `raw_paper` VALUES (4, 'CORR110', '高瓦110', 110, 3200.00, 'corrugating', '龙港B纸业', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `raw_paper` VALUES (5, 'CORR140', '高瓦140', 140, 3400.00, 'corrugating', '龙港B纸业', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `raw_paper` VALUES (6, 'CORR180', '普瓦180', 180, 3000.00, 'corrugating', '龙港B纸业', 1, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');
INSERT INTO `raw_paper` VALUES (7, 'LINER280', '箱板纸280', 280, 3500.00, 'linerboard', '浙江C纸业', 0, 1, '2026-09-18 08:54:23', '2026-09-18 08:54:23');

-- ----------------------------
-- Table structure for schema_migrations
-- ----------------------------
DROP TABLE IF EXISTS `schema_migrations`;
CREATE TABLE `schema_migrations`  (
  `filename` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '迁移文件名',
  `checksum` char(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '文件内容 sha1',
  `applied_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '登记时间',
  PRIMARY KEY (`filename`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci COMMENT = '已执行迁移登记（scripts/migrate.js 维护）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of schema_migrations
-- ----------------------------

-- ----------------------------
-- Table structure for shipping_template
-- ----------------------------
DROP TABLE IF EXISTS `shipping_template`;
CREATE TABLE `shipping_template`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模板名称',
  `mode` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '计费方式：weight按重/piece按件/fixed固定',
  `first_weight_kg` decimal(10, 3) NULL DEFAULT 1.000 COMMENT '首重(kg)，weight模式用',
  `first_fee` decimal(10, 2) NULL COMMENT '首重费用(元)，weight模式用',
  `extra_weight_kg` decimal(10, 3) NULL DEFAULT 1.000 COMMENT '续重单位(kg)，weight模式用',
  `extra_fee` decimal(10, 2) NULL COMMENT '每续重单位费用(元)，weight模式用',
  `piece_fee` decimal(10, 2) NULL COMMENT '单件运费(元)，piece模式用',
  `fixed_fee` decimal(10, 2) NULL COMMENT '固定运费(元)，fixed模式用',
  `free_threshold` decimal(12, 2) NULL COMMENT '满额包邮金额(元)，0=不包邮',
  `is_default` tinyint(0) NULL DEFAULT 0 COMMENT '是否默认模板（全表至多一个）',
  `is_active` tinyint(0) NULL DEFAULT 1 COMMENT '是否启用',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 5 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '运费模板表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of shipping_template
-- ----------------------------
INSERT INTO `shipping_template` VALUES (1, '默认模板（固定10元·满500包邮）', 'fixed', 1.000, 0.00, 1.000, 0.00, 0.00, 10.00, 500.00, 1, 1, '2026-09-20 12:02:10', '2026-09-20 12:57:25');

-- ----------------------------
-- Table structure for supplier_follow
-- ----------------------------
DROP TABLE IF EXISTS `supplier_follow`;
CREATE TABLE `supplier_follow`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(0) NOT NULL COMMENT 'C端用户',
  `factory_id` int(0) NOT NULL COMMENT '工厂ID',
  `tags` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '逗号分隔自定义标签',
  `note` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '备注',
  `pinned` tinyint(0) NOT NULL DEFAULT 0 COMMENT '是否置顶',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_factory`(`user_id`, `factory_id`) USING BTREE,
  INDEX `idx_user`(`user_id`, `pinned`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户关注供应商' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of supplier_follow
-- ----------------------------

-- ----------------------------
-- Table structure for user_address
-- ----------------------------
DROP TABLE IF EXISTS `user_address`;
CREATE TABLE `user_address`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(0) NOT NULL COMMENT 'C端用户ID，关联c_end_user.id',
  `contact_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '联系人姓名',
  `contact_phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '联系电话',
  `province` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '省',
  `city` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '市',
  `district` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '区',
  `detail_address` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '详细地址',
  `is_default` tinyint(0) NULL DEFAULT 0 COMMENT '是否默认地址',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  INDEX `idx_user`(`user_id`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 9 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户收货地址表' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of user_address
-- ----------------------------

-- ----------------------------
-- Table structure for user_news_subscription
-- ----------------------------
DROP TABLE IF EXISTS `user_news_subscription`;
CREATE TABLE `user_news_subscription`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `user_id` bigint(0) NOT NULL COMMENT 'C端用户',
  `category` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'policy|market|tech|material 或 all',
  `enabled` tinyint(0) NOT NULL DEFAULT 1 COMMENT '是否推送',
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  `updated_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `uk_user_cat`(`user_id`, `category`) USING BTREE,
  INDEX `idx_cat`(`category`, `enabled`) USING BTREE
) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '用户资讯订阅分类' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of user_news_subscription
-- ----------------------------

-- ----------------------------
-- Table structure for user_session
-- ----------------------------
DROP TABLE IF EXISTS `user_session`;
CREATE TABLE `user_session`  (
  `id` bigint(0) NOT NULL AUTO_INCREMENT,
  `user_type` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'admin/customer/factory',
  `user_id` bigint(0) NOT NULL COMMENT '用户ID（admin_user.id / c_end_user.id / factory.id）',
  `factory_user_id` int(0) NULL DEFAULT NULL COMMENT '工厂员工ID（user_type=factory 时对应 factory_user.id）',
  `token` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话令牌',
  `device_info` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '设备信息',
  `ip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT '登录IP',
  `expires_at` datetime(0) NULL DEFAULT NULL COMMENT '过期时间（滑动续期；NULL=不限期，兼容旧数据）',
  `last_active_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),
  `created_at` timestamp(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE INDEX `token`(`token`) USING BTREE,
  INDEX `idx_user`(`user_type`, `user_id`) USING BTREE,
  INDEX `idx_expires`(`expires_at`) USING BTREE
) ENGINE = InnoDB AUTO_INCREMENT = 381 CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '统一会话表（支持多设备登录）' ROW_FORMAT = Dynamic;

-- ----------------------------
-- Records of user_session
-- ----------------------------

SET FOREIGN_KEY_CHECKS = 1;
