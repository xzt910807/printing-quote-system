/**
 * 社区后台路由（Batch D4）：挂 /api/admin/community
 * 鉴权链：app.js 那一层先 requireAdmin，本文件每个接口再各自校权限点
 *   读（帖子/评论/举报列表）  → community:view
 *   写（审核/加精/置顶/处置/分类） → community:manage
 * 两个点都不写进 FACTORY_ALL：工厂令牌打这里一律 401（requireAdmin 只认 X-Admin-Token），
 * 工厂在后台看不到审核队列，更不能自己审自己。
 */
const express = require('express');
const { ok, fail } = require('../utils/helpers');
const community = require('../services/communityService');
const { requirePermission } = require('../config/permissions');

const router = express.Router();

// GET /stats — 面板顶部四个筛选态后面的数字
router.get('/stats', requirePermission('community:view'), async (req, res) => {
  try { res.json(ok(await community.adminStats())); }
  catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /posts — 后台帖子列表：可按状态/版块/关键词筛，能看到 pending 与已下架的
router.get('/posts', requirePermission('community:view'), async (req, res) => {
  try {
    const r = await community.listPosts({
      scope: 'admin',
      status: String(req.query.status || '').trim(),
      category: String(req.query.category || '').trim(),
      keyword: String(req.query.keyword || '').trim(),
      sort: req.query.sort === 'new' ? 'new' : 'hot',
      page: req.query.page,
      size: req.query.size,
    });
    res.json(ok(r));
  } catch (err) { res.status(err.status || 500).json(fail(err.message)); }
});

// GET /post/:id — 单帖详情 + 全部评论（含待审与已删，后台审核要看全）
router.get('/post/:id', requirePermission('community:view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const [post, comments] = await Promise.all([
      community.getPostById(id),
      community.listComments(id, { adminAll: true }),
    ]);
    res.json(ok({ post, comments }));
  } catch (err) { res.status(err.status || 500).json(fail(err.message, err.status || 500)); }
});

/**
 * PUT /post/:id/audit — {action: approve|reject|remove|top|essence, note}
 * 驳回/下架必须带原因（会写进 audit_note 给作者看），top/essence 是开关式运营位
 */
router.put('/post/:id/audit', requirePermission('community:manage'), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(ok(await community.audit({
      targetType: 'post',
      targetId: req.params.id,
      action: b.action,
      note: b.note,
      adminId: req.admin && req.admin.id,
    })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// PUT /comment/:id/audit — 评论审核（与帖子同一套动作，去掉了 top/essence 的意义）
router.put('/comment/:id/audit', requirePermission('community:manage'), async (req, res) => {
  try {
    const b = req.body || {};
    const action = String(b.action || '');
    if (action === 'top' || action === 'essence') return res.status(400).json(fail('评论不支持该操作'));
    res.json(ok(await community.audit({
      targetType: 'comment',
      targetId: req.params.id,
      action,
      note: b.note,
      adminId: req.admin && req.admin.id,
    })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// GET /comments — 默认只看待审评论（机审命中与客户内容的抽查队列）
router.get('/comments', requirePermission('community:view'), async (req, res) => {
  try {
    res.json(ok(await community.adminListComments({
      status: String(req.query.status || 'pending').trim(),
      page: req.query.page,
      size: req.query.size,
    })));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /reports — 默认只看待处置举报
router.get('/reports', requirePermission('community:view'), async (req, res) => {
  try {
    res.json(ok(await community.adminListReports({
      status: String(req.query.status || 'pending').trim(),
      page: req.query.page,
      size: req.query.size,
    })));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

/**
 * PUT /report/:id/handle — {action: reject(举报成立，下架目标) | dismiss(不成立), note}
 * 同人重复举报已经在唯一键那层挡住，这里不需要再防"一个目标被刷爆"
 */
router.put('/report/:id/handle', requirePermission('community:manage'), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(ok(await community.handleReport({
      reportId: req.params.id,
      action: b.action,
      note: b.note,
      adminId: req.admin && req.admin.id,
    })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// ========== 版块分类维护 ==========

// GET /categories — 含停用项（后台要能看到并把它们重新启用）
router.get('/categories', requirePermission('community:view'), async (req, res) => {
  try { res.json(ok({ list: await community.listCategories({ includeInactive: true }) })); }
  catch (err) { res.status(500).json(fail(err.message)); }
});

// POST /category — 新增或按 code 更新（编码是关联键，重复提交视为改名称/排序）
router.post('/category', requirePermission('community:manage'), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(ok(await community.upsertCategory({ code: b.code, name: b.name, sort: b.sort, isActive: b.isActive })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// PUT /category/:id — 启停（不做物理删除：老帖还挂着这个 code）
router.put('/category/:id', requirePermission('community:manage'), async (req, res) => {
  try {
    res.json(ok(await community.toggleCategory(parseInt(req.params.id, 10) || 0, (req.body || {}).isActive)));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

module.exports = router;
