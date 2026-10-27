/**
 * 供应商管理（历史合作沉淀 + 手动关注 + 备注标签）
 * 聚合查询已成交订单，按工厂维度统计；未成交但手动关注的工厂也可展示。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');

/** 现有：历史合作供应商列表（合并手动关注，pinned 优先） */
router.get('/suppliers', async (req, res) => {
  try {
    const userId = req.user.id;
    // 历史合作
    const [history] = await pool.query(
      `SELECT f.id, f.name, f.logo_url, f.rating, f.address, f.province, f.city, f.verification_level,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(o.total_price + o.shipping_fee), 0) AS total_amount,
              MAX(o.created_at) AS last_order_at,
              AVG(o.rating) AS avg_rating
       FROM order_main o
       JOIN factory f ON f.id = o.factory_id
       WHERE o.user_id = ? AND o.status = 'completed'
       GROUP BY f.id`,
      [userId]
    );
    // 关注数据
    const [follows] = await pool.query(
      `SELECT factory_id, tags, note, pinned FROM supplier_follow WHERE user_id = ?`,
      [userId]
    );
    const followMap = {};
    for (const f of follows) followMap[f.factory_id] = f;

    // 手动关注但无历史合作的工厂也加入列表
    const followedOnly = follows.filter((f) => !history.find((h) => h.id === f.factory_id));
    if (followedOnly.length) {
      const ids = followedOnly.map((f) => f.factory_id);
      const [extra] = await pool.query(
        `SELECT id, name, logo_url, rating, address, province, city, verification_level
         FROM factory WHERE id IN (?)`, [ids]
      );
      for (const e of extra) {
        history.push({ ...e, order_count: 0, total_amount: 0, last_order_at: null, avg_rating: null });
      }
    }

    // 合并关注字段
    const list = history.map((h) => {
      const f = followMap[h.id] || {};
      return {
        ...h,
        followed: !!f,
        tags: f.tags || '',
        note: f.note || '',
        pinned: f.pinned ? 1 : 0,
      };
    });
    // 排序：置顶 → 合作次数 → 累计金额
    list.sort((a, b) => {
      if (b.pinned !== a.pinned) return b.pinned - a.pinned;
      if (b.order_count !== a.order_count) return b.order_count - a.order_count;
      return Number(b.total_amount) - Number(a.total_amount);
    });

    res.json(ok({ list: list.slice(0, 100) }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

/** 单供应商合作详情 */
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

    const [[follow]] = await pool.query(
      'SELECT tags, note, pinned FROM supplier_follow WHERE user_id = ? AND factory_id = ?',
      [userId, factoryId]
    );

    res.json(ok({ summary, orders, follow: follow || null }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/** 关注/更新关注（幂等 upsert） */
router.post('/suppliers/follow', async (req, res) => {
  try {
    const userId = req.user.id;
    const factoryId = parseInt(req.body.factoryId, 10);
    if (!factoryId) throw new Error('factoryId 必填');
    const [[fac]] = await pool.query('SELECT id FROM factory WHERE id = ?', [factoryId]);
    if (!fac) throw new Error('工厂不存在');

    const tags = String(req.body.tags || '').slice(0, 200);
    const note = String(req.body.note || '').slice(0, 300);
    const pinned = req.body.pinned ? 1 : 0;

    await pool.query(
      `INSERT INTO supplier_follow (user_id, factory_id, tags, note, pinned)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE tags = VALUES(tags), note = VALUES(note), pinned = VALUES(pinned)`,
      [userId, factoryId, tags, note, pinned]
    );
    res.json(ok({ followed: true }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/** 取消关注 */
router.delete('/suppliers/follow/:factoryId', async (req, res) => {
  try {
    const userId = req.user.id;
    const factoryId = parseInt(req.params.factoryId, 10);
    if (!factoryId) throw new Error('参数错误');
    const [ret] = await pool.query(
      'DELETE FROM supplier_follow WHERE user_id = ? AND factory_id = ?',
      [userId, factoryId]
    );
    res.json(ok({ removed: ret.affectedRows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/** 我的关注列表（独立视图） */
router.get('/suppliers-follows', async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      `SELECT sf.factory_id, sf.tags, sf.note, sf.pinned, sf.created_at,
              f.name, f.logo_url, f.province, f.city, f.rating, f.verification_level
       FROM supplier_follow sf
       JOIN factory f ON f.id = sf.factory_id
       WHERE sf.user_id = ?
       ORDER BY sf.pinned DESC, sf.created_at DESC LIMIT 100`,
      [userId]
    );
    res.json(ok({ list: rows }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

module.exports = router;
