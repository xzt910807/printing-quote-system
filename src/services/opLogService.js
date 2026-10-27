/**
 * F-158：工厂员工操作日志
 * 关键动作落库（factory_operation_log）：登录、接单/拒单、订单推进、收款确认、
 * 改价、员工管理、退款。失败仅告警不影响主流程。
 */
const { pool } = require('../config/db');

function clientIp(req) {
  if (!req) return null;
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0].trim().slice(0, 50) || null;
}

/**
 * @param {object} p
 *   factoryId   工厂ID（必填）
 *   factoryUser 操作员工（factory_user 行；系统动作可省略）
 *   action      动作编码，如 login / login_abnormal / accept / decline / order_confirm /
 *               order_produce / order_ship / order_cancel / offline_paid / pricing /
 *               override / staff_add / staff_edit / staff_toggle / staff_delete / refund_apply / refund_confirm
 *   detail      详情文本（截断 500）
 *   req         express 请求（取 IP）
 */
async function logOp({ factoryId, factoryUser, action, detail, req }) {
  try {
    await pool.query(
      `INSERT INTO factory_operation_log (factory_id, factory_user_id, username, action, detail, ip)
       VALUES (?,?,?,?,?,?)`,
      [
        factoryId,
        factoryUser ? factoryUser.id : null,
        factoryUser ? factoryUser.username : null,
        String(action || '').slice(0, 50),
        detail ? String(detail).slice(0, 500) : null,
        clientIp(req),
      ]
    );
  } catch (e) {
    console.error('[opLog] 写入失败:', e.message);
  }
}

/** 工厂端操作日志查询（员工管理页/老板查看） */
async function listOps({ factoryId, username, action, page = 1, pageSize = 30 } = {}) {
  const where = ['factory_id = ?'];
  const params = [factoryId];
  if (username) { where.push('username LIKE ?'); params.push('%' + username + '%'); }
  if (action) { where.push('action = ?'); params.push(action); }
  const w = ' WHERE ' + where.join(' AND ');
  const [[cnt]] = await pool.query('SELECT COUNT(*) c FROM factory_operation_log' + w, params);
  const [rows] = await pool.query(
    'SELECT * FROM factory_operation_log' + w + ' ORDER BY id DESC LIMIT ? OFFSET ?',
    [...params, Math.min(100, pageSize), (Math.max(1, page) - 1) * pageSize]
  );
  return { total: cnt.c, list: rows };
}

module.exports = { logOp, listOps };
