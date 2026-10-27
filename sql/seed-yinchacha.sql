-- =====================================================
-- 印查查功能补齐后「系统原始数据」种子（幂等，可反复执行）
-- 覆盖：行业资讯(精选/编辑推荐) · 工厂验真分级 · 产能状态 · 供应商关注 · 资讯订阅
-- 执行：mysql -u <用户> -p <库名> < sql/seed-yinchacha.sql
--   或本地：node -e "..."（本项目开发环境）
-- 说明：参照竞品印查查「印刷产业链平台」定位构造的真实感演示数据；
--       published_at 用相对时间，保证抓取/推送窗口（24h）始终有数据可命中。
-- =====================================================

-- ---------- 1) 行业资讯 industry_news（12 条：policy3 / market4 / tech3 / material2） ----------
-- INSERT IGNORE 依赖 uk_url(source_url 前200字符) 去重
INSERT IGNORE INTO `industry_news`
  (`title`, `summary`, `content`, `source_name`, `source_url`, `category`, `published_at`, `featured`, `editor_note`, `editor_id`, `keywords`) VALUES
-- policy 政策
('国家新闻出版署部署2026年印刷业绿色转型专项行动',
 '重点区域印刷企业VOCs治理改造期限明确，柔性版与数码印刷占比将纳入考核指标。',
 '近日，主管部门印发印刷业绿色转型年度工作要点，要求重点区域企业在年底前完成挥发性有机物治理设施升级改造，推广水性油墨、UV油墨替代溶剂型油墨，并将柔性版印刷、数码印刷产能占比纳入绿色工厂评价体系。合规改造可申领专项资金补贴。',
 '科印网', 'https://www.keyin.cn/news/policy-2026-green-print', 'policy', DATE_SUB(NOW(), INTERVAL 30 MINUTE), 1,
 '绿色改造窗口期已到，有出口订单的工厂建议优先完成VOCs合规，避免丢单。', 1, '绿色印刷,VOCs,政策补贴'),
('印刷业纳入"专精特新"重点培育目录，包装细分赛道补贴加码',
 '多地对获得省级专精特新认定的印刷包装企业给予30-100万元一次性奖励。',
 '工信部相关培育目录将功能性包装、智能标签、绿色印刷材料列入重点方向。浙江、广东等地陆续出台配套政策，对通过省级专精特新认定的印刷包装企业给予一次性奖励，并在技改贷款贴息、用地用能方面倾斜。',
 '中国印刷与包装协会', 'https://www.keyin.cn/news/policy-srlz-2026', 'policy', DATE_SUB(NOW(), INTERVAL 2 HOUR), 0,
 NULL, NULL, '专精特新,补贴,包装'),
('电子监管码新规落地：药品包装印刷企业需在年内完成赋码产线改造',
 '药品追溯码与电子监管码二码合一，赋码精度与数据上传时效提出硬性要求。',
 '药监部门明确药品电子监管码与追溯码融合方案，要求药盒印刷企业在交付批次内完成一物一码赋码、关联关系上传。具备喷码、RFID与可变数据印刷能力的企业迎来增量订单窗口。',
 '印刷周刊', 'https://www.printweek.cn/news/drug-code-2026', 'policy', DATE_SUB(NOW(), INTERVAL 1 DAY), 0,
 NULL, NULL, '药品包装,追溯码,一物一码'),
-- market 市场
('瓦楞纸箱板纸价格环比上涨6.8%，纸箱厂利润承压启动新一轮调价',
 '原料端旺季备货叠加废纸回收量下滑，华东主要纸板厂已发布提价函。',
 '据纸业联讯数据，进入旺季后箱板纸、瓦楞原纸均价环比上涨6.8%，主要源于电商备货与废纸回收量阶段性下滑。龙港、温州一带纸箱厂已陆续上调纸板采购成本传导报价3%-5%，预计调价将持续至四季度末。',
 '纸业联讯', 'https://www.keyin.cn/news/market-carton-price-q4', 'market', DATE_SUB(NOW(), INTERVAL 3 HOUR), 1,
 '近两周有纸箱采购计划的建议提前锁价，行情仍在上行通道。', 1, '瓦楞纸,涨价,纸箱'),
('电商包装定制需求同比增长两成，小批量柔性订单成为工厂新增长点',
 'DTC品牌起量，500-3000件的小批量彩盒、贴纸订单询单量显著上升。',
 '电商平台数据显示，新消费品牌包装定制订单量同比增长约20%，单批量下降、翻单频次上升。具备数码印刷+短交期能力的工厂更易承接此类柔性订单，闲置中小产能撮合平台热度随之走高。',
 '包装前沿', 'https://www.keyin.cn/news/market-ecom-pack', 'market', DATE_SUB(NOW(), INTERVAL 2 DAY), 0,
 NULL, NULL, '电商包装,小批量,柔性生产'),
('精品礼盒市场进入旺季节奏，烟酒茶礼品盒交期普遍收紧',
 '中秋国庆后婚庆与年货档期接续，头部礼盒厂产能排至45天以后。',
 '节令消费接续带动精品礼盒需求，烫金、击凸、天地盖工艺组合订单占比提升。华东多家礼盒厂反馈排产已至45天后，建议品牌方提前锁定产能并预留工艺样确认时间。',
 '中国包装联合会', 'https://www.keyin.cn/news/market-giftbox-peak', 'market', DATE_SUB(NOW(), INTERVAL 3 DAY), 1,
 '礼盒旺季排产紧张，平台可关注产能状态为"空闲"的工厂承接加急单。', 1, '礼盒,交期,旺季'),
('秋季绿色教材印制招标启动，绿色认证成硬门槛',
 '秋季教材印制项目集中开标，要求企业具备十环或FSC认证。',
 '多地教育出版社启动新学年教材印制招标，绿色印刷认证、装订质量追溯与到书时效被写入评标硬性条款。规模书刊厂凭认证与轮转产能优势中标率明显提高。',
 '印刷技术杂志', 'https://www.keyin.cn/news/market-textbook-bid', 'market', DATE_SUB(NOW(), INTERVAL 5 DAY), 0,
 NULL, NULL, '书刊,招标,绿色认证');

-- tech 技术
INSERT IGNORE INTO `industry_news`
  (`title`, `summary`, `content`, `source_name`, `source_url`, `category`, `published_at`, `featured`, `editor_note`, `editor_id`, `keywords`) VALUES
('长杰数码推出新一代单pass水性数码瓦楞设备，速度提升40%',
 '水性墨水+视觉套准，产能达每小时8000平方米，直击短版彩箱市场。',
 '新一代单pass水性数码瓦楞印刷设备在德鲁巴后续订单会上发布，采用水性墨水与在线视觉套准系统，实测产能较上一代提升40%，起订量可低至100个，适合电商小批量多批次彩箱生产模式。',
 '数码印刷前沿', 'https://www.keyin.cn/news/tech-digital-corrugated', 'tech', DATE_SUB(NOW(), INTERVAL 6 HOUR), 0,
 NULL, NULL, '数码印刷,瓦楞,单pass'),
('冷烫+局部UV组合工艺设备国产化率突破七成，成本下探30%',
 '过去依赖进口的冷烫机组实现国产替代，精品包装增值工艺门槛降低。',
 '国产冷烫机组与LED-UV局部上光单元近三年快速迭代，组合工艺设备国产化率已超70%，整机与耗材成本较进口方案下降约30%，中小印刷厂加装增值工艺的投入回收期缩短至两年以内。',
 '科印网', 'https://www.keyin.cn/news/tech-foil-uv-local', 'tech', DATE_SUB(NOW(), INTERVAL 4 DAY), 0,
 NULL, NULL, '冷烫,局部UV,国产设备'),
('一物一码营销云与喷码产线直连方案成熟，标签厂转型服务商',
 '赋码+数据服务打包报价成为不干胶企业第二增长曲线。',
 '可变数据喷码与营销云平台实现产线级直连，标签厂可在印刷交付之外按码量与数据服务持续收费。多家龙港标签企业已上线该模式，单厂年增服务收入超百万元。',
 '标识周报', 'https://www.keyin.cn/news/tech-dynamic-code-saas', 'tech', DATE_SUB(NOW(), INTERVAL 7 DAY), 0,
 NULL, NULL, '一物一码,不干胶,数字化');

-- material 材料
INSERT IGNORE INTO `industry_news`
  (`title`, `summary`, `content`, `source_name`, `source_url`, `category`, `published_at`, `featured`, `editor_note`, `editor_id`, `keywords`) VALUES
('食品级低迁移UV油墨通过国标检测，纸盒直接食品接触应用场景打开',
 '通过GB 9685合规审查，替代溶剂型油墨进程加速。',
 '两款国产低迁移UV油墨完成食品接触材料新国标全项检测，可用于纸盒、纸杯的外印及内折区域，VOCs排放趋零。下游食品包装印刷企业可在不换设备的前提下完成合规切换。',
 '中国油墨协会', 'https://www.keyin.cn/news/material-low-migration-uv', 'material', DATE_SUB(NOW(), INTERVAL 10 HOUR), 0,
 NULL, NULL, 'UV油墨,食品接触,低迁移'),
('竹纤维模塑餐盒成本降至塑料1.2倍，限塑令扩围催生产线投资热',
 '模塑热压工艺突破使纸浆模塑餐盒良品率提升至92%。',
 '竹浆模塑餐盒量产成本已降至同规格塑料餐盒的1.2倍，叠加限塑令向外卖包装扩围，广东、浙江新增模塑产线投资明显加快。具备模具开发能力的传统印刷厂正跨界切入模塑包装赛道。',
 '包装前沿', 'https://www.keyin.cn/news/material-molded-pulp', 'material', DATE_SUB(NOW(), INTERVAL 6 DAY), 0,
 NULL, NULL, '纸浆模塑,限塑令,餐盒'),
('超细瓦纹微坑纸箱量产，高端3C包装替代部分覆膜需求',
 'E坑微瓦楞平整度接近卡纸，免覆膜即可直接精细印刷。',
 '微坑(E坑+纳米级瓦线)纸箱表面平整度大幅提升，四色+净上光即可达到接近胶印的精细效果，省去覆膜工序且可回收。已在小家电、3C配件包装中批量替代裱E瓦方案。',
 '瓦楞包装技术', 'https://www.keyin.cn/news/material-micro-flute', 'material', DATE_SUB(NOW(), INTERVAL 8 DAY), 0,
 NULL, NULL, '微坑瓦楞,3C包装,免覆膜');

-- ---------- 2) 工厂验真分级（0/1/2/3，参照印查查工厂验真徽章） ----------
-- 3级=深度验厂（有真实成交与评价的头部厂）
UPDATE `factory` SET `verification_level` = 3, `license_verified` = 1,
  `verified_at` = NOW(), `verification_note` = '深度验厂：营业执照+实地核查+近半年5笔以上成交，评分达标'
 WHERE `id` IN (1, 4);
-- 2级=实地/视频验厂
UPDATE `factory` SET `verification_level` = 2, `license_verified` = 1,
  `verified_at` = NOW(), `verification_note` = '视频验厂通过：车间实拍与设备清单核对一致'
 WHERE `id` IN (2, 3, 9, 17);
-- 1级=营业执照已核
UPDATE `factory` SET `verification_level` = 1, `license_verified` = 1,
  `verified_at` = NOW(), `verification_note` = '营业执照联网核验一致'
 WHERE `id` IN (5, 6, 10, 13, 15, 21);

-- ---------- 3) 产能状态填报（印查查核心"生产力展示"，72h 内视为有效） ----------
UPDATE `factory` SET `capacity_status` = 'idle',   `capacity_note` = '本周两条模切线空闲，可接加急单', `capacity_updated_at` = NOW() WHERE `id` IN (3, 9);
UPDATE `factory` SET `capacity_status` = 'normal', `capacity_note` = '产能正常，常规交期7天',           `capacity_updated_at` = NOW() WHERE `id` IN (1, 4, 21);
UPDATE `factory` SET `capacity_status` = 'busy',   `capacity_note` = '礼盒旺季排产已满，11月中旬后接单', `capacity_updated_at` = NOW() WHERE `id` IN (2, 17);

-- ---------- 4) 供应商关注 supplier_follow（演示用户 id=32 的历史合作沉淀） ----------
INSERT INTO `supplier_follow` (`user_id`, `factory_id`, `tags`, `note`, `pinned`) VALUES
  (32, 1, '纸箱,长期合作',   '去年双11做过5万个瓦楞箱，质量稳，交期准', 1),
  (32, 4, '药盒,礼品盒',     '药盒资质齐全，可做一物一码',              0),
  (32, 9, '彩盒,打样快',     '小批量打样24h出样，适合新品测款',         0)
ON DUPLICATE KEY UPDATE `tags` = VALUES(`tags`), `note` = VALUES(`note`), `pinned` = VALUES(`pinned`);

-- ---------- 5) 资讯订阅开关（默认原始数据应为开启推送） ----------
UPDATE `user_news_subscription` SET `enabled` = 1 WHERE `user_id` = 32 AND `category` IN ('market', 'tech');

-- ---------- 核对 ----------
SELECT 'industry_news' t, COUNT(*) cnt, SUM(featured) featured FROM industry_news
UNION ALL SELECT 'factory_v3', COUNT(*), NULL FROM factory WHERE verification_level = 3
UNION ALL SELECT 'factory_v2', COUNT(*), NULL FROM factory WHERE verification_level = 2
UNION ALL SELECT 'factory_v1', COUNT(*), NULL FROM factory WHERE verification_level = 1
UNION ALL SELECT 'capacity_filled', COUNT(*), NULL FROM factory WHERE capacity_status <> 'unknown'
UNION ALL SELECT 'supplier_follow', COUNT(*), NULL FROM supplier_follow
UNION ALL SELECT 'sub_enabled', COUNT(*), NULL FROM user_news_subscription WHERE enabled = 1;
