const crypto = require('crypto');

/**
 * 密码哈希工具（node 内置 scrypt，无第三方依赖）
 * 存储格式：salt:hash（均为 hex 字符串）
 */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return salt + ':' + hash;
}

/**
 * 校验明文密码与存储的哈希是否一致（恒定时间比较，防时序攻击）
 */
function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  let test;
  try {
    test = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  } catch (e) {
    return false;
  }
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword };
