/**
 * 行业资讯路由
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');

// GET /api/c/news?page=&category=&size= — 分页列表
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(parseInt(req.query.size, 10) || 10, 50);
    const category = String(req.query.category || '').trim();
    const offset = (page - 1) * size;

    let where = '';
    const params = [];
    if (category && ['policy', 'market', 'tech', 'material'].includes(category)) {
      where = 'WHERE category = ?'; params.push(category);
    }

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM industry_news ${where}`, params);
    const [rows] = await pool.query(
      `SELECT id, title, summary, source_name, source_url, cover_image, category, published_at, created_at
       FROM industry_news ${where} ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]);

    res.json(ok({ list: rows, total, page, size }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /api/c/news/:id — 详情
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[news]] = await pool.query('SELECT * FROM industry_news WHERE id = ?', [id]);
    if (!news) return res.status(404).json(fail('资讯不存在'));
    res.json(ok(news));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;
