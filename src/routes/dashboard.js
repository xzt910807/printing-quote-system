const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requirePermission } = require('../config/permissions');

/**
 * GET /api/dashboard/stats
 * 管理端数据看板统计（该路由整体由挂载层统一 requireAdmin 鉴权）
 * 返回：基础计数 / 订单金额 / 订单状态分布 / 近 7 天趋势
 */
router.get('/stats', requirePermission('dashboard:view'), async (req, res) => {
  try {
    // 工厂总数只统计在用（status=1），停用厂不进看板
    const [[{ factoryTotal }]] = await pool.query('SELECT COUNT(*) AS factoryTotal FROM factory WHERE status = 1');
    const [[{ quoteTotal }]] = await pool.query('SELECT COUNT(*) AS quoteTotal FROM quote_order');
    const [[{ inquiryTotal }]] = await pool.query('SELECT COUNT(*) AS inquiryTotal FROM c_inquiry');
    const [[{ orderTotal }]] = await pool.query('SELECT COUNT(*) AS orderTotal FROM order_main');

    // 订单金额：总金额不含已取消订单；已支付金额按 pay_status 统计
    const [[amounts]] = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total_price END), 0) AS orderAmountTotal,
              COALESCE(SUM(CASE WHEN pay_status = 'paid' AND status <> 'cancelled' THEN total_price END), 0) AS orderAmountPaid
       FROM order_main`
    );

    // 订单状态分布（补齐 6 个状态，缺省 0）
    const [statusRows] = await pool.query(
      'SELECT status, COUNT(*) AS c FROM order_main GROUP BY status'
    );
    const orderStatus = { pending: 0, confirmed: 0, producing: 0, shipped: 0, completed: 0, cancelled: 0 };
    statusRows.forEach((r) => { orderStatus[r.status] = r.c; });

    // 近 7 天趋势（询价 / 订单，含今天，缺省补 0）
    const [inqTrend] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
       FROM c_inquiry WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY d`
    );
    const [ordTrend] = await pool.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, COUNT(*) AS c
       FROM order_main WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY d`
    );
    const inqMap = {};
    inqTrend.forEach((r) => { inqMap[r.d] = r.c; });
    const ordMap = {};
    ordTrend.forEach((r) => { ordMap[r.d] = r.c; });

    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const pad = (n) => String(n).padStart(2, '0');
      const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      trend.push({ date: key, inquiries: inqMap[key] || 0, orders: ordMap[key] || 0 });
    }

    res.json(ok({
      factoryTotal,
      quoteTotal,
      inquiryTotal,
      orderTotal,
      orderAmountTotal: Number(amounts.orderAmountTotal),
      orderAmountPaid: Number(amounts.orderAmountPaid),
      orderStatus,
      trend,
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json(fail(err.message, 500));
  }
});

module.exports = router;
