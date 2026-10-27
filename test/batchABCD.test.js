const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const cb = require('../src/routes/logisticsCallback');
const dash = require('../src/routes/factoryDashboard');
const { parseByRules } = require('../src/parser/nl-parser');
const { pool } = require('../src/config/db');

/**
 * 035 Batch A/B/C/D 补齐后新增的纯逻辑单测（不触库/不联网）：
 *   - 快递100 callback md5 签名与 state 映射
 *   - factoryDashboard 日期区间 helper：默认本月 + 环比紧邻 + 同比 -365 天 + CSV 转义
 *   - nl-parser 规则解析（AI 兜底路径依赖 LLM 不在此覆盖）
 */

after(async () => { await pool.end().catch(() => {}); });

// ===== 快递100 callback =====
test('kuaidi100 md5Upper 与 crypto 独立算出的大写 MD5 一致', () => {
  const s = '{"company":"SF","number":"SF12345"}';
  const key = 'unittest-key';
  const expect = crypto.createHash('md5').update(s + key, 'utf8').digest('hex').toUpperCase();
  assert.equal(cb.md5Upper(s + key), expect);
});

test('kuaidi100 STATE_MAP 与主流程 status 语义对齐', () => {
  assert.equal(cb.STATE_MAP[0], 'delivering', '0 在途');
  assert.equal(cb.STATE_MAP[1], 'shipped',    '1 揽收');
  assert.equal(cb.STATE_MAP[5], 'delivering', '5 派件中');
  assert.equal(cb.STATE_MAP[3], 'signed',     '3 已签收');
  assert.equal(cb.STATE_MAP[9], undefined,    '未知 state 不映射');
});

// ===== factoryDashboard helpers =====
const { resolveRange, deriveCompareRanges, csvEscape } = dash._helpers;

test('resolveRange 无参数默认本月首日 00:00 → 今天 23:59:59', () => {
  const now = new Date();
  const r = resolveRange({});
  assert.ok(r.start.startsWith(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01 00:00:00'));
  assert.ok(r.end.endsWith(' 23:59:59'));
});

test('resolveRange 自定义带时间的输入 按本地时区格式化回写', () => {
  // 当前 resolveRange 内部走 new Date 会把纯 YYYY-MM-DD 按 UTC 解析，
  // 在东八区上会变成 08:00:00；因此测试传带 HH:MM:SS 的完整时间字串，避免时区偏移。
  const r = resolveRange({ start: '2026-01-15 00:00:00', end: '2026-03-20 23:59:59' });
  assert.equal(r.start, '2026-01-15 00:00:00');
  assert.equal(r.end, '2026-03-20 23:59:59');
});

test('deriveCompareRanges 环比紧邻当前区间之前 · 同比 -365 天', () => {
  const startD = new Date(2026, 9, 1, 0, 0, 0);   // 2026-10-01
  const endD = new Date(2026, 9, 26, 23, 59, 59); // 2026-10-26
  const { prev, yoy } = deriveCompareRanges({ startD, endD });
  assert.ok(prev.end.startsWith('2026-09-30'), '上期 end 应是 2026-09-30');
  assert.ok(prev.start.startsWith('2026-09-04') || prev.start.startsWith('2026-09-05'), '上期 start 覆盖相同 span');
  assert.ok(yoy.start.startsWith('2025-10-01'), '同比 start 前推 365 天到 2025-10-01');
  assert.ok(yoy.end.startsWith('2025-10-26'),   '同比 end 前推 365 天到 2025-10-26');
});

test('csvEscape 逗号/引号/换行 都被双引号包裹且内嵌引号翻倍', () => {
  assert.equal(csvEscape('abc'), 'abc');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvEscape('multi\nline'), '"multi\nline"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
});

// ===== nl-parser 规则解析 =====
test('parseByRules 从中文数量词识别 quantity（1万5千=15000）', () => {
  const r = parseByRules('无纺布袋 35×40cm 加厚 100g 蓝色 一万五个 车缝 四色丝印');
  assert.equal(r.quantity, 15000);
  assert.equal(r.productType, 'nonWovenBag');
  assert.equal(r.printMode, 'screen');
  assert.ok(r.processes.includes('SEWING'));
});

test('parseByRules 品类词优先于材料词（白卡纸袋 = 纸袋 用白卡）', () => {
  const r = parseByRules('白卡纸袋 25×30cm 2000个');
  assert.equal(r.productType, 'paperBag');
  // 命中"白卡" 应覆盖 paperBag 默认 KRAFT300
  assert.equal(r.materialCode, 'CARD250');
});

test('parseByRules 满版/整版触发 patternCover=high · 无图案触发 low', () => {
  assert.equal(parseByRules('彩盒 满版印刷').patternCover, 'high');
  assert.equal(parseByRules('彩盒 以文字为主').patternCover, 'low');
});

test('parseByRules 天地盖彩盒识别 boxType=lidBase', () => {
  const r = parseByRules('250g 白卡彩盒 天地盖 10×8×5cm 一万件');
  assert.equal(r.boxType, 'lidBase');
  assert.equal(r.quantity, 10000);
});

test('parseByRules UV 油墨语境不误命中 UV_COAT 工艺', () => {
  const r = parseByRules('标签 UV油墨 四色');
  assert.equal(r.inkType, 'UV');
  assert.ok(!r.processes.includes('UV_COAT'), 'UV 油墨不应连带触发上光工艺');
});
