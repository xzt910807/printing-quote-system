/**
 * 轻量定时任务（无外部 cron 依赖，setInterval 驱动；单进程部署下足够）：
 *   F-33 报价失效标记：expires_at 过期的 quoted/matched 询价标记为 expired（堵住 selectFactory 口）
 *   F-55 支付超时回滚：超时未支付的线上订单自动取消（线下转账单排除，等工厂确认收款）
 *   F-78 每日统计：daily_stats 按天 UPSERT（启动补昨天 + 每 10 分钟刷新今天，跨天边界双写保险）
 *   P1 监控：每轮 tick 结果写 sys_kv 心跳（/health 拨测判活），失败走 alertService 告警；
 *   P1 清理：语音临时目录孤儿录音（进程崩溃残留）超过 2 小时自动删除
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const alertService = require('./alertService');

const TICK_MINUTES = 10;
const PAY_TIMEOUT_HOURS = Number(process.env.PAY_TIMEOUT_HOURS) || 24;
// 拨测判定阈值：连续两轮以上无成功心跳即视为异常
const HEARTBEAT_KEY = 'cron_heartbeat';
const STALE_MINUTES = Number(process.env.CRON_STALE_MINUTES) || 45;

/** sys_kv 读写（心跳等轻量 KV，表不存在时静默跳过——未跑 026 迁移的老库不影响业务） */
async function kvSet(key, value) {
  try {
    await pool.query(
      `INSERT INTO sys_kv (k, v, updated_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = NOW()`,
      [key, String(value)]
    );
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') console.warn('[cron] kvSet 失败:', e.message);
  }
}

async function kvGet(key) {
  try {
    const [rows] = await pool.query('SELECT v, updated_at FROM sys_kv WHERE k = ?', [key]);
    return rows.length ? { v: rows[0].v, updatedAt: rows[0].updated_at } : null;
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') console.warn('[cron] kvGet 失败:', e.message);
    return null;
  }
}

/** P1 拨测支持：cron 心跳状态（供 /health 返回 stale 判定） */
async function getCronHealth() {
  const rec = await kvGet(HEARTBEAT_KEY);
  if (!rec) {
    return { ok: false, state: 'no_heartbeat', hint: '未找到 cron 心跳（sys_kv 表缺失或任务从未执行）' };
  }
  let info = {};
  try { info = JSON.parse(rec.v) || {}; } catch (e) { /* 脏数据按空处理 */ }
  const ageMin = (Date.now() - new Date(rec.updatedAt).getTime()) / 60000;
  const stale = ageMin > STALE_MINUTES;
  return {
    ok: !stale && info.ok !== false,
    state: info.ok === false ? 'last_run_failed' : (stale ? 'stale' : 'ok'),
    lastRunAt: rec.updatedAt,
    lastError: info.error || null,
    ageMinutes: Math.round(ageMin),
  };
}

/** F-33：报价有效期到期自动标记失效 */
async function expireInquiries() {
  const [ret] = await pool.query(
    `UPDATE c_inquiry SET status = 'expired'
     WHERE status IN ('quoted', 'matched') AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
  if (ret.affectedRows) console.log('[cron] F-33 报价失效标记 ' + ret.affectedRows + ' 条');
}

/** F-55：支付超时订单回滚取消（仅线上渠道；offline 线下转账等工厂确认，不自动取消） */
async function cancelUnpaidOrders() {
  const [ret] = await pool.query(
    `UPDATE order_main SET status = 'cancelled'
     WHERE status = 'pending' AND pay_status = 'unpaid'
       AND (pay_method IS NULL OR pay_method = '' OR pay_method IN ('mock', 'wechat'))
       AND created_at < (NOW() - INTERVAL ? HOUR)`,
    [PAY_TIMEOUT_HOURS]
  );
  if (ret.affectedRows) console.log('[cron] F-55 支付超时取消 ' + ret.affectedRows + ' 单（>' + PAY_TIMEOUT_HOURS + 'h 未支付）');
}

/** F-78：统计某天并 UPSERT（幂等，可反复执行刷新） */
async function statDay(dateStr) {
  const dayStart = dateStr + ' 00:00:00';
  const [[inq]] = await pool.query(
    `SELECT COUNT(*) c FROM c_inquiry WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  const [[views]] = await pool.query(
    `SELECT COUNT(*) c FROM c_inquiry_quote_view WHERE viewed_at >= ? AND viewed_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  const [[sel]] = await pool.query(
    `SELECT COUNT(*) c FROM c_inquiry WHERE quoted_at >= ? AND quoted_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  const [[acc]] = await pool.query(
    `SELECT COUNT(*) c FROM c_inquiry WHERE accepted_at >= ? AND accepted_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  const [[orders]] = await pool.query(
    `SELECT COUNT(*) c, COALESCE(SUM(total_price + shipping_fee + sample_fee), 0) amt
     FROM order_main WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  const [[users]] = await pool.query(
    `SELECT COUNT(*) c FROM c_end_user WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  const [[facs]] = await pool.query(
    `SELECT COUNT(*) c FROM factory WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dayStart, dayStart]);
  await pool.query(
    `INSERT INTO daily_stats
       (stat_date, new_inquiries, quote_views, factory_selected, inquiries_accepted,
        new_orders, order_amount, new_users, new_factories)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       new_inquiries = VALUES(new_inquiries), quote_views = VALUES(quote_views),
       factory_selected = VALUES(factory_selected), inquiries_accepted = VALUES(inquiries_accepted),
       new_orders = VALUES(new_orders), order_amount = VALUES(order_amount),
       new_users = VALUES(new_users), new_factories = VALUES(new_factories)`,
    [dateStr, inq.c, views.c, sel.c, acc.c, orders.c, Number(orders.amt) || 0, users.c, facs.c]);
}

function fmtDate(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** P1 清理：语音临时目录孤儿文件（正常链路用完即删，这里只兼崩溃残留） */
async function cleanVoiceTmp() {
  const dir = path.join(__dirname, '..', '..', 'data', 'voice-tmp');
  if (!fs.existsSync(dir)) return 0;
  const maxAgeMs = 2 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && Date.now() - st.mtimeMs > maxAgeMs) { fs.unlinkSync(p); removed++; }
    } catch (e) { /* 已被其它请求删除则忽略 */ }
  }
  if (removed) console.log('[cron] 清理孤儿录音文件 ' + removed + ' 个');
  return removed;
}

async function tick() {
  const started = Date.now();
  try {
    await expireInquiries();
    await cancelUnpaidOrders();
    await cleanVoiceTmp();
    const now = new Date();
    const today = fmtDate(now);
    const yest = fmtDate(new Date(now.getTime() - 86400000));
    await statDay(yest);
    await statDay(today);
    // 心跳：成功也落库（含耗时），/health 据此判活
    await kvSet(HEARTBEAT_KEY, JSON.stringify({ ok: true, costMs: Date.now() - started }));
  } catch (e) {
    console.error('[cron] tick 失败:', e.message);
    // P1 告警：失败写失败心跳 + 推运维通道（同 key 30 分钟冷却，并同步发管理员站内消息）
    await kvSet(HEARTBEAT_KEY, JSON.stringify({ ok: false, error: String(e.message || e).slice(0, 300) }));
    await alertService.send('cron_tick', '⚠️ 定时任务执行失败：' + String(e.message || e).slice(0, 200), { alertToAdmin: true });
  }
}

/** 启动定时任务：立即跑一轮（补昨天统计 + 失效标记），之后每 TICK_MINUTES 分钟一轮 */
function start() {
  setTimeout(tick, 3000); // 等库连接就绪
  setInterval(tick, TICK_MINUTES * 60 * 1000);
  console.log('[cron] 定时任务已启动：每 ' + TICK_MINUTES + ' 分钟（失效标记/超时回滚/每日统计）');
}

module.exports = { start, tick, statDay, getCronHealth, kvSet, kvGet, STALE_MINUTES };
