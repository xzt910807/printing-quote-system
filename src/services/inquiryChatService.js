/**
 * 询价会话消息服务（融合印查查「IM 在线沟通」）
 * 会话维度：inquiry_id + factory_id（一条询价推给多家工厂，每家一个独立会话）
 * 参与方：user（c_inquiry.user_id 归属客户）↔ factory（factory_inquiry_push 命中工厂）
 * 归属校验严格：客户只能操作自己名下的询价会话；工厂只能操作推送给自己的会话。
 */
const { pool } = require('../config/db');
const guard = require('./contentGuard');
const catalog = require('./catalogService');

const MAX_CONTENT_LEN = 500;

/**
 * 会话顶部的实时单据卡（解决“在线沟通不知道在说哪一单”）
 * 不往消息流里写快照：议价过程中价格一直在变, 落库的卡片消息会立刻变成过期信息,
 * 故每次读会话现取 c_inquiry/factory_inquiry_push/order_main, 价格与状态永远是当前的
 */
async function getThreadContext({ inquiryId, factoryId, viewerType }) {
  const [[inq]] = await pool.query(
    `SELECT ci.id, ci.inquiry_no, ci.status, ci.product_type, ci.print_mode, ci.quantity,
            ci.length_m, ci.width_m, ci.height_m, ci.material_code, ci.color_count, ci.spot_colors,
            ci.processes, ci.contact_name, ci.design_status, ci.design_fee, ci.system_quote,
            ci.factory_quoted_price, ci.prev_quoted_price, ci.quote_revision,
            ci.factory_quote_remark, ci.factory_quote_expires_at, ci.matched_factory_id,
            f.name AS factory_name, eu.nickname,
            o.order_no, o.status AS order_status, o.pay_status AS order_pay_status
     FROM c_inquiry ci
     JOIN factory f ON f.id = ?
     LEFT JOIN c_end_user eu ON eu.id = ci.user_id
     LEFT JOIN order_main o ON o.inquiry_id = ci.id
     WHERE ci.id = ?`,
    [factoryId, inquiryId]
  );
  if (!inq) return null;

  const spec = catalog.describeSpec(inq);
  // 系统参考价：存的是 finalPrice（含税总价）, 旧数据兜底 totalPrice
  let systemPrice = null;
  try {
    const sq = typeof inq.system_quote === 'string' ? JSON.parse(inq.system_quote) : inq.system_quote;
    const v = sq && (sq.finalPrice != null ? sq.finalPrice : sq.totalPrice);
    if (v != null) systemPrice = Number(v);
  } catch (e) { /* 非 JSON 就当无参考价 */ }

  // 本厂在该询价上的推送记录：工厂就地改价需要 pushId（报价接口按 push 定位）
  const [[push]] = await pool.query(
    'SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_id = ? ORDER BY id DESC LIMIT 1',
    [inquiryId, factoryId]
  );

  const quoteExpired = !!(inq.factory_quote_expires_at && new Date(inq.factory_quote_expires_at) < new Date());
  const p2 = (n) => (n < 10 ? '0' + n : '' + n);
  const exp = inq.factory_quote_expires_at ? new Date(inq.factory_quote_expires_at) : null;
  const quoteExpiresText = exp && !isNaN(exp.getTime())
    ? `${p2(exp.getMonth() + 1)}-${p2(exp.getDate())} ${p2(exp.getHours())}:${p2(exp.getMinutes())}` : '';

  return {
    inquiryNo: inq.inquiry_no,
    status: inq.status,
    productType: inq.product_type,
    quantity: Number(inq.quantity) || 0,
    specTags: [spec.printModeText, spec.sizeText, spec.materialText, spec.colorText].filter(Boolean),
    processText: spec.processText,
    designStatus: inq.design_status,
    designFee: inq.design_fee != null ? Number(inq.design_fee) : null,
    systemPrice,
    factoryPrice: inq.factory_quoted_price != null ? Number(inq.factory_quoted_price) : null,
    prevPrice: inq.prev_quoted_price != null ? Number(inq.prev_quoted_price) : null,
    revision: Number(inq.quote_revision) || 1,
    quoteRemark: inq.factory_quote_remark || '',
    quoteExpiresText,
    quoteExpired,
    factoryName: inq.factory_name || '',
    customerName: inq.nickname || inq.contact_name || '客户',
    pushId: push ? Number(push.id) : 0,
    orderNo: inq.order_no || '',
    orderStatus: inq.order_status || '',
    orderPayStatus: inq.order_pay_status || '',
    // 就地改价只对“报价方本厂 + 客户尚未确认 + 报价未过期”开放（与后端校验同口径）
    canRequote: viewerType === 'factory' && inq.status === 'factory_quoted'
      && Number(inq.matched_factory_id) === Number(factoryId) && !quoteExpired,
  };
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** 校验客户对该会话的归属（询价 user_id 必须为本人） */
async function assertUserAccess(inquiryId, userId) {
  const [[inq]] = await pool.query('SELECT id, user_id, inquiry_no FROM c_inquiry WHERE id = ?', [inquiryId]);
  if (!inq) throw httpError('询价不存在', 404);
  if (!inq.user_id || Number(inq.user_id) !== Number(userId)) throw httpError('无权访问该会话', 403);
  return inq;
}

/** 校验工厂对该会话的归属（必须是被推送过的工厂） */
async function assertFactoryAccess(inquiryId, factoryId) {
  const [[push]] = await pool.query(
    'SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_id = ?',
    [inquiryId, factoryId]
  );
  if (!push) throw httpError('该询价未推送给你厂，无法进入会话', 403);
}

/**
 * 发送消息
 * @param {Object} p { inquiryId, factoryId, senderType:'user'|'factory', senderId, content }
 */
async function sendMessage(p) {
  const inquiryId = parseInt(p.inquiryId, 10);
  const factoryId = parseInt(p.factoryId, 10);
  const content = String(p.content || '').trim().slice(0, MAX_CONTENT_LEN);
  if (!inquiryId || !factoryId) throw httpError('参数不完整', 400);
  if (!content) throw httpError('消息内容不能为空', 400);
  if (!['user', 'factory'].includes(p.senderType)) throw httpError('发送方身份无效', 400);

  if (p.senderType === 'user') await assertUserAccess(inquiryId, p.senderId);
  else await assertFactoryAccess(inquiryId, factoryId);

  // 内容安全：按发送方身份取 openid 检测（未配置微信或该账号未绑微信时护栏自动放行）
  const openid = p.senderType === 'user'
    ? await guard.userOpenid(p.senderId)
    : await guard.factoryOpenid(p.senderId);
  await guard.assertTextAllowed([{ label: '消息', value: content }], { openid, scene: 'chat' });

  const [ret] = await pool.query(
    'INSERT INTO inquiry_message (inquiry_id, factory_id, sender_type, sender_id, content) VALUES (?,?,?,?,?)',
    [inquiryId, factoryId, p.senderType, p.senderId, content]
  );
  const [[msg]] = await pool.query(
    'SELECT id, inquiry_id, factory_id, sender_type, sender_id, content, is_read, created_at FROM inquiry_message WHERE id = ?',
    [ret.insertId]
  );

  // 工厂回复 → 站内信通知客户（复用 c_message，小程序「我的消息」/订阅消息触达）
  if (p.senderType === 'factory') await notifyUserThread({ inquiryId, factoryId, preview: content });

  return msg;
}

/**
 * 工厂侧有新内容 → 给客户发一条站内信（文本消息与协同文件共用）
 * 客户→工厂没有站内信通道（c_message 只面向 C 端）, 靠接单页的未读徽标触达
 */
async function notifyUserThread({ inquiryId, factoryId, preview }) {
  const [[inq]] = await pool.query('SELECT user_id, inquiry_no FROM c_inquiry WHERE id = ?', [inquiryId]);
  if (!inq || !inq.user_id) return;
  const [[fac]] = await pool.query('SELECT name FROM factory WHERE id = ?', [factoryId]);
  await pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
     VALUES (?, 'chat_message', ?, ?, 'inquiry', ?)`,
    [inq.user_id, '工厂有新消息',
      `「${(fac && fac.name) || '工厂'}」回复了询价 ${inq.inquiry_no}：${preview.slice(0, 120)}`,
      inquiryId]
  );
}

/**
 * 协同文件作为一条会话消息进消息流
 * 026 的文件面板只躺在输入栏上方, 对方不点进这个会话、不展开面板就永远不知道有新文件;
 * 落到 inquiry_message 后才能复用已有的未读计数与站内信。不做内容安全检测：
 * 文件本体已由上传接口的类型/体积白名单拦过, 再拿文件名去过微信文本检测只会因
 * 名字里的生僻字符把已落盘的文件堵在门外
 * @param {Object} p { inquiryId, factoryId, senderType, senderId, fileId, fileName, isImage }
 */
async function sendFileMessage(p) {
  const inquiryId = parseInt(p.inquiryId, 10);
  const factoryId = parseInt(p.factoryId, 10);
  const fileId = parseInt(p.fileId, 10);
  if (!inquiryId || !factoryId || !fileId) throw httpError('参数不完整', 400);
  if (!['user', 'factory'].includes(p.senderType)) throw httpError('发送方身份无效', 400);

  if (p.senderType === 'user') await assertUserAccess(inquiryId, p.senderId);
  else await assertFactoryAccess(inquiryId, factoryId);

  // content 冗余一份可读标签：会话列表的最后一条预览、以及消息通知都直接用它, 不用再关联文件表
  const label = `${p.isImage ? '[图片]' : '[文件]'} ${String(p.fileName || '未命名')}`.slice(0, MAX_CONTENT_LEN);
  const [ret] = await pool.query(
    'INSERT INTO inquiry_message (inquiry_id, factory_id, sender_type, sender_id, content, msg_type, file_id) VALUES (?,?,?,?,?,?,?)',
    [inquiryId, factoryId, p.senderType, p.senderId, label, 'file', fileId]
  );
  if (p.senderType === 'factory') await notifyUserThread({ inquiryId, factoryId, preview: label });
  return ret.insertId;
}

/**
 * 读取会话消息（按时间升序），并将对方发来的消息标记已读
 * @param {Object} p { inquiryId, factoryId, viewerType:'user'|'factory' }
 * @returns {Promise<{list:Array,readNow:number}>} readNow = 本次标记已读的对方消息数
 */
async function listThread(p) {
  const inquiryId = parseInt(p.inquiryId, 10);
  const factoryId = parseInt(p.factoryId, 10);
  if (!inquiryId || !factoryId) throw httpError('参数不完整', 400);

  if (p.viewerType === 'user') await assertUserAccess(inquiryId, p.viewerId);
  else await assertFactoryAccess(inquiryId, factoryId);

  const [rows] = await pool.query(
    `SELECT im.id, im.sender_type, im.sender_id, im.content, im.is_read, im.created_at,
            im.msg_type, im.file_id,
            ft.file_name, ft.file_url, ft.file_size, ft.mime_type
     FROM inquiry_message im
     LEFT JOIN file_transfer ft ON ft.id = im.file_id
     WHERE im.inquiry_id = ? AND im.factory_id = ?
     ORDER BY im.id ASC LIMIT 200`,
    [inquiryId, factoryId]
  );

  // 进入会话即把「对方发来的」消息置为已读（先统计再更新，返回本次消费掉的新消息数）
  const [[unread]] = await pool.query(
    'SELECT COUNT(*) AS c FROM inquiry_message WHERE inquiry_id = ? AND factory_id = ? AND sender_type != ? AND is_read = 0',
    [inquiryId, factoryId, p.viewerType]
  );
  if (unread.c > 0) {
    await pool.query(
      'UPDATE inquiry_message SET is_read = 1 WHERE inquiry_id = ? AND factory_id = ? AND sender_type != ? AND is_read = 0',
      [inquiryId, factoryId, p.viewerType]
    );
  }

  return { list: rows, readNow: Number(unread.c) || 0, context: await getThreadContext(p) };
}

/** 批量补齐会话最后一条消息/时间/未读（修复原 N+1：逐会话单发一条 SQL） */
async function attachLastInfo(rows, selfType) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.lastId).filter(Boolean);
  const map = {};
  if (ids.length) {
    const [lasts] = await pool.query(
      'SELECT id, sender_type, content, created_at FROM inquiry_message WHERE id IN (?)', [ids]
    );
    lasts.forEach((l) => { map[l.id] = l; });
  }
  for (const r of rows) {
    const last = map[r.lastId];
    r.lastMessage = last ? (last.sender_type === selfType ? '我：' : '') + last.content : '';
    r.lastTime = last ? last.created_at : null;
    r.unread = Number(r.unread) || 0;
  }
  return rows;
}

/** 会话总数（inquiry×factory 维度, 与分页列表 GROUP BY 口径一致） */
async function countThread(whereSql, params) {
  const [[cnt]] = await pool.query(
    `SELECT COUNT(DISTINCT im.inquiry_id, im.factory_id) AS total FROM inquiry_message im ${whereSql}`,
    params
  );
  return Number(cnt.total) || 0;
}

/**
 * 客户的会话列表（分页）：我发起的、有消息往来的询价
 * 返回每个会话的工厂、最后一条消息、未读数（工厂发来且我未读）
 */
async function listUserThreads(userId, { page = 1, pageSize = 20 } = {}) {
  const limit = parseInt(pageSize, 10);
  const offset = (parseInt(page, 10) - 1) * limit;
  const [rows] = await pool.query(
    `SELECT im.factory_id AS factoryId, im.inquiry_id AS inquiryId, ci.inquiry_no AS inquiryNo,
            f.name AS factoryName,
            MAX(im.id) AS lastId,
            SUM(CASE WHEN im.sender_type = 'factory' AND im.is_read = 0 THEN 1 ELSE 0 END) AS unread
     FROM inquiry_message im
     JOIN c_inquiry ci ON ci.id = im.inquiry_id
     JOIN factory f ON f.id = im.factory_id
     WHERE ci.user_id = ?
     GROUP BY im.factory_id, im.inquiry_id, ci.inquiry_no, f.name
     ORDER BY lastId DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  await attachLastInfo(rows, 'user');
  const total = await countThread('JOIN c_inquiry ci ON ci.id = im.inquiry_id WHERE ci.user_id = ?', [userId]);
  return { total, list: rows };
}

/**
 * 工厂的会话列表（分页）：推送给我厂且有消息往来的询价
 * 未读 = 客户发来且未读
 */
async function listFactoryThreads(factoryId, { page = 1, pageSize = 20 } = {}) {
  const limit = parseInt(pageSize, 10);
  const offset = (parseInt(page, 10) - 1) * limit;
  const [rows] = await pool.query(
    `SELECT im.inquiry_id AS inquiryId, ci.inquiry_no AS inquiryNo,
            ci.product_type AS productType, ci.quantity AS quantity,
            MAX(im.id) AS lastId,
            SUM(CASE WHEN im.sender_type = 'user' AND im.is_read = 0 THEN 1 ELSE 0 END) AS unread
     FROM inquiry_message im
     JOIN c_inquiry ci ON ci.id = im.inquiry_id
     WHERE im.factory_id = ?
     GROUP BY im.inquiry_id, ci.inquiry_no, ci.product_type, ci.quantity
     ORDER BY lastId DESC LIMIT ? OFFSET ?`,
    [factoryId, limit, offset]
  );
  // 客户昵称需经 c_end_user 关联；会话发起方可能是匿名（user_id 为 NULL）
  const inquiryIds = rows.map((r) => r.inquiryId);
  const nameMap = {};
  if (inquiryIds.length) {
    const [users] = await pool.query(
      `SELECT ci.id AS inquiryId, eu.nickname, eu.phone, ci.contact_name, ci.contact_phone
       FROM c_inquiry ci LEFT JOIN c_end_user eu ON eu.id = ci.user_id
       WHERE ci.id IN (?)`,
      [inquiryIds]
    );
    for (const u of users) {
      nameMap[u.inquiryId] = u.nickname || u.contact_name || (u.phone || u.contact_phone || '客户');
    }
  }
  await attachLastInfo(rows, 'factory');
  rows.forEach((r) => { r.customerName = nameMap[r.inquiryId] || '客户'; });
  const total = await countThread('JOIN c_inquiry ci ON ci.id = im.inquiry_id WHERE im.factory_id = ?', [factoryId]);
  return { total, list: rows };
}

/** 客户未读会话消息总数（用于 tab 徽标） */
async function userUnread(userId) {
  const [[r]] = await pool.query(
    `SELECT COUNT(*) AS c FROM inquiry_message im
     JOIN c_inquiry ci ON ci.id = im.inquiry_id
     WHERE ci.user_id = ? AND im.sender_type = 'factory' AND im.is_read = 0`,
    [userId]
  );
  return Number(r.c) || 0;
}

/** 工厂未读会话消息总数（用于 B 端徽标） */
async function factoryUnread(factoryId) {
  const [[r]] = await pool.query(
    "SELECT COUNT(*) AS c FROM inquiry_message WHERE factory_id = ? AND sender_type = 'user' AND is_read = 0",
    [factoryId]
  );
  return Number(r.c) || 0;
}

module.exports = { sendMessage, sendFileMessage, listThread, listUserThreads, listFactoryThreads, userUnread, factoryUnread, getThreadContext };
