const crypto = require('crypto');
const { pool } = require('../config/db');

// 会话有效期 7 天（滑动续期），单用户最多 5 个会话（多设备同时在线）
const TTL_HOURS = 24 * 7;
const MAX_SESSIONS = 5;

/**
 * 创建会话：超过上限时踢掉最旧的（保留最新 MAX_SESSIONS-1 个 + 新会话 = 5 个）
 * @returns {Promise<string>} 64 位 hex 令牌
 */
async function createSession({ userType, userId, factoryUserId = null, req = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  const device = req ? String(req.headers['user-agent'] || '').slice(0, 200) : null;
  // Node 在 IPv4 网络下 remoteAddress 常带 ::ffff: 前缀（IPv4 映射地址），入库前剥掉，
  // 否则异地登录提醒/在线设备列表直接露出 ::ffff:192.168.x.x，用户看不懂
  const rawIp = req
    ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 50)
    : null;
  const ip = rawIp ? rawIp.replace(/^::ffff:/i, '') : rawIp;
  await pool.query(
    `DELETE FROM user_session WHERE user_type = ? AND user_id = ? AND token NOT IN (
       SELECT token FROM (
         SELECT token FROM user_session WHERE user_type = ? AND user_id = ? ORDER BY last_active_at DESC LIMIT ?
       ) t
     )`,
    [userType, userId, userType, userId, MAX_SESSIONS - 1]
  );
  await pool.query(
    'INSERT INTO user_session (user_type, user_id, factory_user_id, token, device_info, ip, expires_at) VALUES (?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? HOUR))',
    [userType, userId, factoryUserId, token, device, ip, TTL_HOURS]
  );
  return token;
}

/** 按令牌查会话（中间件用；工厂会话须带 factory_user_id） */
async function getSession(token, userType) {
  const [rows] = await pool.query(
    'SELECT id, user_type, user_id, factory_user_id, token, expires_at FROM user_session WHERE token = ? AND user_type = ?',
    [token, userType]
  );
  return rows.length ? rows[0] : null;
}

/** 滑动续期：剩余不足一半时异步续满（expires 为 NULL 的旧数据不续期，保持不限期） */
function slideSession(sessionId, expiresAt) {
  if (!expiresAt) return;
  const halfTtlMs = TTL_HOURS * 3600 * 1000 / 2;
  if (new Date(expiresAt).getTime() - Date.now() > halfTtlMs) return;
  setImmediate(() => pool.query(
    'UPDATE user_session SET expires_at = DATE_ADD(NOW(), INTERVAL ? HOUR) WHERE id = ?',
    [TTL_HOURS, sessionId]
  ).catch(() => {}));
}

function isExpired(expiresAt) {
  return expiresAt && new Date(expiresAt) < new Date();
}

/** 只删当前令牌（登出当前设备） */
async function destroyByToken(token, userType) {
  if (!token) return;
  await pool.query('DELETE FROM user_session WHERE token = ? AND user_type = ?', [token, userType]);
}

/** 踢掉某用户全部会话（登出所有设备 / 禁用账号） */
async function destroyAllForUser(userType, userId) {
  await pool.query('DELETE FROM user_session WHERE user_type = ? AND user_id = ?', [userType, userId]);
}

/** 踢掉某工厂员工的全部会话（禁用/删除员工时调用） */
async function destroyByFactoryUser(factoryUserId) {
  await pool.query('DELETE FROM user_session WHERE user_type = ? AND factory_user_id = ?', ['factory', factoryUserId]);
}

module.exports = {
  TTL_HOURS,
  MAX_SESSIONS,
  createSession,
  getSession,
  slideSession,
  isExpired,
  destroyByToken,
  destroyAllForUser,
  destroyByFactoryUser,
};
