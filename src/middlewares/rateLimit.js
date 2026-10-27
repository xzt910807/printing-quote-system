/**
 * 登录防暴力破解限流（内存版）
 * 规则：同一 IP + 同一登录入口，5 分钟内失败 5 次 → 锁定 15 分钟；登录成功清零。
 * 单机部署足够；若日后多实例，需换 Redis 共享计数。
 */
const WINDOW_MS = 5 * 60 * 1000;      // 统计窗口 5 分钟
const MAX_FAILS = 5;                   // 窗口内最大失败次数
const LOCK_MS = 15 * 60 * 1000;        // 锁定时长 15 分钟

const attempts = new Map(); // key -> { fails: [{ts}], lockedUntil: number }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function keyOf(req) {
  return clientIp(req) + '|' + req.path;
}

function prune(key) {
  const rec = attempts.get(key);
  if (!rec) return;
  const now = Date.now();
  rec.fails = rec.fails.filter((t) => now - t < WINDOW_MS);
  if (!rec.fails.length && (!rec.lockedUntil || rec.lockedUntil < now)) {
    attempts.delete(key);
  }
}

// 每 10 分钟清扫一次，防内存膨胀（Map 规模很小，保险起见）
setInterval(() => { for (const k of attempts.keys()) prune(k); }, 10 * 60 * 1000).unref();

/** 中间件：已锁定则 429，否则放行 */
function loginGuard(req, res, next) {
  const key = keyOf(req);
  prune(key);
  const rec = attempts.get(key);
  if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
    const waitMin = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    console.log('[RATE-LIMIT] 登录锁定 ip=' + clientIp(req) + ' path=' + req.path + ' 剩余=' + waitMin + '分钟');
    return res.status(429).json({
      success: false,
      // 与全局 fail() 约定一致用 error 字段，前端 api 层统一读 data.error 展示真实锁定提示
      error: '失败次数过多，已锁定，请 ' + waitMin + ' 分钟后再试',
      code: 429,
    });
  }
  next();
}

/** 登录失败记录：返回剩余可试次数；达到阈值则锁定 */
function recordLoginFail(req, accountHint) {
  const key = keyOf(req);
  prune(key);
  const rec = attempts.get(key) || { fails: [], lockedUntil: 0 };
  rec.fails.push(Date.now());
  if (rec.fails.length >= MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.fails = [];
    console.log('[RATE-LIMIT] 触发锁定 ip=' + clientIp(req) + ' path=' + req.path + ' account=' + (accountHint || '?'));
  }
  attempts.set(key, rec);
  return MAX_FAILS - rec.fails.length;
}

/** 登录成功清零 */
function clearLoginFail(req) {
  attempts.delete(keyOf(req));
}

module.exports = { loginGuard, recordLoginFail, clearLoginFail };
