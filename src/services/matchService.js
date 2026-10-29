const { pool } = require('../config/db');
const { generateQuote } = require('../core/engine');
const { round, generateQuoteNo, nextBizNo, capacityOf } = require('../utils/helpers');
const capabilityService = require('./capabilityService');
const catalog = require('./catalogService');
const wxSubscribe = require('./wxService');
const guard = require('./contentGuard');

/**
 * 021 设计需求入参清洗：
 * designStatus 三态：none=客户自带设计稿（可收稿图）/ public=用工厂公版（只收文字备注）/ need=需要设计（描述+参考图）；
 * 参考图 URL 白名单校验（必须是本服务 /uploads/designs/ 下产出的图，防外链注入），最多 3 张
 */
function sanitizeDesign(input) {
  const status = ['need', 'public'].includes(input.designStatus) ? input.designStatus : 'none';
  // need/public 收文字备注（need 是设计描述，public 是要印的店名/文字）；自带稿 none 不收备注
  const note = (status === 'need' || status === 'public')
    ? (String(input.designNote || '').trim().slice(0, 500) || null)
    : null;
  // need 收参考图；none（自带稿）收的图即客户设计稿；public 用工厂版式无需图
  let images = null;
  if ((status === 'need' || status === 'none') && Array.isArray(input.designImages)) {
    const urls = input.designImages
      .map((u) => String(u || ''))
      .filter((u) => /^\/uploads\/designs\/[\w.-]+$/.test(u))
      .slice(0, 3);
    if (urls.length) images = urls;
  }
  // 024 排版工具产出的印刷 PDF（矢量制版文件），仅排版稿有（AI 稿/拍照无 PDF）
  let pdfs = null;
  if ((status === 'need' || status === 'none') && Array.isArray(input.designPdfs)) {
    const urls = input.designPdfs
      .map((u) => String(u || ''))
      .filter((u) => /^\/uploads\/designs\/[\w.-]+\.pdf$/i.test(u))
      .slice(0, 1);
    if (urls.length) pdfs = urls;
  }
  return { status, note, images, pdfs };
}

/**
 * 带 HTTP 状态码的业务错误（路由层按 err.status 返回：409=防重/冲突，410=过期）
 */
function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/**
 * 防自刷：取 C 端用户绑定的工厂ID（role='factory' 且 factory_id 有效时返回，否则返回 null）。
 * 同一微信号绑定工厂身份后仍可以发 C 端询价（工厂主真实自用采购是合理场景），
 * 但全链路禁止「自己发单 → 自己工厂报价/接单/成交」，避免虚假成交污染工厂统计与平台数据。
 */
async function getUserBoundFactoryId(userId) {
  if (!userId) return null;
  const [rows] = await pool.query(
    "SELECT factory_id FROM c_end_user WHERE id = ? AND role = 'factory' AND factory_id IS NOT NULL",
    [userId]
  );
  return rows.length ? Number(rows[0].factory_id) : null;
}

/**
 * 安全序列化 JSON 列参数
 * 背景：JSON.stringify(undefined) 返回 undefined，mysql2 会将其写成 NULL，
 * 导致 c_inquiry.system_quote 等 JSON 字段出现 NULL 脏数据。
 * 这里统一兜底：序列化结果为空或抛异常时，使用 fallback 并打印错误日志。
 */
function safeJsonStringify(value, fallback) {
  let str;
  try {
    str = JSON.stringify(value);
  } catch (e) {
    console.error('[matchService] JSON 序列化抛出异常:', e.message);
    str = undefined;
  }
  if (str === undefined) {
    const fb = JSON.stringify(fallback);
    console.error('[matchService] JSON 序列化为空，使用兜底值', fb, '，原始值:', value);
    return fb;
  }
  return str;
}

/**
 * 工厂首字头像（与小程序端 utils/avatar.js 完全同逻辑，保证两端显示一致）：
 * 剥掉行政区划前缀与行业后缀取真正首字（如「浙江鑫祥印业」→「鑫」）；
 * 颜色按名称 hash 从固定色板取，同一家工厂恒同色
 */
const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#0d9488', '#4f46e5'];

function avatarOf(name) {
  if (!name) return { text: '厂', color: '#94a3b8' };
  const str = String(name);
  const cleaned = str
    .replace(/^(浙江省|浙江|温州市|温州|龙港市|苍南县|平阳县|瑞安市|乐清市)/, '')
    .replace(/(有限责任公司|股份有限公司|有限公司|印业|包装|印刷|制品|公司|厂)$/g, '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return { text: (cleaned || str).charAt(0), color: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] };
}

/**
 * 创建一个询价单
 * @param {Object} input - 询价输入参数
 * @returns {Promise<Object>} 返回包含询价ID、询价号、系统报价和匹配工厂的Promise对象
 */
/**
 * 创建C端询价单
 * @param {Object} input - 询价输入参数
 * @returns {Promise<Object>} 返回包含询价ID、询价号、系统报价和匹配工厂信息的对象
 */
async function createCInquiry(input) {
  // ===== 防自刷：发单方若绑定了工厂身份，全链路排除/拦截自己名下的工厂 =====
  const selfFactoryId = await getUserBoundFactoryId(input.userId);

  // ===== F-102 工厂专属二维码（lockedFactoryId）：锁定模式预检 =====
  // 语义：客户扫工厂码进入，询价只推该厂、创建即 matched，不走撮合选厂；
  // 该厂能力标签不全也允许推送（工厂拉来的客户由老板自行确认），故后续不跑能力过滤。
  // 锁定模式创建即推送，工厂接单后需要联系客户，故必须已登录且已绑手机号。
  let lockedFactory = null;
  const lockedId = parseInt(input.lockedFactoryId, 10) || null;
  if (lockedId) {
    if (!input.userId) throw httpError('扫码向工厂询价需要先登录（我的 → 微信登录）', 403);
    const [[u]] = await pool.query('SELECT phone, nickname FROM c_end_user WHERE id = ?', [input.userId]);
    if (!u || !u.phone) throw httpError('请先绑定手机号再向工厂询价（我的 → 绑定手机号），工厂接单后需要联系你', 403);
    input.contactName = input.contactName || u.nickname || null;
    input.contactPhone = input.contactPhone || u.phone;
    const [lf] = await pool.query(
      'SELECT id, name, address, status, c_end_enabled FROM factory WHERE id = ?', [lockedId]
    );
    if (!lf.length || lf[0].status !== 1 || !lf[0].c_end_enabled) {
      throw httpError('该工厂暂未开通接单，无法直接向其询价', 400);
    }
    // 防自刷：不能扫自己工厂的码给自己发询价
    if (selfFactoryId && lockedId === selfFactoryId) {
      throw httpError('不能向自己名下的工厂询价', 400);
    }
    lockedFactory = lf[0];
  }

  // 生成系统报价（factoryId设为0表示系统基准）
  // 稳妥处理：生成失败时抛出明确错误（不产生"无价"询价单）；
  // 且保证 systemQuote 不会是 undefined —— 避免 JSON.stringify(undefined) 被写成 NULL
  let systemQuote;
  try {
    systemQuote = generateQuote({ ...input, factoryId: 0 });
  } catch (e) {
    console.error('[createCInquiry] 系统报价生成失败:', e.message, '| 入参:', JSON.stringify(input));
    throw new Error('报价计算失败：' + e.message);
  }
  if (!systemQuote || typeof systemQuote !== 'object') {
    console.error('[createCInquiry] 系统报价返回值异常（非对象）:', systemQuote);
    throw new Error('报价计算失败：系统未返回有效报价结果');
  }
  console.log('[createCInquiry] 系统报价生成成功: 总价 ' + systemQuote.totalPrice + ' 元 / 单价 ' + systemQuote.unitPrice + ' 元');
  // 查询所有状态为1且启用C端功能的工厂
  // const [factories] = await pool.query(
  //   'SELECT id, name, address FROM factory WHERE status = 1 AND c_end_enabled = 1'
  // );

  // 新代码：先按能力筛选（防自刷：排除发单方自己名下的工厂，使其无法刷到匹配列表）
  const capableIds = capabilityService.findFactories({
    productType: input.productType,
    printMode: input.printMode,
    materialCode: input.materialCode,
    processes: input.processes || [],
  }).filter((id) => Number(id) !== selfFactoryId);

  if (!capableIds.length && !lockedFactory) {
    return {
      inquiryId: null,
      inquiryNo: null,
      systemQuote,
      matches: [],
      message: '当前没有具备该生产能力的工厂',
    };
  }

  // F-01/05：撮合模式卡片不带价格——查工厂展示与统计字段
  const [factories] = await pool.query(
    `SELECT id, name, address, logo_url, rating, rating_count,
            total_pushes, total_accepts, avg_response_hours,
            license_verified, capacity_status, capacity_note, capacity_updated_at
     FROM factory WHERE status = 1 AND c_end_enabled = 1 AND id IN (?)`,
    [capableIds]
  );
  
  // 033 供应商关注：已关注工厂在撮合结果中优先置顶（取关 = 放弃优先权），结果页打「已关注」角标
  let followedSet = new Set();
  if (input.userId) {
    const [foll] = await pool.query(
      'SELECT factory_id FROM supplier_follow WHERE user_id = ?', [input.userId]
    );
    followedSet = new Set(foll.map((r) => Number(r.factory_id)));
  }

  // 存储匹配的工厂信息（去价：评分/接单率/响应时长/能力标签）
  const matches = [];
  const cfg = catalog.getProductConfig(input.productType);
  const productName = (cfg && cfg.productName) || input.productType;
  for (const f of factories) {
    const caps = capabilityService.getByFactory(f.id);
    const avatar = avatarOf(f.name);
    const cap = capacityOf(f);
    const facProc = new Set(caps.process || []);
    const reqProcesses = input.processes || [];
    // F-06：工艺命中数作为排序权重（工艺全匹配优先）
    const processMatchCount = reqProcesses.filter((p) => facProc.has(p)).length;
    const totalPushes = Number(f.total_pushes) || 0;
    const totalAccepts = Number(f.total_accepts) || 0;
    const acceptRate = totalPushes > 0 ? round((totalAccepts / totalPushes) * 100, 1) : 0;
    // 能力标签：品类名 + 命中的工艺名（最多 3 个）
    const capabilityTags = [productName];
    for (const p of reqProcesses) {
      if (capabilityTags.length >= 4) break;
      if (facProc.has(p)) capabilityTags.push((catalog.baseData.finishing[p] || {}).name || p);
    }
    matches.push({
      factoryId: f.id,
      factoryName: f.name,
      address: f.address,
      avatarText: avatar.text,
      avatarColor: avatar.color,
      logoUrl: f.logo_url || null,
      rating: Number(f.rating) || 5,
      ratingCount: Number(f.rating_count) || 0,
      totalPushes,
      totalAccepts,
      acceptRate,
      avgResponseHours: Number(f.avg_response_hours) || 0,
      processMatchCount,
      capabilityTags,
      // 印查查式信任/产能信号（C 端卡片徽章 + 排序加权）
      verified: !!f.license_verified,
      capacity: cap,
      followed: followedSet.has(Number(f.id)),
    });
  }
  // F-05：排序优先已关注工厂（033 供应商关系沉淀），再闲置产能（空闲>正常>饱和/未填报）、评分降序、接单率降序、工艺命中数降序（不按价格）
  matches.sort((a, b) =>
    ((b.followed ? 1 : 0) - (a.followed ? 1 : 0)) ||
    (b.capacity.weight - a.capacity.weight) ||
    b.rating - a.rating ||
    b.acceptRate - a.acceptRate ||
    b.processMatchCount - a.processMatchCount
  );
  // 生成询价号（CQ前缀，biz_seq 全局递增）
  const inquiryNo = await nextBizNo('CQ');

  // 将询价信息插入数据库（Stage7：盒型/拼版/软包装层数与薄膜编码入库存档）
  // F-09：参考价文案（随 system_quote 入库，结果页展示）
  systemQuote.notice = '参考价基于龙港市场均价';
  // P1-8：报价有效期 7 天（expires_at，前端据此显示「价格已失效」）
  // F-102：锁定模式的联系方式随单入库（无 select-factory 环节）
  // 021 设计需求随单入库（匿名同样可用；工厂端据此报价含设计费）
  const design = sanitizeDesign(input);
  // 内容安全：询价单里的自由文本仅联系人姓名与设计备注（其余均为结构化参数），
  // 匿名询价无 openid 时护栏自动降级放行；拦截发生在 INSERT 之前，不会留下脏单
  await guard.assertTextAllowed([
    { label: '联系人', value: input.contactName },
    { label: '设计要求', value: design.note },
  ], { openid: await guard.userOpenid(input.userId), scene: 'inquiry' });
  const [ret] = await pool.query(
    `INSERT INTO c_inquiry 
       (inquiry_no, user_id, product_type, print_mode, length_m, width_m, height_m,
        quantity, material_type, material_code, color_count,
        box_type, n_up, film_layers, film_codes,
        pattern_cover, ink_type, spot_colors,
        processes, system_quote, status, expires_at, contact_name, contact_phone,
        design_status, design_note, design_images, design_pdfs)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL 7 DAY),?,?,?,?,?,?)`,
    [
      inquiryNo,
      input.userId || null,
      input.productType || 'carton',
      input.printMode || 'offset',
      input.lengthM,
      input.widthM,
      input.heightM || 0,
      input.quantity,
      input.materialType,
      input.materialCode,
      input.colorCount || 4,
      input.boxType || null,
      input.nUp > 1 ? parseInt(input.nUp, 10) : 1,
      input.filmLayers > 1 ? parseInt(input.filmLayers, 10) : 1,
      Array.isArray(input.filmCodes) && input.filmCodes.length ? input.filmCodes.join(',') : null,
      // 016 印刷参数：图案覆盖率/油墨类型/专色数量（随单存档，工厂端报价可见）
      ['low', 'mid', 'high'].includes(input.patternCover) ? input.patternCover : 'mid',
      input.inkType || 'NORMAL',
      Math.max(0, parseInt(input.spotColors, 10) || 0),
      safeJsonStringify(input.processes, []),
      safeJsonStringify(systemQuote, { error: '报价数据缺失' }),
      'quoted',
      input.contactName || null,
      input.contactPhone || null,
      design.status,
      design.note,
      design.images ? safeJsonStringify(design.images, []) : null,
      design.pdfs ? safeJsonStringify(design.pdfs, []) : null,
    ]
  );
  const inquiryId = ret.insertId;

  // Stage11 找厂页「按此厂报价」：询价单创建即推送指定工厂（用户显式选择），
  // 状态直接流转 matched；报价页直接发起的询价无此参数，维持原逻辑（结果页用户自选推送）
  // F-102：锁定模式（lockedFactoryId）与此同通道，但跳过能力校验
  let preferredId = lockedId || parseInt(input.preferFactoryId, 10) || null;
  let preferredRejected = false;
  // 防自刷：显式指定自己名下工厂时回落普通匹配（此时询价单已创建，报错会留下脏单）
  if (preferredId && !lockedFactory && selfFactoryId && preferredId === selfFactoryId) {
    preferredId = null;
    preferredRejected = true;
  }
  if (preferredId) {
    const [pf] = await pool.query(
      'SELECT id, name, status, c_end_enabled FROM factory WHERE id = ?', [preferredId]
    );
    if (!pf.length || pf[0].status !== 1 || !pf[0].c_end_enabled) {
      preferredId = null; // 工厂停用/未开C端则忽略指定，回落普通匹配
    } else if (!lockedFactory && !capabilityService.canHandle(preferredId, {
      productType: input.productType,
      printMode: input.printMode,
      materialCode: input.materialCode,
      processes: input.processes || [],
    })) {
      // Stage12：指定工厂不具备该需求的生产能力时不推送，回落普通匹配；
      // preferredRejected 标记供结果页提示用户改选其他工厂
      preferredId = null;
      preferredRejected = true;
    } else {
      let fQuote;
      try { fQuote = generateQuote({ ...input, factoryId: preferredId }); }
      catch (e) { fQuote = systemQuote; } // 该厂无法计价时用系统基准价推送，工厂端可见并可拒单
      await pool.query(
        `INSERT INTO factory_inquiry_push (inquiry_id, factory_id, factory_quote, response)
         VALUES (?, ?, ?, 'pending')
         ON DUPLICATE KEY UPDATE factory_quote = VALUES(factory_quote)`,
        // 回退链修复：generateQuote 抛错降级到 system_quote 时其结构只有 finalPrice 无 totalPrice,
        // 旧代码取 totalPrice 得 undefined 被 mysql2 写成 NULL（工厂端 ¥null 的根因）
        [inquiryId, preferredId, quotePriceOf(fQuote)]
      );
      // F-72：推送计数
      await pool.query('UPDATE factory SET total_pushes = total_pushes + 1 WHERE id = ?', [preferredId]);
      await pool.query(
        "UPDATE c_inquiry SET status = 'matched', matched_factory_id = ? WHERE id = ? AND status IN ('quoted', 'matched')",
        [preferredId, inquiryId]
      );
    }
  }

  // 返回询价结果，指定工厂置顶并打标（result 页据此显示「已推送」徽章）
  if (preferredId) {
    const idx = matches.findIndex((m) => m.factoryId === preferredId);
    if (idx > 0) {
      const [pin] = matches.splice(idx, 1);
      matches.unshift(pin);
    }
    if (idx !== -1) matches[0].isPreferred = true;
  }

  // F-102：锁定模式结果页只展示该厂（不可改选其他工厂）；该厂不在能力集时构造最小卡片
  if (lockedFactory && preferredId) {
    const idx = matches.findIndex((m) => m.factoryId === preferredId);
    if (idx >= 0) {
      const [pin] = matches.splice(idx, 1);
      matches.length = 0;
      matches.push(pin);
    } else {
      matches.length = 0;
      const lockAvatar = avatarOf(lockedFactory.name);
      matches.push({
        factoryId: preferredId,
        factoryName: lockedFactory.name,
        address: lockedFactory.address,
        avatarText: lockAvatar.text,
        avatarColor: lockAvatar.color,
        logoUrl: null,
        rating: 5, ratingCount: 0, totalPushes: 0, totalAccepts: 0,
        acceptRate: 0, avgResponseHours: 0, processMatchCount: 0,
        capabilityTags: [productName],
        verified: false,
        capacity: { status: 'unknown', label: '', note: null, fresh: false, weight: 0 },
        followed: followedSet.has(Number(preferredId)),
      });
    }
    matches[0].isPreferred = true;
    matches[0].isLocked = true;
  }

  return {
    inquiryId,
    inquiryNo,
    systemQuote,
    preferredFactoryId: preferredId,
    lockedFactoryId: lockedFactory ? preferredId : null,
    preferredRejected,
    matches: matches.slice(0, 5),
  };
}

/**
 * 解析 c_inquiry.system_quote（兼容 JSON 列返回对象/字符串两种形态）
 */
function parseSystemQuote(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/**
 * 报价对象实际总价统一取价：generateQuote 返回 totalPrice,
 * 而存量 c_inquiry.system_quote 精简结构只有 finalPrice——两处结构统一回退链
 */
function quotePriceOf(q) {
  if (!q) return null;
  if (q.totalPrice != null) return Number(q.totalPrice);
  if (q.finalPrice != null) return Number(q.finalPrice);
  return null;
}

/**
 * F-14：工厂实时价与系统参考价偏差 >30% 时告警（server log + c_message 给管理员）
 * c_message.user_id=0 为平台告警占位（无真实用户 id 为 0），P1 管理端告警中心读取
 */
function alertPriceDeviation(inquiry, factoryQuote) {
  const sq = parseSystemQuote(inquiry.system_quote);
  const systemTotal = quotePriceOf(sq) || 0;
  const fTotal = quotePriceOf(factoryQuote);
  if (systemTotal <= 0 || fTotal == null) return;
  const dev = Math.abs(fTotal - systemTotal) / systemTotal;
  if (dev <= 0.3) return;
  const msg = `询价 ${inquiry.inquiry_no} 工厂实时价 ${fTotal} 元与系统参考价 ${systemTotal} 元偏差 ${(dev * 100).toFixed(1)}%（>30%）`;
  console.error('[price_alert] ' + msg);
  pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
     VALUES (0, 'price_alert', '工厂报价偏差告警', ?, 'inquiry', ?)`,
    [msg.slice(0, 500), inquiry.id]
  ).catch((e) => console.error('[price_alert] 写库失败:', e.message));
}

async function selectFactory({ inquiryId, factoryId, contactName, contactPhone }) {
  const [inquiries] = await pool.query(
    'SELECT * FROM c_inquiry WHERE id = ?',
    [inquiryId]
  );
  if (!inquiries.length) throw new Error('询价不存在');
  const inquiry = inquiries[0];

  // ===== 状态机保护（F-13）：已接单/已转化/已推送 一律 409 =====
  if (['accepted', 'converted'].includes(inquiry.status)) {
    throw httpError('该询价已被工厂接单，不能再推送其他工厂', 409);
  }
  if (inquiry.quoted_factory_id) {
    throw httpError('该询价已推送给工厂，请勿重复推送', 409);
  }
  const [accepted] = await pool.query(
    "SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND response = 'accept' LIMIT 1",
    [inquiryId]
  );
  if (accepted.length) throw httpError('该询价已被工厂接单，不能再推送其他工厂', 409);

  // 防自刷：不能选择自己名下的工厂报价（发单方=该工厂绑定人时拒绝）
  const selfFactoryId = await getUserBoundFactoryId(inquiry.user_id);
  if (selfFactoryId && Number(factoryId) === selfFactoryId) {
    throw httpError('不能选择自己名下的工厂报价', 400);
  }

  let processes = [];
  try {
    processes = JSON.parse(inquiry.processes);
  } catch (e) {
    processes = [];
  }

  const params = {
    factoryId,
    productType: inquiry.product_type,
    printMode: inquiry.print_mode,
    lengthM: inquiry.length_m,
    widthM: inquiry.width_m,
    heightM: inquiry.height_m,
    quantity: inquiry.quantity,
    materialType: inquiry.material_type,
    materialCode: inquiry.material_code,
    colorCount: inquiry.color_count,
    processes,
    // Stage7 参数：再次询价/推送时还原盒型/拼版/软包装配置
    boxType: inquiry.box_type || 'normal',
    nUp: inquiry.n_up || 1,
    filmLayers: inquiry.film_layers || 1,
    filmCodes: inquiry.film_codes ? String(inquiry.film_codes).split(',').filter(Boolean) : undefined,
  };
  const factoryQuote = generateQuote(params);

  // 保存用户联系方式（接单后与工厂对接用，COALESCE 不覆盖已有值）
  if (contactName || contactPhone) {
    await pool.query(
      'UPDATE c_inquiry SET contact_name = COALESCE(?, contact_name), contact_phone = COALESCE(?, contact_phone) WHERE id = ?',
      [contactName || null, contactPhone || null, inquiryId]
    );
  }

  // 推送记录：重复推送只更新报价，不覆盖已有响应状态（避免改写 accept）
  await pool.query(
    `INSERT INTO factory_inquiry_push (inquiry_id, factory_id, factory_quote, response)
     VALUES (?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE factory_quote = VALUES(factory_quote)`,
    [inquiryId, factoryId, quotePriceOf(factoryQuote)]
  );
  // F-72：推送计数
  await pool.query('UPDATE factory SET total_pushes = total_pushes + 1 WHERE id = ?', [factoryId]);
  // F-14：实时厂价与系统参考价偏差 >30% 告警
  alertPriceDeviation(inquiry, factoryQuote);

  // F-13：条件更新——只允许 quoted/matched 且未推送过的询价流转，避免并发覆盖已接单状态
  await pool.query(
    `UPDATE c_inquiry
     SET status = 'matched', matched_factory_id = ?,
         quoted_factory_id = ?, quoted_price = ?, quoted_at = NOW()
     WHERE id = ? AND status IN ('quoted', 'matched') AND quoted_factory_id IS NULL`,
    [factoryId, factoryId, quotePriceOf(factoryQuote), inquiryId]
  );
  // 选定行为记入查看表（selected=1，管理端统计「选定次数」）
  await pool.query(
    'UPDATE c_inquiry_quote_view SET selected = 1 WHERE inquiry_id = ? AND factory_id = ?',
    [inquiryId, factoryId]
  );

  return {
    inquiryNo: inquiry.inquiry_no,
    factoryQuote,
    message: '已推送给工厂，等待确认',
  };
}

/**
 * 工厂端询价列表（服务端分页 + 单号/联系人搜索）
 * @returns {Promise<{total:number, list:Array}>}
 */
async function listFactoryInquiries(factoryId, { status, keyword, page = 1, pageSize = 20 } = {}) {
  // 本厂还没处理（response=pending）但询价已离开在途态（quoted/matched）的推送：已无报价/接单动作可做，
  // 从列表与徽标计数中排除（否则工厂点开报价弹窗提交必被状态门槛拒绝）。
  // 旧规则只认 accepted/converted, 而 017 流程成交后写的是 user_confirmed, 且中标厂的 response 仍是 pending
  // ——所以必须同时保留「成交方就是本厂」的记录, 不能只按 response 过滤。
  // 防自刷：发单方绑定的工厂就是本厂时不出现在本厂列表（报价/接单接口本就拦截，这里提前隐藏）
  let where = `
    WHERE fp.factory_id = ?
      AND NOT (
        fp.response = 'pending'
        AND ci.status NOT IN ('quoted', 'matched')
        AND (ci.matched_factory_id IS NULL OR ci.matched_factory_id != fp.factory_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM c_end_user eu
        WHERE eu.id = ci.user_id AND eu.factory_id = fp.factory_id
      )
  `;
  const params = [factoryId];
  if (status) {
    where += ' AND fp.response = ?';
    params.push(status);
  }
  if (keyword) {
    where += ' AND (ci.inquiry_no LIKE ? OR ci.contact_name LIKE ?)';
    params.push('%' + keyword + '%', '%' + keyword + '%');
  }

  const [[cnt]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM factory_inquiry_push fp
     JOIN c_inquiry ci ON fp.inquiry_id = ci.id
     ${where}`, params
  );

  const [rows] = await pool.query(
    `SELECT fp.id AS push_id, fp.factory_quote, fp.response, fp.push_time,
           ci.id AS inquiry_id, ci.inquiry_no, ci.product_type, ci.quantity, ci.system_quote,
           ci.print_mode, ci.length_m, ci.width_m, ci.height_m, ci.material_code,
           ci.color_count, ci.spot_colors, ci.processes,
           ci.status AS inquiry_status, ci.matched_factory_id,
           ci.contact_name, ci.contact_phone,
           ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs,
           ci.created_at AS inquiry_time
     FROM factory_inquiry_push fp
     JOIN c_inquiry ci ON fp.inquiry_id = ci.id
     ${where}
     ORDER BY fp.push_time DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  // 客户联系方式仅对已接单的询价可见；021 设计参考图原样下发（工厂报价/接单要参照）
  const list = rows.map((r) => {
    // 历史脏数据兼容：早期推送写入取错字段导致 factory_quote 为 NULL（前端 ¥null）,
    // 展示与报价弹窗参考价回退到 system_quote 的 totalPrice/finalPrice
    if (r.factory_quote == null) {
      const sq = parseSystemQuote(r.system_quote);
      const fb = sq && (sq.totalPrice != null ? sq.totalPrice : sq.finalPrice);
      if (fb != null) r.factory_quote = Number(fb);
    }
    if (r.response !== 'accept') {
      delete r.contact_name;
      delete r.contact_phone;
    }
    if (typeof r.design_images === 'string') {
      try { r.design_images = JSON.parse(r.design_images); } catch (e) { r.design_images = []; }
    }
    if (!r.design_images) r.design_images = [];
    if (typeof r.design_pdfs === 'string') {
      try { r.design_pdfs = JSON.parse(r.design_pdfs); } catch (e) { r.design_pdfs = []; }
    }
    if (!r.design_pdfs) r.design_pdfs = [];
    // 生产参数人读文案（尺寸/印刷方式/材质/色数/后道工艺）, 工厂据此报价
    Object.assign(r, catalog.describeSpec(r));
    return r;
  });
  return { total: Number(cnt.total), list };
}

/**
 * F-12：工厂婉拒后重新匹配。
 * 触发条件：该询价处于待接单（quoted/matched）且全部推送均已处理（无 pending/accept）。
 * 动作：排除历史推送过的工厂，按能力重新匹配最多 3 家推送；询价状态复位 quoted 并清选定标记，
 *      让用户可重新选厂/让新厂可接单；站内信告知用户。
 */
async function rematchAfterDecline(conn, inquiryId) {
  const [iqs] = await conn.query(
    "SELECT * FROM c_inquiry WHERE id = ? AND status IN ('quoted', 'matched') FOR UPDATE",
    [inquiryId]
  );
  if (!iqs.length) return;
  const inquiry = iqs[0];
  const [open] = await conn.query(
    "SELECT COUNT(*) c FROM factory_inquiry_push WHERE inquiry_id = ? AND response IN ('pending', 'accept')",
    [inquiryId]
  );
  if (open[0].c > 0) return; // 还有在途推送或已接单，不干预

  const processes = safeParseArr(inquiry.processes);
  const input = {
    productType: inquiry.product_type, printMode: inquiry.print_mode,
    lengthM: inquiry.length_m, widthM: inquiry.width_m, heightM: inquiry.height_m,
    quantity: inquiry.quantity, materialType: inquiry.material_type,
    materialCode: inquiry.material_code, colorCount: inquiry.color_count,
    processes, boxType: inquiry.box_type, nUp: inquiry.n_up,
    filmLayers: inquiry.film_layers,
    filmCodes: inquiry.film_codes ? String(inquiry.film_codes).split(',').filter(Boolean) : [],
  };
  const sq = parseSystemQuote(inquiry.system_quote);

  // 无可匹配工厂或候选都被推过：仅通知用户，状态保持（可改需求重新询价）
  const notifyUser = async (content) => {
    if (!inquiry.user_id) return;
    await conn.query(
      `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
       VALUES (?, 'quote_rematch', ?, ?, 'inquiry', ?)`,
      [inquiry.user_id, '询价匹配进展', content, inquiryId]
    );
  };

  const capableIds = capabilityService.findFactories({
    productType: input.productType, printMode: input.printMode,
    materialCode: input.materialCode, processes,
  });
  if (!capableIds.length) {
    return notifyUser(`询价 ${inquiry.inquiry_no} 推送的工厂暂时无法接单，且当前没有其他具备对应能力的工厂，可调整需求后重新询价。`);
  }
  const [pushed] = await conn.query(
    'SELECT factory_id FROM factory_inquiry_push WHERE inquiry_id = ?', [inquiryId]);
  const pushedSet = new Set(pushed.map((r) => r.factory_id));
  // 033：重新匹配时用户已关注工厂优先入推（稳定排序，其余维持原能力集顺序）
  let followedSet = new Set();
  if (inquiry.user_id) {
    const [foll] = await conn.query(
      'SELECT factory_id FROM supplier_follow WHERE user_id = ?', [inquiry.user_id]
    );
    followedSet = new Set(foll.map((r) => Number(r.factory_id)));
  }
  const candidates = capableIds
    .filter((id) => !pushedSet.has(id))
    .sort((a, b) => (followedSet.has(Number(b)) ? 1 : 0) - (followedSet.has(Number(a)) ? 1 : 0))
    .slice(0, 3);
  if (!candidates.length) {
    return notifyUser(`询价 ${inquiry.inquiry_no} 推送的工厂暂时无法接单，当前也没有新的工厂可推荐，可调整需求后重新询价。`);
  }

  for (const fid of candidates) {
    let fQuote;
    try { fQuote = generateQuote({ ...input, factoryId: fid }); }
    catch (e) { fQuote = sq; } // 无法计价时用系统参考价推送，工厂端可见并可拒单
    await conn.query(
      `INSERT INTO factory_inquiry_push (inquiry_id, factory_id, factory_quote, response)
       VALUES (?, ?, ?, 'pending')`,
      [inquiryId, fid, quotePriceOf(fQuote) || quotePriceOf(sq) || 0]
    );
    await conn.query('UPDATE factory SET total_pushes = total_pushes + 1 WHERE id = ?', [fid]);
  }
  // 状态复位：清选定标记，新推送可接单、用户可重新选择
  await conn.query(
    "UPDATE c_inquiry SET status = 'quoted', matched_factory_id = NULL, quoted_factory_id = NULL WHERE id = ?",
    [inquiryId]
  );
  await notifyUser(`询价 ${inquiry.inquiry_no} 此前推送的工厂暂时无法接单，已为你重新推送 ${candidates.length} 家工厂，请到「我的-询价」查看进展。`);
}

/** JSON 数组列安全解析 */
function safeParseArr(raw) {
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

async function respondInquiry({ pushId, response, factoryId }) {
  const conn = await pool.getConnection();
  let createdOrderNo = null;
  try {
    await conn.beginTransaction();

    // FOR UPDATE 锁定推送记录与询价行，防止多工厂并发接单
    const [pushes] = await conn.query(
      `SELECT fp.id, fp.inquiry_id, fp.factory_id, fp.response, fp.push_time,
              ci.status AS inquiry_status, ci.user_id, ci.inquiry_no
       FROM factory_inquiry_push fp
       JOIN c_inquiry ci ON fp.inquiry_id = ci.id
       WHERE fp.id = ? FOR UPDATE`,
      [pushId]
    );
    if (!pushes.length) throw new Error('推送记录不存在');
    const push = pushes[0];

    // 只能响应自己工厂的推送
    if (factoryId !== undefined && push.factory_id !== factoryId) {
      throw new Error('无权操作其他工厂的询价');
    }
    // 幂等：已处理过的推送不能重复响应
    if (push.response !== 'pending') {
      throw new Error('该询价已处理过了');
    }

    // 防自刷：不能接单自己名下账号发布的询价（旧接单路径同样拦截）
    const [selfRows] = await conn.query(
      `SELECT u.id FROM c_inquiry ci JOIN c_end_user u ON u.id = ci.user_id
       WHERE ci.id = ? AND u.factory_id = ? LIMIT 1`,
      [push.inquiry_id, push.factory_id]
    );
    if (selfRows.length) throw new Error('不能接单自己名下账号发布的询价');

    if (response === 'accept') {
      // 首单锁定：已被其他工厂接单，或已进入工厂报价/用户确认流程（等用户确认，不可绕开接单）
      if (['accepted', 'converted', 'factory_quoted', 'user_confirmed'].includes(push.inquiry_status)) {
        throw new Error('该询价已被其他工厂接单或已进入报价确认流程');
      }
      await conn.query(
        'UPDATE factory_inquiry_push SET response = ?, respond_time = NOW() WHERE id = ?',
        [response, pushId]
      );
      await conn.query(
        "UPDATE c_inquiry SET status = 'accepted', matched_factory_id = ?, accepted_at = NOW() WHERE id = ?",
        [push.factory_id, push.inquiry_id]
      );

      // 生成订单（uk_inquiry 唯一键兜底防重复；重复接单已在前面被拦截）
      const [ciRows] = await conn.query(
        `SELECT product_type, print_mode, length_m, width_m, height_m, quantity,
                material_type, material_code, color_count, processes, contact_name, contact_phone
         FROM c_inquiry WHERE id = ?`,
        [push.inquiry_id]
      );
      const inq = ciRows[0] || {};
      const [fpRows] = await conn.query(
        'SELECT factory_quote FROM factory_inquiry_push WHERE id = ?',
        [pushId]
      );
      const totalPrice = Number((fpRows[0] || {}).factory_quote) || 0;
      const unitPrice = inq.quantity ? round(totalPrice / inq.quantity, 4) : 0;
      const orderNo = await nextBizNo('OD');
      await conn.query(
        `INSERT INTO order_main
           (order_no, inquiry_id, user_id, factory_id, product_type, print_mode,
            length_m, width_m, height_m, quantity, material_type, material_code, color_count,
            processes, unit_price, total_price, status, pay_status, contact_name, contact_phone)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','unpaid',?,?)`,
        [
          orderNo, push.inquiry_id, push.user_id || null, push.factory_id,
          inq.product_type, inq.print_mode, inq.length_m, inq.width_m, inq.height_m, inq.quantity,
          inq.material_type, inq.material_code, inq.color_count || 4,
          typeof inq.processes === 'string' ? inq.processes : safeJsonStringify(inq.processes, []),
          unitPrice, totalPrice,
          inq.contact_name || null, inq.contact_phone || null,
        ]
      );
      createdOrderNo = orderNo;

      // F-73/74：接单计数 + 平均响应时长滑动平均（小时）
      const hours = Math.max(0, round((Date.now() - new Date(push.push_time).getTime()) / 3600000, 2));
      const [fRows] = await conn.query(
        'SELECT total_accepts, avg_response_hours FROM factory WHERE id = ? FOR UPDATE',
        [push.factory_id]
      );
      const facStat = fRows[0] || { total_accepts: 0, avg_response_hours: null };
      const n = Number(facStat.total_accepts) || 0;
      const newAvg = n === 0 ? hours : round(((Number(facStat.avg_response_hours) || 0) * n + hours) / (n + 1), 2);
      await conn.query(
        'UPDATE factory SET total_accepts = total_accepts + 1, avg_response_hours = ? WHERE id = ?',
        [newAvg, push.factory_id]
      );

      // 站内消息：通知已登录用户“已接单”（匿名询价无接收人，跳过）
      if (push.user_id) {
        const [fs] = await conn.query(
          'SELECT name, contact, phone FROM factory WHERE id = ?',
          [push.factory_id]
        );
        const fac = fs[0] || {};
        await conn.query(
          `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
           VALUES (?, 'quote_accepted', ?, ?, 'inquiry', ?)`,
          [
            push.user_id,
            '您的询价已被工厂接单',
            `询价 ${push.inquiry_no} 已被「${fac.name || '工厂'}」接单，联系人：${fac.contact || '-'}，电话：${fac.phone || '-'}，请尽快与工厂确认生产细节。`,
            push.inquiry_id,
          ]
        );
      }
    } else {
      await conn.query(
        'UPDATE factory_inquiry_push SET response = ?, respond_time = NOW() WHERE id = ?',
        [response, pushId]
      );
      // F-12：工厂婉拒后，若该询价全部推送处理完毕且无人接单，重新匹配推送 + 站内信引导用户
      if (response === 'decline') {
        await rematchAfterDecline(conn, push.inquiry_id);
      }
    }

    await conn.commit();

    // 订阅消息：接单通知（事务外发送；未配置微信/模板时静默跳过，失败不影响主流程）
    if (response === 'accept' && push.user_id) {
      try {
        await wxSubscribe.notifyUser(push.user_id, process.env.WX_TMPL_ORDER_ACCEPTED, {
          page: 'pages/mine/mine',
          data: {
            // ⚠️ 字段名需与微信后台申请的模板一致，按实际模板字段调整
            thing1: { value: String(push.inquiry_no || '').slice(0, 20) },
            thing2: { value: '您的询价已被工厂接单' },
          },
        });
      } catch (e) {
        console.warn('[matchService] 接单订阅通知失败:', e.message);
      }
    }

    return {
      pushId,
      response,
      inquiryId: push.inquiry_id,
      inquiryStatus: response === 'accept' ? 'accepted' : push.inquiry_status,
      orderNo: createdOrderNo,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * F-02/03/04：查看指定工厂的实时报价（看价接口）
 * - 校验询价存在且未过期（410）
 * - 校验工厂在匹配范围（启用状态 + 能力全匹配）
 * - 实时引擎算价（价格新鲜）+ 写 c_inquiry_quote_view 看价记录
 * - 返回工厂报价 + 系统参考价 + 联系方式
 */
async function getFactoryQuote({ inquiryId, factoryId, userId }) {
  const [rows] = await pool.query('SELECT * FROM c_inquiry WHERE id = ?', [inquiryId]);
  if (!rows.length) throw httpError('询价不存在', 404);
  const inquiry = rows[0];

  if (inquiry.expires_at && new Date(inquiry.expires_at) < new Date()) {
    throw httpError('报价已过期，请重新询价', 410);
  }

  const [fRows] = await pool.query(
    'SELECT id, name, phone, address FROM factory WHERE id = ? AND status = 1 AND c_end_enabled = 1',
    [factoryId]
  );
  if (!fRows.length) throw httpError('工厂不存在或已停用', 404);
  const factory = fRows[0];

  let processes = [];
  try { processes = JSON.parse(inquiry.processes); } catch (e) { processes = []; }
  if (!capabilityService.canHandle(factoryId, {
    productType: inquiry.product_type,
    printMode: inquiry.print_mode,
    materialCode: inquiry.material_code,
    processes,
  })) {
    throw httpError('该工厂不具备此单的生产能力', 400);
  }

  // 归属校验：已归属询价仅本人可看；匿名询价首次查看绑定归属（与 select-factory 同规则）
  if (inquiry.user_id) {
    if (!userId || inquiry.user_id !== userId) throw httpError('无权查看该询价', 403);
  } else if (userId) {
    await pool.query('UPDATE c_inquiry SET user_id = ? WHERE id = ? AND user_id IS NULL', [userId, inquiryId]);
  }

  const factoryQuote = generateQuote({
    factoryId,
    productType: inquiry.product_type,
    printMode: inquiry.print_mode,
    lengthM: inquiry.length_m,
    widthM: inquiry.width_m,
    heightM: inquiry.height_m,
    quantity: inquiry.quantity,
    materialType: inquiry.material_type,
    materialCode: inquiry.material_code,
    colorCount: inquiry.color_count,
    processes,
    boxType: inquiry.box_type || 'normal',
    nUp: inquiry.n_up || 1,
    filmLayers: inquiry.film_layers || 1,
    filmCodes: inquiry.film_codes ? String(inquiry.film_codes).split(',').filter(Boolean) : undefined,
  });

  // F-03：看价记录（user_id 可空=匿名查看）
  await pool.query(
    'INSERT INTO c_inquiry_quote_view (inquiry_id, factory_id, user_id) VALUES (?,?,?)',
    [inquiryId, factoryId, userId || null]
  );

  alertPriceDeviation(inquiry, factoryQuote);

  let systemTotal = null;
  const sq = parseSystemQuote(inquiry.system_quote);
  if (sq) systemTotal = Number(sq.totalPrice) || null;

  const remainMs = inquiry.expires_at ? new Date(inquiry.expires_at).getTime() - Date.now() : 0;
  return {
    factoryQuote: {
      unitPrice: factoryQuote.unitPrice,
      totalPrice: factoryQuote.totalPrice,
      taxAmount: factoryQuote.taxAmount,
      finalPrice: factoryQuote.finalPrice,
      breakdown: factoryQuote.breakdown,
      expiresAt: inquiry.expires_at,
      remainDays: Math.max(0, Math.ceil(remainMs / 86400000)),
    },
    systemQuote: { totalPrice: systemTotal, notice: '参考价基于龙港市场均价' },
    contact: { phone: factory.phone, address: factory.address },
  };
}

/**
 * F-70：订单评分（1-5 星）——更新工厂评分（滑动平均），一次订单仅可评一次
 */
async function rateOrder({ orderId, userId, rating }) {
  const r = parseInt(rating, 10);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw httpError('评分需为 1-5 星', 400);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [oRows] = await conn.query(
      'SELECT id, factory_id, status, rated_at FROM order_main WHERE id = ? AND user_id = ? FOR UPDATE',
      [orderId, userId]
    );
    if (!oRows.length) throw httpError('订单不存在', 404);
    const order = oRows[0];
    if (order.status !== 'completed') throw httpError('订单完成后才能评价', 400);
    if (order.rated_at) throw httpError('该订单已评价过', 409);

    await conn.query('UPDATE order_main SET rating = ?, rated_at = NOW() WHERE id = ?', [r, orderId]);
    const [fRows] = await conn.query(
      'SELECT rating, rating_count FROM factory WHERE id = ? FOR UPDATE',
      [order.factory_id]
    );
    const fac = fRows[0] || { rating: 5, rating_count: 0 };
    const n = Number(fac.rating_count) || 0;
    const newRating = n === 0 ? r : round(((Number(fac.rating) || 0) * n + r) / (n + 1), 2);
    await conn.query(
      'UPDATE factory SET rating = ?, rating_count = rating_count + 1 WHERE id = ?',
      [newRating, order.factory_id]
    );
    await conn.commit();
    return { rating: newRating, ratingCount: n + 1 };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * C端查询询价状态（工厂联系方式仅接单后可见；不返回用户自己的手机号）
 */
async function getInquiryStatus(inquiryId) {
  const [rows] = await pool.query(
    `SELECT ci.id, ci.inquiry_no, ci.status, ci.matched_factory_id, ci.accepted_at, ci.created_at,
            ci.expires_at,
            ci.factory_quoted_price, ci.factory_quoted_at, ci.factory_quote_expires_at,
            ci.factory_quote_remark, ci.user_confirmed_at,
            ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs, ci.design_fee,
            f.name AS factory_name, f.contact AS factory_contact,
            f.phone AS factory_phone, f.address AS factory_address
     FROM c_inquiry ci
     LEFT JOIN factory f ON ci.matched_factory_id = f.id
     WHERE ci.id = ?`,
    [inquiryId]
  );
  if (!rows.length) throw new Error('询价不存在');
  const r = rows[0];

  const [pushes] = await pool.query(
    'SELECT factory_id, response FROM factory_inquiry_push WHERE inquiry_id = ?',
    [inquiryId]
  );

  // user_confirmed 视同已成交：用户已确认工厂报价并生成订单，工厂联系方式同样可见
  const accepted = ['accepted', 'converted', 'user_confirmed'].includes(r.status);
  return {
    id: r.id,
    inquiryNo: r.inquiry_no,
    status: r.status,
    acceptedAt: r.accepted_at,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    // 报价有效期：过期后价格仅供参考，重新报价生成新单（P1-8）
    expired: !!(r.expires_at && new Date(r.expires_at) < new Date()),
    // 017 工厂正式报价（新流程在途/成交数据，用户端轮询展示）
    factoryQuotedPrice: r.factory_quoted_price != null ? Number(r.factory_quoted_price) : null,
    factoryQuotedAt: r.factory_quoted_at,
    factoryQuoteExpiresAt: r.factory_quote_expires_at,
    factoryQuoteRemark: r.factory_quote_remark,
    factoryQuoteExpired: !!(r.factory_quote_expires_at && new Date(r.factory_quote_expires_at) < new Date()),
    userConfirmedAt: r.user_confirmed_at,
    // 021 设计需求（结果页展示自己提的需求；工厂报价里的设计费一并返回）
    designStatus: r.design_status || 'none',
    designNote: r.design_note || '',
    designImages: safeParseArr(r.design_images),
    designPdfs: safeParseArr(r.design_pdfs),
    designFee: r.design_fee != null ? Number(r.design_fee) : null,
    factory: (accepted && r.matched_factory_id)
      ? {
          name: r.factory_name,
          contact: r.factory_contact,
          phone: r.factory_phone,
          address: r.factory_address,
        }
      : null,
    pushes,
  };
}

/**
 * 017 新流程：工厂正式报价（matched → factory_quoted）
 * 订单金额以工厂正式报价为准，与系统参考价解耦；旧路径（respond accept）保留
 * body: { price, remark?, validDays? } — price 为工厂正式报价金额（元）
 */
async function factoryQuoteInquiry({ pushId, price, remark, validDays = 7, factoryId, designFee }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pushes] = await conn.query(
      `SELECT fp.id, fp.inquiry_id, fp.factory_id, fp.response,
              ci.status AS inquiry_status, ci.user_id, ci.inquiry_no, ci.expires_at,
              ci.design_status
       FROM factory_inquiry_push fp
       JOIN c_inquiry ci ON fp.inquiry_id = ci.id
       WHERE fp.id = ? FOR UPDATE`,
      [pushId]
    );
    if (!pushes.length) throw new Error('推送记录不存在');
    const push = pushes[0];

    if (factoryId !== undefined && push.factory_id !== factoryId) {
      throw new Error('无权操作其他工厂的询价');
    }
    if (push.response !== 'pending') throw new Error('该询价已处理过了');
    if (push.inquiry_status !== 'matched') {
      // 按实际状态给人话：笼统的「当前状态不允许报价」工厂看不懂, 只会反复点提交
      const st = push.inquiry_status;
      throw new Error(
        st === 'quoted' ? '客户尚未选定接单工厂，暂不能报价'
          : st === 'factory_quoted' ? '该询价已有工厂报价，正等客户确认'
          : ['user_confirmed', 'accepted', 'converted'].includes(st) ? '该询价已成交并生成订单，无需再报价'
          : st === 'cancelled' ? '该询价已取消'
          : st === 'expired' ? '该询价已过期'
          : '该询价当前状态不允许报价'
      );
    }

    // 防自刷：不能报价自己名下账号发布的询价
    const [selfRows] = await conn.query(
      `SELECT u.id FROM c_inquiry ci JOIN c_end_user u ON u.id = ci.user_id
       WHERE ci.id = ? AND u.factory_id = ? LIMIT 1`,
      [push.inquiry_id, push.factory_id]
    );
    if (selfRows.length) throw new Error('不能报价自己名下账号发布的询价');

    const quotedPrice = Number(price);
    if (!Number.isFinite(quotedPrice) || quotedPrice <= 0 || quotedPrice > 99999999) {
      throw new Error('报价金额必须大于 0');
    }
    // 021 设计费：仅当询价声明「需要设计」时可填，单列展示便于客户知情；计入正式报价总价
    let fee = null;
    if (push.design_status === 'need' && designFee !== undefined && designFee !== null && designFee !== '') {
      fee = Number(designFee);
      if (!Number.isFinite(fee) || fee < 0 || fee > 999999) {
        throw new Error('设计费必须为 0-999999 之间的金额');
      }
    }
    const days = Math.min(Math.max(parseInt(validDays, 10) || 7, 1), 30);
    const remarkStr = remark ? String(remark).trim().slice(0, 500) : null;

    // 询价单报价有效期兜底：工厂报价有效期不超过询价单本身的有效期
    let expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000);
    if (push.expires_at && new Date(push.expires_at) < expiresAt) {
      expiresAt = new Date(push.expires_at);
    }

    await conn.query(
      `UPDATE c_inquiry
       SET status = 'factory_quoted',
           matched_factory_id = ?,
           factory_quoted_price = ?,
           factory_quoted_at = NOW(),
           factory_quote_expires_at = ?,
           factory_quote_remark = ?,
           design_fee = ?
       WHERE id = ?`,
      [push.factory_id, quotedPrice, expiresAt, remarkStr, fee, push.inquiry_id]
    );
    // 推送记录同步覆盖 factory_quote（用户端「按此厂报价」展示正式报价）
    await conn.query(
      'UPDATE factory_inquiry_push SET factory_quote = ? WHERE id = ?',
      [quotedPrice, pushId]
    );

    // 站内信通知用户（匿名询价无接收人，跳过）
    if (push.user_id) {
      const [fs] = await conn.query('SELECT name FROM factory WHERE id = ?', [push.factory_id]);
      const facName = (fs[0] || {}).name || '工厂';
      await conn.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'factory_quoted', '工厂已报价', ?, 'inquiry', ?)`,
        [
          push.user_id,
          `您的询价 ${push.inquiry_no} 已收到「${facName}」的正式报价：¥${quotedPrice}`
            + (fee != null && fee > 0 ? `（含设计费 ¥${fee}）` : '')
            + (remarkStr ? `（${remarkStr}）` : '')
            + '，请在有效期内确认，逾期需重新询价。',
          push.inquiry_id,
        ]
      );
    }

    await conn.commit();
    return {
      pushId,
      inquiryId: push.inquiry_id,
      inquiryStatus: 'factory_quoted',
      factoryQuotedPrice: quotedPrice,
      designFee: fee,
      expiresAt,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 017 新流程：用户确认工厂报价并生成订单（factory_quoted → user_confirmed → 订单）
 * 订单金额 = 工厂正式报价（非系统参考价）；事务 + 行锁防并发重复下单
 */
async function confirmFactoryQuote({ inquiryId, user }) {
  const conn = await pool.getConnection();
  let createdOrderNo = null;
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM c_inquiry WHERE id = ? FOR UPDATE',
      [inquiryId]
    );
    if (!rows.length) throw new Error('询价不存在');
    const inquiry = rows[0];

    // 归属：已归属询价仅本人可确认；匿名询价登录用户操作时顺带绑定
    if (inquiry.user_id) {
      if (!user || inquiry.user_id !== user.id) throw new Error('无权操作该询价');
    } else if (user) {
      await conn.query('UPDATE c_inquiry SET user_id = ? WHERE id = ? AND user_id IS NULL', [user.id, inquiryId]);
      inquiry.user_id = user.id;
    }

    if (inquiry.status !== 'factory_quoted') {
      throw new Error(inquiry.status === 'matched' ? '工厂还未报价' : '该询价当前状态不可确认');
    }

    // 防自刷：不能确认自己名下工厂的报价（前面环节已拦，这里纵深防御兜底）
    if (inquiry.user_id && inquiry.matched_factory_id) {
      const selfFactoryId = await getUserBoundFactoryId(inquiry.user_id);
      if (selfFactoryId && selfFactoryId === Number(inquiry.matched_factory_id)) {
        throw new Error('不能确认自己名下工厂的报价');
      }
    }
    if (!inquiry.factory_quoted_price || Number(inquiry.factory_quoted_price) <= 0) {
      throw new Error('工厂报价数据缺失');
    }
    if (inquiry.factory_quote_expires_at && new Date(inquiry.factory_quote_expires_at) < new Date()) {
      throw new Error('工厂报价已过期，请重新询价');
    }

    const totalPrice = Number(inquiry.factory_quoted_price);
    const unitPrice = inquiry.quantity ? round(totalPrice / inquiry.quantity, 4) : 0;
    // 报价工厂兜底：factory_quoted 状态正常已写入 matched_factory_id；
    // 历史数据/旁路流程缺失时回退到该询价最新一条带报价的推送记录，避免订单 factory_id 为 NULL 直接 500
    let factoryId = inquiry.matched_factory_id;
    if (!factoryId) {
      const [pushes] = await conn.query(
        'SELECT factory_id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_quote IS NOT NULL ORDER BY id DESC LIMIT 1',
        [inquiryId]
      );
      factoryId = pushes.length ? pushes[0].factory_id : null;
    }
    if (!factoryId) throw new Error('报价工厂信息缺失，请重新询价或联系客服');
    // 兜底命中时把工厂回写，后续列表/详情的工厂名才能正常带出
    if (!inquiry.matched_factory_id) {
      await conn.query('UPDATE c_inquiry SET matched_factory_id = ? WHERE id = ?', [factoryId, inquiryId]);
    }

    // 状态推进 + 确认时间（幂等：仅 factory_quoted 可推进，重复确认被拦截）
    const [upd] = await conn.query(
      "UPDATE c_inquiry SET status = 'user_confirmed', user_confirmed_at = NOW() WHERE id = ? AND status = 'factory_quoted'",
      [inquiryId]
    );
    if (!upd.affectedRows) throw new Error('该询价已处理，请勿重复确认');

    // 生成订单（uk_inquiry 唯一键兜底防重复）
    const orderNo = await nextBizNo('OD');
    await conn.query(
      `INSERT INTO order_main
         (order_no, inquiry_id, user_id, factory_id, product_type, print_mode,
          length_m, width_m, height_m, quantity, material_type, material_code, color_count,
          processes, unit_price, total_price, status, pay_status, contact_name, contact_phone)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending','unpaid',?,?)`,
      [
        orderNo, inquiryId, inquiry.user_id || null, factoryId,
        inquiry.product_type, inquiry.print_mode,
        inquiry.length_m, inquiry.width_m, inquiry.height_m, inquiry.quantity,
        inquiry.material_type, inquiry.material_code, inquiry.color_count || 4,
        typeof inquiry.processes === 'string' ? inquiry.processes : safeJsonStringify(inquiry.processes, []),
        unitPrice, totalPrice,
        inquiry.contact_name || null, inquiry.contact_phone || null,
      ]
    );
    createdOrderNo = orderNo;

    // 该厂推送记录标记成交（统计口径与旧流程 accept 一致）
    if (factoryId) {
      await conn.query(
        "UPDATE factory_inquiry_push SET response = 'accept', respond_time = NOW() WHERE inquiry_id = ? AND factory_id = ?",
        [inquiryId, factoryId]
      );
      // F-73/74：接单计数 + 平均响应时长滑动平均（从工厂报价时间起算）
      const hours = Math.max(0, round(
        (Date.now() - new Date(inquiry.factory_quoted_at || inquiry.created_at).getTime()) / 3600000, 2
      ));
      const [fRows] = await conn.query(
        'SELECT total_accepts, avg_response_hours FROM factory WHERE id = ? FOR UPDATE',
        [factoryId]
      );
      const facStat = fRows[0] || { total_accepts: 0, avg_response_hours: null };
      const n = Number(facStat.total_accepts) || 0;
      const newAvg = n === 0 ? hours : round(((Number(facStat.avg_response_hours) || 0) * n + hours) / (n + 1), 2);
      await conn.query(
        'UPDATE factory SET total_accepts = total_accepts + 1, avg_response_hours = ? WHERE id = ?',
        [newAvg, factoryId]
      );
    }

    // 站内信：订单已生成，请尽快支付
    if (inquiry.user_id) {
      await conn.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'order_created', '订单已生成', ?, 'order', ?)`,
        [
          inquiry.user_id,
          `询价 ${inquiry.inquiry_no} 已生成订单 ${orderNo}，金额 ¥${totalPrice}（工厂正式报价），请尽快支付。`,
          inquiryId,
        ]
      );
    }

    await conn.commit();
    return { inquiryId, orderNo: createdOrderNo, totalPrice, factoryId };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  createCInquiry,
  selectFactory,
  listFactoryInquiries,
  respondInquiry,
  factoryQuoteInquiry,
  confirmFactoryQuote,
  getInquiryStatus,
  getFactoryQuote,
  rateOrder,
};