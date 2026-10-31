function round(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return 0;
  const factor = 10 ** d;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

const { pool } = require('../config/db');

function generateQuoteNo(prefix = 'Q') {
  const d = new Date();
  const ymd = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return prefix + ymd + rand;
}

/**
 * 业务单号（CQ/OD）：前缀 + 8位年月日 + 4位当日递增序号（CQ202609250001，无分隔符）。
 * 递增位 4 位：单日上限 9999 张，百万级总量按日分段仍有 18 倍余量（日均 550 单）；
 * 固定宽度保证字符串排序与时间序一致。biz_seq 按「前缀:日期」分段取号
 * （LAST_INSERT_ID 技巧），每日 0001 起重新计数；取号与读号必须在同一连接
 * （池连接复用会串 LAST_INSERT_ID），故独占连接。
 * 注意：VALUES 里也必须套 LAST_INSERT_ID(1)——首次 INSERT 分支不触发
 * UPDATE 子句的 LAST_INSERT_ID(expr)，否则首号会读到连接上残留的上一个自增值。
 */
async function nextBizNo(prefix) {
  const d = new Date();
  const ymd = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const conn = await pool.getConnection();
  try {
    await conn.query(
      `INSERT INTO biz_seq (name, value) VALUES (?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`,
      ['bizno:' + prefix + ':' + ymd]
    );
    const [[row]] = await conn.query('SELECT LAST_INSERT_ID() AS v');
    return prefix + ymd + String(row.v).padStart(4, '0');
  } finally {
    conn.release();
  }
}

function ok(data, extra = {}) {
  return { success: true, data, ...extra };
}

function fail(message, code = 400) {
  return { success: false, error: message, code };
}

function safeParse(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return null; }
}

/**
 * 安全解析 JSON 字段
 * mysql2 对 JSON 类型字段可能返回字符串，也可能返回已解析的对象
 * 统一在这里处理，避免各处重复写类型判断
 */
function parseJsonField(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  // 已经是对象/数组，直接返回
  return value;
}

/**
 * 格式化时间为北京时间 "2026-09-19 14:11:51"
 */
function formatTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds())
  );
}

/**
 * 号码脱敏（F-30）：先归一成纯数字再判断，不要求调用方保证格式统一。
 *   11 位手机（含 +86 / 空格 / 横杠分隔）→ 137****5678
 *   固话（区号+号码，≥9 位）→ 0577****8225（保留区号，客户仍能认出是哪里的厂）
 *   7~8 位短号 → 前 2 后 2；更短或含不了数字的（「见微信」之类）原样返回
 * 旧实现用 /^\d{7,}$/ 判固话，带区号横杠的「0577-64228225」一条都不匹配、
 * 被原样返回——线上工厂电话大多是这个格式，等于对固话完全不脱敏。
 */
function maskPhone(phone) {
  if (phone === null || phone === undefined) return phone;
  const s = String(phone).trim();
  if (!s) return s;
  let digits = s.replace(/\D/g, '');
  if (!digits) return s;
  // +86 开头（13 位）按手机处理前先剥掉国家码，否则会掉进固话分支出 8613****8000 这种怪串
  if (digits.length === 13 && digits.indexOf('86') === 0) digits = digits.slice(2);
  if (/^1\d{10}$/.test(digits)) return digits.slice(0, 3) + '****' + digits.slice(7);
  if (digits.length >= 9) return digits.slice(0, 4) + '****' + digits.slice(-4);
  if (digits.length >= 7) return digits.slice(0, 2) + '****' + digits.slice(-2);
  return s;
}

/**
 * 生成 CSV 文本（带 BOM，Excel 打开中文不乱码）
 * @param {Array<{key:string,label:string}>} columns 列定义
 * @param {Array<Object>} rows 数据行
 */
function toCsv(columns, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(',')];
  for (const r of rows) {
    lines.push(columns.map((c) => esc(r[c.key])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * 发送 CSV 下载响应
 */
function sendCsv(res, filename, csvText) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=' + encodeURIComponent(filename));
  res.send(csvText);
}

/**
 * 产能状态归一化（融合印查查「闲置产能」）：
 * 工厂填报的产能超 CAPACITY_TTL_HOURS（默认 72h）未更新视为过期，展示降为「未填报」且不加权，
 * 避免陈旧「空闲」标签误导撮合。返回排序权重（idle=2 normal=1 其余 0）供撮合/找厂优先推空闲厂。
 * @param {Object} row 含 capacity_status / capacity_updated_at 的工厂行
 * @returns {{status:string,label:string,fresh:boolean,weight:number,note:string|null}}
 */
const CAPACITY_TTL_HOURS = parseInt(process.env.CAPACITY_TTL_HOURS, 10) || 72;
const CAPACITY_LABELS = { idle: '产能空闲', normal: '生产正常', busy: '排单饱和', unknown: '' };

function capacityOf(row) {
  const raw = row && row.capacity_status;
  const note = (row && row.capacity_note) || null;
  const valid = ['idle', 'normal', 'busy'].includes(raw);
  let fresh = false;
  if (valid) {
    const ts = row.capacity_updated_at;
    fresh = !ts || (Date.now() - new Date(ts).getTime()) <= CAPACITY_TTL_HOURS * 3600000;
  }
  const status = valid && fresh ? raw : 'unknown';
  const weight = status === 'idle' ? 2 : status === 'normal' ? 1 : 0;
  return { status, label: CAPACITY_LABELS[status], fresh, weight, note };
}

module.exports = { round, generateQuoteNo, nextBizNo, ok, fail, safeParse, parseJsonField, formatTime, maskPhone, toCsv, sendCsv, capacityOf };