/**
 * 异常反馈工单服务
 * 状态流转：open → processing → resolved → closed
 */
const { pool } = require('../config/db');

const TYPE_LABELS = { quality: '质量投诉', delay: '延期预警', reprint: '补印申请', other: '其他' };
const STATUS_FLOW = { open: ['processing'], processing: ['resolved'], resolved: ['closed'], closed: [] };

function httpError(message, status) {
  const e = new Error(message); e.status = status; return e;
}

/** 生成工单编号 IT + 日期 + 序列（biz_seq 原子 UPSERT 递增，与订单/询价号同源） */
async function generateTicketNo() {
  const today = new Date();
  const ds = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
  const key = `bizno:IT:${ds}`;
  await pool.query(
    `INSERT INTO biz_seq (name, value) VALUES (?, 1) ON DUPLICATE KEY UPDATE value = value + 1`,
    [key]
  );
  const [[row]] = await pool.query('SELECT value FROM biz_seq WHERE name = ?', [key]);
  const seq = String(row.value).padStart(4, '0');
  return `IT${ds}${seq}`;
}

/** 创建工单（factoryId 从订单反查，不信任前端传入） */
async function createTicket({ orderId, userId, type, title, description, images }) {
  if (!orderId || !userId) throw httpError('参数不完整', 400);
  if (!['quality', 'delay', 'reprint', 'other'].includes(type)) throw httpError('问题类型无效', 400);
  if (!title || !String(title).trim()) throw httpError('标题不能为空', 400);

  // 校验订单归属
  const [[order]] = await pool.query('SELECT id, factory_id, user_id FROM order_main WHERE id = ? AND user_id = ?', [orderId, userId]);
  if (!order) throw httpError('订单不存在或无权操作', 403);

  const ticketNo = await generateTicketNo();
  const imgs = Array.isArray(images) ? images.slice(0, 6) : [];

  const [ret] = await pool.query(
    `INSERT INTO issue_ticket (ticket_no, order_id, user_id, factory_id, type, title, description, images)
     VALUES (?,?,?,?,?,?,?,?)`,
    [ticketNo, orderId, userId, order.factory_id, type, String(title).trim().slice(0, 200), description || null, JSON.stringify(imgs)]
  );

  // 通知工厂有新工单
  await pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
     VALUES (?, 'issue_new', ?, ?, 'issue', ?)`,
    [0, '新工单', `工单 ${ticketNo}（${TYPE_LABELS[type]}）：${String(title).slice(0, 100)}`, ret.insertId]
  );

  return { id: ret.insertId, ticketNo };
}

/** 工厂回复 */
async function factoryReply(ticketId, factoryId, reply) {
  const [[ticket]] = await pool.query('SELECT * FROM issue_ticket WHERE id = ? AND factory_id = ?', [ticketId, factoryId]);
  if (!ticket) throw httpError('工单不存在', 404);
  if (!['open', 'processing'].includes(ticket.status)) throw httpError('工单状态不允许回复', 409);

  const newStatus = ticket.status === 'open' ? 'processing' : ticket.status;
  await pool.query(
    'UPDATE issue_ticket SET factory_reply = ?, factory_reply_at = NOW(), status = ? WHERE id = ?',
    [String(reply || '').trim().slice(0, 2000), newStatus, ticketId]
  );

  // 通知用户
  await pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
     VALUES (?, 'issue_reply', ?, ?, 'issue', ?)`,
    [ticket.user_id, '工单有新回复', `工单 ${ticket.ticket_no} 工厂已回复`, ticketId]
  );
}

/** 管理端标注/推进 */
async function adminUpdate(ticketId, { status, adminNote }) {
  const [[ticket]] = await pool.query('SELECT * FROM issue_ticket WHERE id = ?', [ticketId]);
  if (!ticket) throw httpError('工单不存在', 404);

  const updates = [];
  const params = [];
  if (adminNote) { updates.push('admin_note = ?'); params.push(adminNote); }
  if (status && STATUS_FLOW[ticket.status]?.includes(status)) {
    updates.push('status = ?'); params.push(status);
    if (status === 'resolved') { updates.push('resolved_at = NOW()'); }
  }
  if (updates.length) {
    params.push(ticketId);
    await pool.query(`UPDATE issue_ticket SET ${updates.join(', ')} WHERE id = ?`, params);
  }
}

/** 用户确认关闭 */
async function closeByUser(ticketId, userId) {
  const [[ticket]] = await pool.query('SELECT * FROM issue_ticket WHERE id = ? AND user_id = ?', [ticketId, userId]);
  if (!ticket) throw httpError('工单不存在', 404);
  if (ticket.status !== 'resolved') throw httpError('仅已解决的工单可关闭', 409);
  await pool.query("UPDATE issue_ticket SET status = 'closed' WHERE id = ?", [ticketId]);
}

module.exports = { createTicket, factoryReply, adminUpdate, closeByUser, TYPE_LABELS };
