/**
 * 社区路由（Batch D4）：小程序端统一挂 /api/c/community
 *
 * 客户与工厂员工走同一批接口，身份由 resolveIdentity 从请求头推导（工厂头优先）：
 * 工厂在小程序里发帖不需要"切换身份"，带了 X-Factory-* 就自动按工厂身份落库。
 * author_type 绝不从 req.body 读，否则任何人都能伪装成工厂绕过先发后审。
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const community = require('../services/communityService');
const { resolveIdentity, requireIdentity } = require('../middlewares/auth');
const { writeGuard } = require('../middlewares/rateLimit');
const { imageUpload, communityVideoUpload, UPLOAD_ROOT } = require('../middlewares/upload');

const router = express.Router();

const COMMUNITY_DIR = path.join(UPLOAD_ROOT, 'community');

// ========== 读接口（匿名可用；带了凭证就顺带算上互动状态） ==========

// GET /categories — 版块列表（发帖页与列表页顶部横滑都用它）
router.get('/categories', async (req, res) => {
  try {
    res.json(ok({ list: await community.listCategories() }));
  } catch (err) { res.status(500).json(fail(err.message)); }
});

// GET /posts — 信息流：只出 published，热度/最新两种排序，分页
router.get('/posts', resolveIdentity, async (req, res) => {
  try {
    const r = await community.listPosts({
      category: String(req.query.category || '').trim(),
      keyword: String(req.query.keyword || '').trim(),
      sort: req.query.sort === 'new' ? 'new' : 'hot',
      page: req.query.page,
      size: req.query.size,
    });
    res.json(ok(r));
  } catch (err) { res.status(err.status || 500).json(fail(err.message)); }
});

// GET /post/:id — 详情：进入即计一次浏览（同身份 60 秒去重），并回本人是否赞/藏过
router.get('/post/:id', resolveIdentity, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10) || 0;
    const post = await community.getPostById(id);
    // 待审/驳回/下架的内容：只有作者本人能看（且要看懂为什么不行），其他人一律 404
    const me = req.identity;
    const isAuthor = me && me.type === post.authorType && Number(me.userId) === Number(post.userId);
    if (post.status !== 'published' && !isAuthor) {
      return res.status(404).json(fail('内容不存在或已删除', 404));
    }
    community.bumpView(id, me, req.ip);
    let liked = false;
    let favorited = false;
    if (me) {
      const [[l]] = await pool.query(
        "SELECT 1 FROM community_like WHERE target_type = 'post' AND target_id = ? AND author_type = ? AND user_id = ? LIMIT 1",
        [id, me.type, me.userId]);
      const [[f]] = await pool.query(
        'SELECT 1 FROM community_favorite WHERE post_id = ? AND author_type = ? AND user_id = ? LIMIT 1',
        [id, me.type, me.userId]);
      liked = !!l;
      favorited = !!f;
    }
    const comments = await community.listComments(id, { adminAll: !!isAuthor });
    res.json(ok({ post, comments, liked, favorited, isAuthor: !!isAuthor }));
  } catch (err) { res.status(err.status || 500).json(fail(err.message, err.status || 500)); }
});

// GET /mine — 我的帖子（含被驳回/下架，带 audit_note）+ 我的收藏
router.get('/mine', requireIdentity, async (req, res) => {
  try {
    res.json(ok(await community.mine(req.identity)));
  } catch (err) { res.status(err.status || 500).json(fail(err.message)); }
});

// ========== 写接口（一律要身份 + 滑窗限流） ==========

// POST /post — 发帖（分级审核在服务层落地；spec 选填，带规格才算参考价）
router.post('/post', requireIdentity, writeGuard({ windowMs: 60 * 60 * 1000, max: 5, name: 'post' }), async (req, res) => {
  try {
    const b = req.body || {};
    const ret = await community.createPost({
      identity: req.identity,
      title: b.title,
      content: b.content,
      categoryCode: b.categoryCode || b.category,
      images: b.images,
      videoUrl: b.videoUrl,
      coverUrl: b.coverUrl,
      // 结构化规格（Batch E）：白名单裁剪与算价都在服务层，路由不做业务判断
      spec: b.spec,
    });
    res.json(ok(ret));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// POST /post/:id/comment — 评论（parentId 可选，仅一层回复；工厂可附结构化报价）
router.post('/post/:id/comment', requireIdentity, writeGuard({ windowMs: 60 * 60 * 1000, max: 20, name: 'comment' }), async (req, res) => {
  try {
    const ret = await community.createComment({
      identity: req.identity,
      postId: req.params.id,
      content: (req.body || {}).content,
      parentId: (req.body || {}).parentId,
      // 答价（Batch E）：客户身份传了也会在服务层被忽略，不报错
      quotePrice: (req.body || {}).quotePrice,
      quoteValidDays: (req.body || {}).quoteValidDays,
    });
    res.json(ok(ret));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// POST /post/:id/accept-quote — 帖主采纳一条工厂答价（仅帖主，同帖互斥，幂等）
router.post('/post/:id/accept-quote', requireIdentity, async (req, res) => {
  try {
    const ret = await community.acceptQuote(req.identity, req.params.id, (req.body || {}).commentId);
    res.json(ok(ret));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// POST /like — 点赞开关（{targetType, targetId}）
router.post('/like', requireIdentity, async (req, res) => {
  try {
    const b = req.body || {};
    res.json(ok(await community.toggleLike({ identity: req.identity, targetType: b.targetType, targetId: b.targetId })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// POST /favorite — 收藏开关（{postId}）
router.post('/favorite', requireIdentity, async (req, res) => {
  try {
    res.json(ok(await community.toggleFavorite({ identity: req.identity, postId: (req.body || {}).postId })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// POST /report — 举报（同人同目标只计一次；达阈值自动回退待审）
router.post('/report', requireIdentity, writeGuard({ windowMs: 60 * 60 * 1000, max: 10, name: 'report' }), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(ok(await community.report({
      identity: req.identity,
      targetType: b.targetType,
      targetId: b.targetId,
      reason: b.reason,
      detail: b.detail,
    })));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// DELETE /post/:id、DELETE /comment/:id — 作者本人下架自己的内容
router.delete('/post/:id', requireIdentity, async (req, res) => {
  try {
    res.json(ok(await community.deleteMine(req.identity, 'post', req.params.id)));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});
router.delete('/comment/:id', requireIdentity, async (req, res) => {
  try {
    res.json(ok(await community.deleteMine(req.identity, 'comment', req.params.id)));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// ========== 上传（先传后发：返回 url，发帖时带上，落库前服务层再校一次前缀） ==========

// POST /media-image — 社区配图（≤5MB，png/jpg/gif/webp），也可当视频封面用
router.post('/media-image', requireIdentity, imageUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json(fail('没有收到文件'));
    res.json(ok({
      url: `/uploads/community/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/**
 * 社区视频不做机审（contentGuard 无 mediaCheckAsync），靠举报 + 后台人工
 * 封面不再单开一个接口：计划里只要求 media-image / media-video 两个上传口，
 * 想要封面的发帖方直接走 media-image 拿到 url 后作 coverUrl 一并提交
 */
router.post('/media-video', requireIdentity, communityVideoUpload, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json(fail('没有收到文件'));
    const duration = Number((req.body || {}).duration);
    res.json(ok({
      url: `/uploads/community/${req.file.filename}`,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      duration: Number.isFinite(duration) && duration > 0 && duration <= 86400 ? Math.round(duration) : null,
    }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// 上传目录要在服务启动时就存在，否则 multer 首传竞争 mkdir 偶尔会失败
try { fs.mkdirSync(COMMUNITY_DIR, { recursive: true }); } catch (e) { /* 已存在 */ }

module.exports = router;
