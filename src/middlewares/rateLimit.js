/**
 * 登录防暴力破解限流（内存版）
 * 规则：同一 IP + 同一登录入口，5 分钟内失败 5 次 → 锁定 15 分钟；登录成功清零。
 * 单机部署足够；若日后多实例，需换 Redis 共享计数。
 * Batch D4 起本文件另带一个通用写限流 writeGuard（社区发帖/评论/举报）。
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

/* ===== Batch D4：通用写操作滑窗限流（社区发帖/评论/举报用）===== */

/** name → 提示语里的动作名（直说“什么太频繁”比“请求过多”更能让用户知道等多久、下次怎么改） */
const WRITE_LABELS = { post: '发帖', comment: '评论', report: '举报' };

const writeHits = new Map(); // `name|身份键` -> [ts, ...]（升序）

/**
 * 计数主体优先用身份（同人换 IP 不能刷），没有身份时退回 IP
 * 必须在鉴权中间件之后挂载，否则读不到 req.identity
 */
function actorKey(req) {
  if (req.identity) return req.identity.type + ':' + req.identity.userId;
  if (req.factoryUser) return 'factory:' + req.factoryUser.id;
  if (req.user) return 'user:' + req.user.id;
  if (req.admin) return 'admin:' + req.admin.id;
  return clientIp(req);
}

/**
 * @param {Object} opts { windowMs 窗口, max 窗口内最多几次, name 动作名（既做提示语也做计数隔离） }
 */
function writeGuard(opts = {}) {
  const windowMs = Number(opts.windowMs) || 60 * 60 * 1000;
  const max = Number(opts.max) || 20;
  const name = opts.name || 'write';
  return (req, res, next) => {
    const key = name + '|' + actorKey(req);
    const now = Date.now();
    const hits = (writeHits.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      writeHits.set(key, hits);
      const waitMin = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 60000));
      const label = WRITE_LABELS[name] || '该操作';
      console.log('[RATE-LIMIT] 写操作限流 name=' + name + ' key=' + key + ' 剩余=' + waitMin + '分钟');
      return res.status(429).json({
        success: false,
        error: label + '太频繁，请 ' + waitMin + ' 分钟后再试',
        code: 429,
      });
    }
    hits.push(now);
    writeHits.set(key, hits);
    next();
  };
}

function pruneWrites() {
  const now = Date.now();
  for (const [k, arr] of writeHits) {
    const left = arr.filter((t) => now - t < 2 * 60 * 60 * 1000); // 上限取到 2 小时，足够覆盖现有窗口
    if (left.length) writeHits.set(k, left); else writeHits.delete(k);
  }
}
setInterval(pruneWrites, 10 * 60 * 1000).unref();

module.exports = { loginGuard, recordLoginFail, clearLoginFail, writeGuard };
