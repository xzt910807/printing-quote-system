/**
 * 工厂经营报表（B端数据面板）
 * 鉴权：requireFactory，仅看本厂数据
 *
 * 端点：
 *   GET /summary?start=&end=       区间概览（默认本月）
 *   GET /compare?start=&end=       同环比：本区间 vs 上一周期 vs 去年同期
 *   GET /trend?months=6            近 N 月接单量/金额折线
 *   GET /top-products?start=&end=  品类分布（含金额）
 *   GET /export.csv?start=&end=    订单流水 CSV 导出（UTF-8 BOM，Excel 兼容）
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireFactory } = require('../middlewares/auth');
const catalog = require('../services/catalogService');

router.use(requireFactory);

// CSV 导出用的状态中文映射（导出文件给老板/财务看, 不能露 pending/frozen 这类英文码）
const ORDER_STATUS_TEXT = {
  pending: '待确认', confirmed: '已确认', sampling: '打样中', sample_confirmed: '样品已确认',
  producing: '生产中', shipped: '已发货', completed: '已完成', cancelled: '已取消',
};
const ESCROW_STATUS_TEXT = {
  none: '无担保', frozen: '资金冻结中', released: '已放款', partial_refund: '部分退款', refunded: '已退款',
};

/**
 * 解析日期区间参数：默认本月首日 00:00 到今天 23:59:59
 * 支持 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS；非法值回落默认。
 */
function resolveRange(q) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const parse = (s, fallback) => {
    if (!s) return fallback;
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d.getTime()) ? fallback : d;
  };
  const start = parse(q.start, monthStart);
  const end = parse(q.end, todayEnd);
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  return { startD: start, endD: end, start: fmt(start), end: fmt(end) };
}

/** 计算上一周期与去年同期区间 */
function deriveCompareRanges({ startD, endD }) {
  const span = endD.getTime() - startD.getTime();
  // 上一周期：紧邻当前区间之前，长度相同
  const prevEnd = new Date(startD.getTime() - 1000);
  const prevStart = new Date(prevEnd.getTime() - span);
  // 去年同期：整体 -365 天（闰年偏差可接受）
  const YEAR = 365 * 24 * 3600 * 1000;
  const yoyEnd = new Date(endD.getTime() - YEAR);
  const yoyStart = new Date(startD.getTime() - YEAR);
  const fmt = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  return {
    prev: { start: fmt(prevStart), end: fmt(prevEnd) },
    yoy: { start: fmt(yoyStart), end: fmt(yoyEnd) },
  };
}

async function aggregateRange(fid, start, end) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) cnt, COALESCE(SUM(total_price + shipping_fee + sample_fee), 0) amt
     FROM order_main
     WHERE factory_id = ? AND status != 'cancelled' AND created_at BETWEEN ? AND ?`,
    [fid, start, end]
  );
  return { orders: Number(row.cnt) || 0, revenue: Number(row.amt) || 0 };
}

// GET /summary — 区间概览（默认本月）
router.get('/summary', async (req, res) => {
  try {
    const fid = req.factory.id;
    const range = resolveRange(req.query);

    const agg = await aggregateRange(fid, range.start, range.end);

    const [[pending]] = await pool.query(
      `SELECT COUNT(*) cnt FROM order_main WHERE factory_id = ? AND status IN ('pending','confirmed','producing')`, [fid]);
    const [[inq]] = await pool.query(
      `SELECT COUNT(*) cnt FROM factory_inquiry_push WHERE factory_id = ? AND created_at BETWEEN ? AND ?`, [fid, range.start, range.end]);
    const [[issues]] = await pool.query(
      `SELECT COUNT(*) cnt FROM issue_ticket WHERE factory_id = ? AND status IN ('open','processing')`, [fid]);
    const [[fac]] = await pool.query(
      'SELECT rating, rating_count, avg_response_hours, total_pushes, total_accepts, verification_level FROM factory WHERE id = ?', [fid]);

    res.json(ok({
      range: { start: range.start, end: range.end },
      monthlyOrders: agg.orders,
      monthlyRevenue: agg.revenue,
      pendingOrders: pending.cnt,
      inquiryReceived: inq.cnt,
      activeIssues: issues.cnt,
      rating: Number(fac.rating) || 0,
      ratingCount: Number(fac.rating_count) || 0,
      avgResponseHours: Number(fac.avg_response_hours) || 0,
      totalPushes: Number(fac.total_pushes) || 0,
      totalAccepts: Number(fac.total_accepts) || 0,
      verificationLevel: Number(fac.verification_level) || 0,
    }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /compare — 同环比：本区间 vs 上一周期 vs 去年同期
router.get('/compare', async (req, res) => {
  try {
    const fid = req.factory.id;
    const cur = resolveRange(req.query);
    const cmp = deriveCompareRanges(cur);

    const [current, prev, yoy] = await Promise.all([
      aggregateRange(fid, cur.start, cur.end),
      aggregateRange(fid, cmp.prev.start, cmp.prev.end),
      aggregateRange(fid, cmp.yoy.start, cmp.yoy.end),
    ]);

    const rate = (a, b) => {
      if (!b) return null;
      return Math.round(((a - b) / b) * 10000) / 100; // 百分数，保留 2 位
    };

    res.json(ok({
      current: { ...cur, range: { start: cur.start, end: cur.end }, ...current },
      prevPeriod: { ...cmp.prev, ...prev },
      yoyPeriod: { ...cmp.yoy, ...yoy },
      momOrders: rate(current.orders, prev.orders),   // 环比订单量
      momRevenue: rate(current.revenue, prev.revenue), // 环比金额
      yoyOrders: rate(current.orders, yoy.orders),    // 同比订单量
      yoyRevenue: rate(current.revenue, yoy.revenue),  // 同比金额
    }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /trend?months=6 — 近N月接单量/金额折线
router.get('/trend', async (req, res) => {
  try {
    const fid = req.factory.id;
    const months = Math.min(parseInt(req.query.months, 10) || 6, 12);
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') ym, COUNT(*) cnt, COALESCE(SUM(total_price), 0) amt
       FROM order_main
       WHERE factory_id = ? AND status != 'cancelled'
         AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
       GROUP BY ym ORDER BY ym`, [fid, months]);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /top-products — 品类分布（含金额）
// name 由后端按 product_config 目录解析成中文品名下发, 前端直接展示（避免露 cardBox 等英文码）
router.get('/top-products', async (req, res) => {
  try {
    const fid = req.factory.id;
    const range = resolveRange(req.query);
    const [rows] = await pool.query(
      `SELECT product_type, COUNT(*) cnt, COALESCE(SUM(total_price + shipping_fee + sample_fee), 0) amt
       FROM order_main
       WHERE factory_id = ? AND status != 'cancelled' AND product_type IS NOT NULL
         AND created_at BETWEEN ? AND ?
       GROUP BY product_type ORDER BY cnt DESC LIMIT 10`, [fid, range.start, range.end]);
    res.json(ok({
      list: rows.map((r) => Object.assign({}, r, { name: catalog.productTypeName(r.product_type) })),
      range: { start: range.start, end: range.end },
    }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /export.csv — 订单流水 CSV
router.get('/export.csv', async (req, res) => {
  try {
    const fid = req.factory.id;
    const range = resolveRange(req.query);
    const [rows] = await pool.query(
      `SELECT order_no, product_type, status, escrow_status, total_price, shipping_fee, sample_fee,
              rating, created_at, shipped_at, completed_at
       FROM order_main
       WHERE factory_id = ? AND created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT 5000`,
      [fid, range.start, range.end]
    );
    const header = ['订单号', '品类', '状态', '担保状态', '商品价格', '运费', '样品费', '评分', '下单时间', '发货时间', '完成时间'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const cells = [
        r.order_no, catalog.productTypeName(r.product_type) || '',
        ORDER_STATUS_TEXT[r.status] || r.status || '',
        ESCROW_STATUS_TEXT[r.escrow_status || 'none'] || r.escrow_status || '',
        Number(r.total_price || 0).toFixed(2), Number(r.shipping_fee || 0).toFixed(2), Number(r.sample_fee || 0).toFixed(2),
        r.rating == null ? '' : Number(r.rating).toFixed(1),
        fmtCell(r.created_at), fmtCell(r.shipped_at), fmtCell(r.completed_at),
      ].map(csvEscape);
      lines.push(cells.join(','));
    }
    // BOM for Excel UTF-8
    const csv = '\uFEFF' + lines.join('\r\n');
    const filename = `factory_${fid}_orders_${range.start.slice(0, 10)}_${range.end.slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { res.status(500).json(fail(err.message)); }
});

function fmtCell(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = router;
// 内部 helper 对外暴露给单测（不造成写入面 API 污染）
module.exports._helpers = { resolveRange, deriveCompareRanges, csvEscape };
