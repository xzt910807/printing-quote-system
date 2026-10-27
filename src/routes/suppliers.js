/**
 * 供应商管理（历史合作沉淀）
 * 聚合查询已成交订单，按工厂维度统计
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');

// GET /api/c/user/suppliers — 我的供应商列表
router.get('/suppliers', async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT f.id, f.name, f.logo_url, f.rating, f.address, f.province, f.city,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_price + o.shipping_fee), 0) AS total_amount,
              MAX(o.created_at) AS last_order_at,
              AVG(o.rating) AS avg_rating
       FROM order_main o
       JOIN factory f ON f.id = o.factory_id
       WHERE o.user_id = ? AND o.status = 'completed'
       GROUP BY f.id ORDER BY order_count DESC, total_amount DESC LIMIT 50`,
      [userId]
    );
    res.json(ok({ list: rows }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /api/c/user/suppliers/:factoryId — 单供应商合作详情
router.get('/suppliers/:factoryId', async (req, res) => {
  try {
    const userId = req.user.id;
    const factoryId = parseInt(req.params.factoryId, 10);
    if (!factoryId) throw new Error('参数错误');

    const [[summary]] = await pool.query(
      `SELECT COUNT(*) order_count, COALESCE(SUM(total_price + shipping_fee), 0) total_amount,
              MAX(created_at) last_order_at, AVG(rating) avg_rating
       FROM order_main WHERE user_id = ? AND factory_id = ? AND status = 'completed'`,
      [userId, factoryId]
    );

    const [orders] = await pool.query(
      `SELECT id, order_no, total_price, status, rating, created_at
       FROM order_main WHERE user_id = ? AND factory_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [userId, factoryId]
    );

    res.json(ok({ summary, orders }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;
