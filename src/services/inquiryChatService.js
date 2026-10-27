/**
 * 询价会话消息服务（融合印查查「IM 在线沟通」）
 * 会话维度：inquiry_id + factory_id（一条询价推给多家工厂，每家一个独立会话）
 * 参与方：user（c_inquiry.user_id 归属客户）↔ factory（factory_inquiry_push 命中工厂）
 * 归属校验严格：客户只能操作自己名下的询价会话；工厂只能操作推送给自己的会话。
 */
const { pool } = require('../config/db');
const guard = require('./contentGuard');

const MAX_CONTENT_LEN = 500;

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
  if (p.senderType === 'factory') {
    const [[inq]] = await pool.query('SELECT user_id, inquiry_no FROM c_inquiry WHERE id = ?', [inquiryId]);
    if (inq && inq.user_id) {
      const [[fac]] = await pool.query('SELECT name FROM factory WHERE id = ?', [factoryId]);
      await pool.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'chat_message', ?, ?, 'inquiry', ?)`,
        [inq.user_id, '工厂有新消息',
          `「${(fac && fac.name) || '工厂'}」回复了询价 ${inq.inquiry_no}：${content.slice(0, 120)}`,
          inquiryId]
      );
    }
  }

  return msg;
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
    `SELECT id, sender_type, sender_id, content, is_read, created_at
     FROM inquiry_message WHERE inquiry_id = ? AND factory_id = ?
     ORDER BY id ASC LIMIT 200`,
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

  return { list: rows, readNow: Number(unread.c) || 0 };
}

/**
 * 客户的会话列表：我发起的、有消息往来且工厂有回复的询价
 * 返回每个会话的工厂、最后一条消息、未读数（工厂发来且我未读）
 */
async function listUserThreads(userId) {
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
     ORDER BY lastId DESC LIMIT 100`,
    [userId]
  );
  for (const r of rows) {
    const [[last]] = await pool.query(
      'SELECT sender_type, content, created_at FROM inquiry_message WHERE id = ?', [r.lastId]
    );
    r.lastMessage = last ? (last.sender_type === 'user' ? '我：' : '') + last.content : '';
    r.lastTime = last ? last.created_at : null;
    r.unread = Number(r.unread) || 0;
  }
  return rows;
}

/**
 * 工厂的会话列表：推送给我厂且有消息往来的询价
 * 未读 = 客户发来且未读
 */
async function listFactoryThreads(factoryId) {
  const [rows] = await pool.query(
    `SELECT im.inquiry_id AS inquiryId, ci.inquiry_no AS inquiryNo,
            ci.product_type AS productType, ci.quantity AS quantity,
            MAX(im.id) AS lastId,
            SUM(CASE WHEN im.sender_type = 'user' AND im.is_read = 0 THEN 1 ELSE 0 END) AS unread
     FROM inquiry_message im
     JOIN c_inquiry ci ON ci.id = im.inquiry_id
     WHERE im.factory_id = ?
     GROUP BY im.inquiry_id, ci.inquiry_no, ci.product_type, ci.quantity
     ORDER BY lastId DESC LIMIT 100`,
    [factoryId]
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
  for (const r of rows) {
    const [[last]] = await pool.query(
      'SELECT sender_type, content, created_at FROM inquiry_message WHERE id = ?', [r.lastId]
    );
    r.lastMessage = last ? (last.sender_type === 'factory' ? '我：' : '') + last.content : '';
    r.lastTime = last ? last.created_at : null;
    r.unread = Number(r.unread) || 0;
    r.customerName = nameMap[r.inquiryId] || '客户';
  }
  return rows;
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

module.exports = { sendMessage, listThread, listUserThreads, listFactoryThreads, userUnread, factoryUnread };
