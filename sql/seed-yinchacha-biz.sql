-- =====================================================
-- 印查查功能业务链路「原始数据」种子（幂等，可反复执行）
-- 补齐 13 张空表：c_inquiry / factory_inquiry_push / inquiry_message / quote_order
--   / order_main / order_logistics / platform_fee_ledger / profit_sharing_log
--   / issue_ticket / file_transfer / c_message / user_address / factory_media
-- 执行：node scripts/seed-run.js sql/seed-yinchacha-biz.sql
-- 前置：uploads/ 不入 git，factory_media/file_transfer 引用的图片需先在目标环境准备：
--   新建 uploads/factory-media/seed/，从 uploads/designs/ 复制并重命名：
--   ai_1792402063527_73.png→fm_equip_1.png  ai_1792465445683_311.png→fm_work_1.png
--   ai_1792474132933_615.png→fm_sample_1.png ai_1792724007433_109.png→fm_equip_2.png
--   ai_1792724065453_816.png→fm_work_2.png  ai_1792746059301_849.png→fm_sample_2.png
--   ai_1792402077507_758.png→fm_equip_3.png ai_1792465613150_4.png→fm_sample_3.png
--   tpl_1_1792400398005_84.png→tpl_preview.png（缺图不报错，仅详情图集/凭证预览404）
-- 业务故事线（用户32 · 工厂1/4/9）：
--   询价CQ4条(报价中/工厂已报价/已转化/已推送) → 订单OD3条(生产中/已发货签收前/完成已放款)
--   → 物流2条(在途/已签收) → 工单3条(open/processing/closed) → 文件传输4条(issue+order)
--   → IM 9条 → 分账台账 → 消息中心 → 地址簿 → 工厂图集
-- =====================================================

-- ---------- 1) 收货地址 user_address ----------
INSERT INTO `user_address` (`id`, `user_id`, `contact_name`, `contact_phone`, `province`, `city`, `district`, `detail_address`, `is_default`) VALUES
  (1, 32, '陈成', '18958854112', '浙江省', '温州市', '龙港市', '世纪大道新雅工业园40号楼 一楼仓库', 0),
  (2, 32, '林夏', '13700001111', '浙江省', '温州市', '鹿城区', '车站大道555号贸易大厦801室', 1),
  (3, 32, '陈成', '18958854112', '广东省', '广州市', '白云区', '嘉禾望岗工业区B12栋对面仓库', 0)
ON DUPLICATE KEY UPDATE `detail_address` = VALUES(`detail_address`), `is_default` = VALUES(`is_default`);

-- ---------- 2) 询价单 c_inquiry（显式 id 11-14，避开 AUTO_INCREMENT=30） ----------
INSERT INTO `c_inquiry`
  (`id`, `inquiry_no`, `user_id`, `product_type`, `print_mode`, `length_m`, `width_m`, `height_m`,
   `contact_phone`, `contact_name`, `quantity`, `material_type`, `material_code`, `color_count`,
   `box_type`, `n_up`, `processes`, `system_quote`, `status`, `matched_factory_id`,
   `quoted_factory_id`, `quoted_price`, `quoted_at`, `factory_quoted_price`, `factory_quoted_at`,
   `factory_quote_remark`, `user_confirmed_at`, `expires_at`, `created_at`,
   `pattern_cover`, `ink_type`, `spot_colors`, `design_status`, `design_note`) VALUES
  -- ① 仅系统报价（报价中）
  (11, 'CQ202610260001', 32, 'carton', 'offset', 0.35, 0.24, 0.18,
   '18958854112', '陈成', 15000, 'boardPaper', 'B_BC5', 4,
   NULL, 2, '["MATTE_FILM"]', '{"finalPrice":10350.00,"unitPrice":0.69}', 'matched', 1,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, DATE_ADD(NOW(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY),
   'mid', 'NORMAL', 0, 'none', NULL),
  -- ② 工厂已报价（待用户确认）——IM 与推送的主场景
  (12, 'CQ202610260002', 32, 'cardBox', 'offset', 0.25, 0.20, 0.08,
   '18958854112', '陈成', 5000, 'cardPaper', 'CARD350', 4,
   'lidBase', 1, '["MATTE_FILM","EMBOSS","HOT_FOIL"]', '{"finalPrice":16500.00,"unitPrice":3.30}', 'factory_quoted', 9,
   9, 14800.00, DATE_SUB(NOW(), INTERVAL 20 HOUR), 14800.00, DATE_SUB(NOW(), INTERVAL 22 HOUR),
   '天地盖精品盒含烫金，1500起做，交期12天；含设计费500', NULL, DATE_ADD(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY),
   'high', 'UV', 1, 'need', '门店礼盒，深蓝色金logo，走文艺风'),
  -- ③ 已转化为订单 OD202610200009
  (13, 'CQ202610200019', 32, 'cardBox', 'offset', 0.12, 0.08, 0.03,
   '18958854112', '陈成', 10000, 'cardPaper', 'CARD250', 4,
   'normal', 4, '["GLOSS_FILM","GLUE_BOX"]', '{"finalPrice":11800.00,"unitPrice":1.18}', 'converted', 4,
   4, 12800.00, DATE_SUB(NOW(), INTERVAL 8 DAY), 12800.00, DATE_SUB(NOW(), INTERVAL 7 DAY),
   '拼版4-up，版费已含', DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 9 DAY),
   'mid', 'NORMAL', 0, 'none', NULL),
  -- ④ 撮合推送中（工厂未响应）
  (14, 'CQ202610270001', 32, 'nonWovenBag', 'screen', 0.35, 0.40, 0.10,
   '18958854112', '陈成', 10000, 'other', 'NW_80', 2,
   NULL, 1, '["SEWING"]', '{"finalPrice":9200.00,"unitPrice":0.92}', 'matched', 9,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, DATE_ADD(NOW(), INTERVAL 6 DAY), DATE_SUB(NOW(), INTERVAL 4 HOUR),
   'low', 'NORMAL', 0, 'none', NULL)
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `factory_quoted_price` = VALUES(`factory_quoted_price`);

-- ---------- 3) 工厂询价推送 factory_inquiry_push ----------
INSERT INTO `factory_inquiry_push` (`inquiry_id`, `factory_id`, `factory_quote`, `push_time`, `view_time`, `respond_time`, `response`) VALUES
  (12, 9, 14800.00, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 23 HOUR), DATE_SUB(NOW(), INTERVAL 22 HOUR), 'accept'),
  (12, 4, NULL,    DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 30 HOUR), NULL, 'pending'),
  (12, 1, NULL,    DATE_SUB(NOW(), INTERVAL 2 DAY), NULL, DATE_SUB(NOW(), INTERVAL 40 HOUR), 'decline'),
  (13, 4, 12800.00, DATE_SUB(NOW(), INTERVAL 9 DAY), DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 7 DAY), 'accept'),
  (14, 9, NULL,    DATE_SUB(NOW(), INTERVAL 4 HOUR), NULL, NULL, 'pending')
ON DUPLICATE KEY UPDATE `factory_quote` = VALUES(`factory_quote`), `response` = VALUES(`response`);

-- ---------- 4) IM 会话 inquiry_message（CQ12 × 工厂9 / 工厂4） ----------
INSERT INTO `inquiry_message` (`id`, `inquiry_id`, `factory_id`, `sender_type`, `sender_id`, `content`, `is_read`, `created_at`) VALUES
  (1, 12, 9, 'user',     32, '你好，天地盖礼盒5000个，12天内能交付吗？logo要烫金', 1, DATE_SUB(NOW(), INTERVAL 47 HOUR)),
  (2, 12, 9, 'factory',  9,  '可以的，烫金版我们有现成色卡，确认稿后12天交付',     1, DATE_SUB(NOW(), INTERVAL 46 HOUR)),
  (3, 12, 9, 'factory',  9,  '正式报价14800元，含设计费500，专色金潘通871C',       1, DATE_SUB(NOW(), INTERVAL 22 HOUR)),
  (4, 12, 9, 'user',     32, '价格OK，设计稿明天发你，麻烦先出个烫金样',           1, DATE_SUB(NOW(), INTERVAL 20 HOUR)),
  (5, 12, 9, 'factory',  9,  '收到，样品明天下午顺丰寄出',                         0, DATE_SUB(NOW(), INTERVAL 19 HOUR)),
  (6, 12, 4, 'user',     32, '你们那边同类礼盒什么价位？也想比个价',               1, DATE_SUB(NOW(), INTERVAL 45 HOUR)),
  (7, 12, 4, 'factory',  4,  '带烫金天地盖5000只大约15500-16500，看工艺复杂度',    0, DATE_SUB(NOW(), INTERVAL 30 HOUR)),
  (8, 12, 4, 'factory',  4,  '如果不要专色金可以压到15000以内',                    0, DATE_SUB(NOW(), INTERVAL 30 HOUR)),
  (9, 14, 9, 'user',     32, '无纺布袋一万只车缝工艺，80克布料，多久能出货？',     0, DATE_SUB(NOW(), INTERVAL 3 HOUR))
ON DUPLICATE KEY UPDATE `content` = VALUES(`content`);

-- ---------- 5) B端报价单 quote_order ----------
INSERT INTO `quote_order`
  (`id`, `quote_no`, `factory_id`, `factory_name`, `customer_id`, `customer_name`, `discount_rate`,
   `product_type`, `print_mode`, `length_m`, `width_m`, `height_m`, `quantity`,
   `material_type`, `material_code`, `material_name`, `color_count`, `plate_code`,
   `processes`, `waste_rate`, `target_margin`, `tax_rate`,
   `subtotal`, `unit_cost`, `unit_price`, `total_price`, `tax_amount`, `final_price`,
   `status`, `remark`, `created_at`) VALUES
  (5, 'Q202610260001', 1, '浙江新雅包装有限公司', 1, NULL, 1.0000,
   'carton', 'offset', 0.35, 0.24, 0.18, 15000,
   'boardPaper', 'B_BC5', '双坑BC楞', 4, 'CTP',
   '["MATTE_FILM"]', 0.0400, 0.1500, 0.1000,
   8300.00, 0.5533, 0.6900, 10350.00, 1035.00, 11385.00,
   'sent', '电商周转箱，哑膜，含模切', DATE_SUB(NOW(), INTERVAL 1 DAY)),
  (6, 'Q202610200009', 4, '浙江鑫祥印业有限公司', 1, NULL, 0.9500,
   'cardBox', 'offset', 0.12, 0.08, 0.03, 10000,
   'cardPaper', 'CARD250', '250g白卡', 4, 'CTP',
   '["GLOSS_FILM","GLUE_BOX"]', 0.0400, 0.1500, 0.1000,
   9800.00, 0.9800, 1.2160, 12160.00, 1216.00, 12801.60,
   'accepted', '拼版4-up，覆光膜自动糊盒', DATE_SUB(NOW(), INTERVAL 8 DAY))
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `final_price` = VALUES(`final_price`);

-- ---------- 6) 订单 order_main（3 条覆盖全生命周期 + 担保分账状态） ----------
INSERT INTO `order_main`
  (`id`, `order_no`, `inquiry_id`, `user_id`, `factory_id`, `customer_id`,
   `product_type`, `print_mode`, `length_m`, `width_m`, `height_m`, `quantity`,
   `material_type`, `material_code`, `color_count`, `processes`,
   `unit_price`, `total_price`, `status`, `pay_status`, `pay_method`, `paid_at`,
   `contact_name`, `contact_phone`, `address`, `address_id`, `remark`,
   `shipping_fee`, `weight_kg`, `shipped_at`, `logistics_status`,
   `rating`, `rated_at`, `escrow_status`, `platform_fee`, `factory_amount`, `released_at`, `created_at`) VALUES
  -- ① 生产中 · 担保冻结（对应询价 CQ202610200019）
  (31, 'OD202610200009', 13, 32, 4, 1,
   'cardBox', 'offset', 0.12, 0.08, 0.03, 10000,
   'cardPaper', 'CARD250', 4, '["GLOSS_FILM","GLUE_BOX"]',
   1.2800, 12800.00, 'producing', 'paid', 'wechat', DATE_SUB(NOW(), INTERVAL 6 DAY),
   '陈成', '18958854112', '浙江省温州市龙港市世纪大道新雅工业园40号楼 一楼仓库', 1, '分两批交付，先出6000个',
   0.00, NULL, NULL, 'pending',
   NULL, NULL, 'frozen', 384.00, 12416.00, NULL, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  -- ② 已发货 · 在途（B端成单，未确认收货，担保冻结中）
  (32, 'OD202610260001', NULL, 32, 1, 1,
   'carton', 'offset', 0.35, 0.24, 0.18, 15000,
   'boardPaper', 'B_BC5', 4, '["MATTE_FILM"]',
   0.6900, 10350.00, 'shipped', 'paid', 'wechat', DATE_SUB(NOW(), INTERVAL 5 DAY),
   '林夏', '13700001111', '浙江省温州市鹿城区车站大道555号贸易大厦801室', 2, '哑膜电商箱，直发门店',
   320.00, 810.500, DATE_SUB(NOW(), INTERVAL 3 DAY), 'delivering',
   NULL, NULL, 'frozen', 310.50, 10039.50, NULL, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  -- ③ 历史单 · 完成已放款已评价
  (33, 'OD202609250006', NULL, 32, 9, 1,
   'cardBox', 'offset', 0.25, 0.20, 0.08, 3000,
   'cardPaper', 'CARD350', 4, '["MATTE_FILM","EMBOSS"]',
   3.6000, 10800.00, 'completed', 'paid', 'wechat', DATE_SUB(NOW(), INTERVAL 32 DAY),
   '陈成', '18958854112', '浙江省温州市龙港市世纪大道新雅工业园40号楼 一楼仓库', 1, '首发礼盒批次',
   0.00, 180.200, DATE_SUB(NOW(), INTERVAL 24 DAY), 'signed',
   5, DATE_SUB(NOW(), INTERVAL 12 DAY), 'released', 324.00, 10476.00, DATE_SUB(NOW(), INTERVAL 11 DAY), DATE_SUB(NOW(), INTERVAL 33 DAY))
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `logistics_status` = VALUES(`logistics_status`), `escrow_status` = VALUES(`escrow_status`);

-- ---------- 7) 物流 order_logistics ----------
INSERT INTO `order_logistics`
  (`id`, `order_id`, `express_company`, `express_company_name`, `express_no`,
   `sender_name`, `receiver_name`, `receiver_phone`, `receiver_address`,
   `status`, `track_detail`, `last_track_time`, `ship_time`) VALUES
  (5, 32, 'ZTO', '中通快递', '75812345678901',
   '浙江新雅包装', '林夏', '13700001111', '浙江省温州市鹿城区车站大道555号贸易大厦801室',
   'delivering',
   '[{"time":"2026-10-26 09:12","context":"【温州市】浙江温州龙港市公司-刘接收Fast"},{"time":"2026-10-26 15:40","context":"【温州市】已发往 温州转运中心"},{"time":"2026-10-27 02:11","context":"【温州市】已到达 温州转运中心"},{"time":"2026-10-27 07:35","context":"【温州市】已发往 鹿城区分部"},{"time":"2026-10-27 08:50","context":"【温州市鹿城区】分部已接收，派件中"}]',
   DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (6, 33, 'SF', '顺丰速运', 'SF1380012345678',
   '浙江博润印刷', '陈成', '18958854112', '浙江省温州市龙港市世纪大道新雅工业园40号楼',
   'signed',
   '[{"time":"2026-10-03 10:02","context":"【温州市】顺丰已揽收"},{"time":"2026-10-04 06:20","context":"运输中"},{"time":"2026-10-04 18:44","context":"【温州市】派件中"},{"time":"2026-10-04 19:30","context":"已签收，签收人：前台 王"}]',
   DATE_SUB(NOW(), INTERVAL 22 DAY), DATE_SUB(NOW(), INTERVAL 24 DAY))
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

-- ---------- 8) 平台服务费台账 platform_fee_ledger ----------
INSERT INTO `platform_fee_ledger`
  (`order_id`, `order_no`, `inquiry_no`, `order_amount`, `fee_rate`, `fee_amount`, `pay_method`, `status`, `settled_at`, `created_at`) VALUES
  (31, 'OD202610200009', 'CQ202610200019', 12800.00, 0.0300, 384.00, 'wechat', 'pending', NULL, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (32, 'OD202610260001', NULL, 10350.00, 0.0300, 310.50, 'wechat', 'pending', NULL, DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (33, 'OD202609250006', NULL, 10800.00, 0.0300, 324.00, 'wechat', 'settled', DATE_SUB(NOW(), INTERVAL 11 DAY), DATE_SUB(NOW(), INTERVAL 33 DAY))
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `fee_amount` = VALUES(`fee_amount`);

-- ---------- 9) 分账流水 profit_sharing_log ----------
INSERT INTO `profit_sharing_log` (`id`, `order_id`, `action`, `request_body`, `response_body`, `success`, `created_at`) VALUES
  (1, 31, 'initiate', '{"out_order_no":"OD202610200009","freeze":true,"receivers":[{"type":"MERCHANT_ID","amount":12416.00}]}', '{"code":"SUCCESS","message":"成功"}', 1, DATE_SUB(NOW(), INTERVAL 6 DAY)),
  (2, 33, 'initiate', '{"out_order_no":"OD202609250006","freeze":true,"receivers":[{"type":"MERCHANT_ID","amount":10476.00}]}', '{"code":"SUCCESS","message":"成功"}', 1, DATE_SUB(NOW(), INTERVAL 32 DAY)),
  (3, 33, 'finish',   '{"out_order_no":"OD202609250006","description":"确认收货解冻放款"}', '{"code":"SUCCESS","state":"FINISHED"}', 1, DATE_SUB(NOW(), INTERVAL 11 DAY))
ON DUPLICATE KEY UPDATE `success` = VALUES(`success`);

-- ---------- 10) 异常工单 issue_ticket ----------
INSERT INTO `issue_ticket`
  (`id`, `ticket_no`, `order_id`, `user_id`, `factory_id`, `type`, `title`, `description`,
   `images`, `status`, `factory_reply`, `factory_reply_at`, `admin_note`, `resolved_at`, `created_at`) VALUES
  (1, 'IT202610250001', 32, 32, 1, 'quality', '外箱印刷色差，蓝色偏紫',
   '到货批次里大约200个箱子专蓝偏紫，与确认样差异明显，附对比照片，请处理。',
   '["/uploads/factory-media/seed/fm_sample_1.png"]', 'processing',
   '已核查为油墨批次问题，可安排补印200个或退差价600元，请您选一种方案。', DATE_SUB(NOW(), INTERVAL 8 HOUR),
   '已介入，两家历史合作良好，优先协商补印', NULL, DATE_SUB(NOW(), INTERVAL 26 HOUR)),
  (2, 'IT202610260002', 31, 32, 4, 'delay', '希望交期提前3天',
   '门店活动改期，第一批6000个能否从11月3日提前到10月31日？',
   NULL, 'open', NULL, NULL, NULL, NULL, DATE_SUB(NOW(), INTERVAL 6 HOUR)),
  (3, 'IT202609210001', 33, 32, 9, 'reprint', '礼盒内衬压痕不良已补印结案',
   '30个内衬卡纸模切压痕不良，工厂已补印并随第二批货发出。',
   NULL, 'closed', '补印完成，已随10月3日批次全部发出。', DATE_SUB(NOW(), INTERVAL 25 DAY),
   '结案：质量问题属实，费用由工厂承担', DATE_SUB(NOW(), INTERVAL 20 DAY), DATE_SUB(NOW(), INTERVAL 36 DAY))
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `factory_reply` = VALUES(`factory_reply`);

-- ---------- 11) 协同文件传输 file_transfer（issue 凭证 + order 印稿交付） ----------
-- 图片类文件需先复制到 uploads/factory-media/seed/（见文件头部说明）
INSERT INTO `file_transfer` (`id`, `ref_type`, `ref_id`, `sender_type`, `sender_id`, `file_name`, `file_url`, `file_size`, `mime_type`, `created_at`) VALUES
  (1, 'issue', 1, 'user',    32, '色差对比照-批次20261025.png', '/uploads/factory-media/seed/fm_sample_1.png', 0, 'image/png', DATE_SUB(NOW(), INTERVAL 26 HOUR)),
  (2, 'issue', 1, 'factory',  1, '油墨批次检测报告.pdf',        '/uploads/designs/tpl_1_1792469396851_9.pdf',  0, 'application/pdf', DATE_SUB(NOW(), INTERVAL 9 HOUR)),
  (3, 'order', 31, 'user',    32, '终稿印製排版文件.pdf',        '/uploads/designs/tpl_1_1792469505145_914.pdf', 0, 'application/pdf', DATE_SUB(NOW(), INTERVAL 5 DAY)),
  (4, 'order', 32, 'factory',  1, '大货装箱清单.pdf',            '/uploads/designs/tpl_1_1792474207139_538.pdf', 0, 'application/pdf', DATE_SUB(NOW(), INTERVAL 3 DAY))
ON DUPLICATE KEY UPDATE `file_url` = VALUES(`file_url`);

-- ---------- 12) C端消息中心 c_message ----------
INSERT INTO `c_message` (`id`, `user_id`, `type`, `title`, `content`, `ref_type`, `ref_id`, `is_read`, `created_at`) VALUES
  (1, 32, 'note_accepted', '工厂已报价：天地盖礼盒 5000个', '博润印刷报价 ¥14,800（含烫金，交期12天），请在有效期内确认', 'inquiry', 12, 0, DATE_SUB(NOW(), INTERVAL 22 HOUR)),
  (2, 32, 'system',        '订单已发货',                   'OD202610260001 中通快递 75812345678901 派送中，签收后7天自动放款给工厂', 'order', 32, 0, DATE_SUB(NOW(), INTERVAL 3 DAY)),
  (3, 32, 'system',        '工单处理进展',                 'IT202610250001 工厂已回复：可补印200个或退差价600元，请选择方案', 'issue', 1, 1, DATE_SUB(NOW(), INTERVAL 8 HOUR)),
  (4, 32, 'system',        '报价即将到期',                 'CQ202610200019 转化订单已进入生产，如需变更工艺请在24小时内联系工厂', 'inquiry', 13, 1, DATE_SUB(NOW(), INTERVAL 4 DAY))
ON DUPLICATE KEY UPDATE `content` = VALUES(`content`);

-- ---------- 13) 工厂图集 factory_media（新雅1/鑫祥4/博润9） ----------
INSERT INTO `factory_media` (`id`, `factory_id`, `media_type`, `url`, `caption`, `sort`, `audit_status`) VALUES
  (1, 1, 'equipment', '/uploads/factory-media/seed/fm_equip_1.png', '海德堡对开四色机×2',       1, 'approved'),
  (2, 1, 'workshop',  '/uploads/factory-media/seed/fm_work_1.png',  '模切糊盒车间实拍',          2, 'approved'),
  (3, 1, 'product',   '/uploads/factory-media/seed/fm_sample_1.png','BC楞哑膜电商箱样品',        3, 'approved'),
  (4, 4, 'equipment', '/uploads/factory-media/seed/fm_equip_2.png', '博瑞机械三折糊盒线',        1, 'approved'),
  (5, 4, 'workshop',  '/uploads/factory-media/seed/fm_work_2.png',  '烫金击凸作业区',            2, 'approved'),
  (6, 4, 'product',   '/uploads/factory-media/seed/fm_sample_2.png','白卡天地盖精品盒量产样',    3, 'approved'),
  (7, 9, 'equipment', '/uploads/factory-media/seed/fm_equip_3.png', '小森四开四色+CTP直接出版',  1, 'approved'),
  (8, 9, 'workshop',  '/uploads/factory-media/seed/fm_work_1.png',  '无尘裱糊车间',              2, 'approved'),
  (9, 9, 'product',   '/uploads/factory-media/seed/fm_sample_3.png','卡牌/礼盒多场景包装样',     3, 'approved'),
  (10, 9, 'product',  '/uploads/factory-media/seed/tpl_preview.png','礼盒排版刀模图（可下载）',  4, 'approved')
ON DUPLICATE KEY UPDATE `caption` = VALUES(`caption`);

-- ---------- 核对 ----------
SELECT 'user_address' t, COUNT(*) cnt FROM user_address
UNION ALL SELECT 'c_inquiry', COUNT(*) FROM c_inquiry
UNION ALL SELECT 'factory_inquiry_push', COUNT(*) FROM factory_inquiry_push
UNION ALL SELECT 'inquiry_message', COUNT(*) FROM inquiry_message
UNION ALL SELECT 'quote_order', COUNT(*) FROM quote_order
UNION ALL SELECT 'order_main', COUNT(*) FROM order_main
UNION ALL SELECT 'order_logistics', COUNT(*) FROM order_logistics
UNION ALL SELECT 'platform_fee_ledger', COUNT(*) FROM platform_fee_ledger
UNION ALL SELECT 'profit_sharing_log', COUNT(*) FROM profit_sharing_log
UNION ALL SELECT 'issue_ticket', COUNT(*) FROM issue_ticket
UNION ALL SELECT 'file_transfer', COUNT(*) FROM file_transfer
UNION ALL SELECT 'c_message', COUNT(*) FROM c_message
UNION ALL SELECT 'factory_media', COUNT(*) FROM factory_media;
