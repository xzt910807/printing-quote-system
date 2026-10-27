/**
 * 工厂经营报表（B端数据面板）
 * 鉴权：requireFactory，仅看本厂数据
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireFactory } = require('../middlewares/auth');

router.use(requireFactory);

// GET /summary — 本月统计概览
router.get('/summary', async (req, res) => {
  try {
    const fid = req.factory.id;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const ms = monthStart.toISOString().slice(0, 19).replace('T', ' ');

    const [[orders]] = await pool.query(
      `SELECT COUNT(*) cnt, COALESCE(SUM(total_price + shipping_fee + sample_fee), 0) amt
       FROM order_main WHERE factory_id = ? AND status != 'cancelled' AND created_at >= ?`, [fid, ms]);
    const [[pending]] = await pool.query(
      `SELECT COUNT(*) cnt FROM order_main WHERE factory_id = ? AND status IN ('pending','confirmed','producing')`, [fid]);
    const [[inq]] = await pool.query(
      `SELECT COUNT(*) cnt FROM factory_inquiry_push WHERE factory_id = ? AND created_at >= ?`, [fid, ms]);
    const [[issues]] = await pool.query(
      `SELECT COUNT(*) cnt FROM issue_ticket WHERE factory_id = ? AND status IN ('open','processing')`, [fid]);

    // 工厂自身字段
    const [[fac]] = await pool.query(
      'SELECT rating, rating_count, avg_response_hours, total_pushes, total_accepts FROM factory WHERE id = ?', [fid]);

    res.json(ok({
      monthlyOrders: orders.cnt,
      monthlyRevenue: Number(orders.amt) || 0,
      pendingOrders: pending.cnt,
      inquiryReceived: inq.cnt,
      activeIssues: issues.cnt,
      rating: Number(fac.rating) || 0,
      ratingCount: Number(fac.rating_count) || 0,
      avgResponseHours: Number(fac.avg_response_hours) || 0,
      totalPushes: Number(fac.total_pushes) || 0,
      totalAccepts: Number(fac.total_accepts) || 0,
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

// GET /top-products — 品类分布
router.get('/top-products', async (req, res) => {
  try {
    const fid = req.factory.id;
    const [rows] = await pool.query(
      `SELECT product_type, COUNT(*) cnt FROM order_main
       WHERE factory_id = ? AND status != 'cancelled' AND product_type IS NOT NULL
       GROUP BY product_type ORDER BY cnt DESC LIMIT 10`, [fid]);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

module.exports = router;
