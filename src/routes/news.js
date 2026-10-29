/**
 * 行业资讯路由
 * 消费 031 featured/editor_note 与 032 user_news_subscription
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireUser } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');

const CATEGORIES = ['policy', 'market', 'tech', 'material'];

// GET /api/c/news?page=&category=&size=&featured= — 分页列表
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(parseInt(req.query.size, 10) || 10, 50);
    const category = String(req.query.category || '').trim();
    const featuredOnly = req.query.featured === '1';
    const offset = (page - 1) * size;

    const where = [];
    const params = [];
    if (category && CATEGORIES.includes(category)) { where.push('category = ?'); params.push(category); }
    if (featuredOnly) { where.push('featured = 1'); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM industry_news ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT id, title, summary, source_name, source_url, cover_image, category,
              featured, editor_note, keywords, published_at, created_at
       FROM industry_news ${whereSql} ORDER BY featured DESC, published_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]);

    res.json(ok({ list: rows, total, page, size }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /api/c/news/featured — 精选资讯（首页 banner 用，最新 5 条）
router.get('/featured', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, summary, cover_image, source_name, category, editor_note, published_at
       FROM industry_news WHERE featured = 1 ORDER BY published_at DESC LIMIT 5`);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /api/c/news/subscriptions — 我的订阅分类
router.get('/subscriptions', requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await pool.query(
      'SELECT category, enabled FROM user_news_subscription WHERE user_id = ?', [userId]);
    const map = {};
    for (const r of rows) map[r.category] = !!r.enabled;
    res.json(ok({ subscribed: CATEGORIES.filter((c) => map[c]), all: CATEGORIES.map((c) => ({ category: c, enabled: !!map[c] })) }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// POST /api/c/news/subscribe { category } — 订阅
router.post('/subscribe', requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const category = String(req.body.category || '').trim();
    if (!CATEGORIES.includes(category)) throw new Error('分类非法');
    await pool.query(
      `INSERT INTO user_news_subscription (user_id, category, enabled) VALUES (?,?,1)
       ON DUPLICATE KEY UPDATE enabled = 1`,
      [userId, category]
    );
    res.json(ok({ subscribed: true, category }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// DELETE /api/c/news/subscribe/:category — 取消订阅
router.delete('/subscribe/:category', requireUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const category = String(req.params.category || '').trim();
    if (!CATEGORIES.includes(category)) throw new Error('分类非法');
    const [ret] = await pool.query(
      'UPDATE user_news_subscription SET enabled = 0 WHERE user_id = ? AND category = ?',
      [userId, category]
    );
    res.json(ok({ unsubscribed: ret.affectedRows > 0, category }));
  } catch (err) { res.status(400).json(fail(err.message)); }
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

// ===== 管理端子路由：adminRouter =====
// 挂在 requireAdmin 之后, 再按权限点收口（只给 super/admin, 菜单可见性与接口一致）
const adminRouter = express.Router();
adminRouter.use(requirePermission('news:manage'));

/**
 * GET /api/admin/news?page=&size=&category=&featured=&keyword=
 * 后台资讯列表：C 端列表给的是消费者可见字段, 运营选稿还需要抓取时间/编辑痕迹/原文地址,
 * 因此单独出一条管理端查询（按 id 倒序=最新抓取优先）
 */
adminRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(parseInt(req.query.size, 10) || 20, 100);
    const category = String(req.query.category || '').trim();
    const featuredOnly = req.query.featured === '1';
    const keyword = String(req.query.keyword || '').trim();
    const offset = (page - 1) * size;

    const where = [];
    const params = [];
    if (category && CATEGORIES.includes(category)) { where.push('n.category = ?'); params.push(category); }
    if (featuredOnly) where.push('n.featured = 1');
    if (keyword) {
      // 标题/摘要/来源三个维度模糊匹配, 运营据此找回某篇已抓取的报道
      where.push('(n.title LIKE ? OR n.summary LIKE ? OR n.source_name LIKE ?)');
      const like = `%${keyword}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM industry_news n ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT n.id, n.title, n.summary, n.source_name, n.source_url, n.cover_image, n.category,
              n.featured, n.editor_note, n.keywords, n.published_at, n.created_at,
              a.nickname AS editor_name
       FROM industry_news n LEFT JOIN admin_user a ON n.editor_id = a.id
       ${whereSql} ORDER BY n.id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]);

    res.json(ok({ list: rows, total, page, size }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

/** PUT /api/admin/news/:id/feature  { featured:0|1, editorNote?, keywords? } */
adminRouter.put('/:id/feature', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new Error('参数错误');
    const featured = req.body.featured ? 1 : 0;
    const editorNote = String(req.body.editorNote || '').slice(0, 300);
    const keywords = String(req.body.keywords || '').slice(0, 200);
    const editorId = (req.admin && req.admin.id) || null;
    const [[exist]] = await pool.query('SELECT id FROM industry_news WHERE id = ?', [id]);
    if (!exist) throw new Error('资讯不存在');
    await pool.query(
      'UPDATE industry_news SET featured = ?, editor_note = ?, keywords = ?, editor_id = ? WHERE id = ?',
      [featured, editorNote || null, keywords || null, editorId, id]
    );
    res.json(ok({ updated: true }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;
module.exports.adminRouter = adminRouter;
