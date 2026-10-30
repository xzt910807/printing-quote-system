/**
 * 021 设计辅助路由（挂载在 /api/c 下）
 *   GET  /design/templates?productType=   排版模板列表（canvas 布局一并下发，端上实时预览用）
 *   POST /design/render                   按模板渲染高清 PNG → { url }（匿名可用，IP 限流防刷）
 *   POST /upload/design                   设计参考图上传（multipart 字段名 image，≤5MB jpg/png/webp）
 *   POST /design/ai-gen                 AI 生成设计参考图 → { url }（匿名可用，生图贵限流更严）
 * 匿名可用与询价流程一致（匿名报价是 C 端核心路径）；接口本身只产图不带业务数据，风险可控。
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const designService = require('../services/designService');
const { ok, fail } = require('../utils/helpers');
const { pool } = require('../config/db');
const { requireAdmin } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');

const router = express.Router();

// ===== 轻量 IP 限流（同 voice.js 思路：上传/渲染/生图都消耗服务器资源，防恶意刷）=====

function ipLimit(req, res, next) {
  return makeLimit(60 * 1000, 20)(req, res, next);
}

/** 生图专用限流器：上游按张计费，窗口内严格限次 */
function makeLimit(windowMs, max) {
  const store = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of store) {
      const kept = arr.filter((t) => now - t < windowMs);
      if (kept.length) store.set(k, kept); else store.delete(k);
    }
  }, windowMs).unref();
  return function limit(req, res, next) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const arr = (store.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json(fail('操作太频繁，请稍后再试', 429));
    }
    arr.push(now);
    store.set(ip, arr);
    next();
  };
}

// GET /design/templates
router.get('/design/templates', async (req, res) => {
  try {
    const list = await designService.listTemplates(req.query.productType);
    res.json(ok({ total: list.length, list }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

// POST /design/render  body: { templateId, texts: {key: value} } → { url, width, height }
router.post('/design/render', ipLimit, async (req, res) => {
  try {
    const { templateId, texts } = req.body || {};
    const data = await designService.renderTemplate({ templateId, texts });
    res.json(ok(data));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message, err.status || 400));
  }
});

// POST /design/ai-gen  body: { prompt } → { url }（AI 生成参考稿，60s 内限 3 次/IP）
router.post('/design/ai-gen', makeLimit(60 * 1000, 3), async (req, res) => {
  try {
    const { prompt } = req.body || {};
    const data = await designService.generateAiImage(prompt);
    res.json(ok(data));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message, err.status || 400));
  }
});

// ===== 设计参考图上传（落盘 uploads/designs/，静态托管见 app.js）=====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, designService.DESIGN_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase() || '.jpg';
    cb(null, 'ref_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + ext);
  },
});
const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 参考图 5MB 封顶（手机拍照压缩后足够）
  fileFilter: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    if (!ALLOWED.has(ext)) return cb(new Error('仅支持 jpg/png/webp 图片'));
    cb(null, true);
  },
});

router.post('/upload/design', ipLimit, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 5MB' : ('图片上传失败：' + err.message);
      return res.status(400).json(fail(msg));
    }
    if (!req.file) return res.status(400).json(fail('未接收到图片'));
    res.json(ok({ url: '/uploads/designs/' + req.file.filename }));
  });
});

// ========== 管理端设计稿台账（/api/admin/designs） ==========
// 没有独立的设计稿表：客户附稿/设计描述/制版 PDF 全部落在 c_inquiry 的 design_* 列上,
// 所以后台的「设计稿」就是一张带筛选的询价单视图, 不另外造数据源
const adminRouter = express.Router();
adminRouter.use(requireAdmin);
adminRouter.use(requirePermission('design:view'));

/**
 * GET /api/admin/designs?page=&size=&status=&has=&keyword=
 * status：need=需设计 public=工厂公版 none=客户自带稿
 * has：img=有参考图 pdf=有制版文件 fee=已计设计费
 * keyword：询价号 / 联系人 / 客户昵称 / 设计需求描述
 */
adminRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(req.query.size, 10) || 20, 1), 100);
    const offset = (page - 1) * size;
    const status = String(req.query.status || '').trim();
    const has = String(req.query.has || '').trim();
    const keyword = String(req.query.keyword || '').trim().slice(0, 50);

    const where = [];
    const params = [];
    if (['need', 'public', 'none'].includes(status)) { where.push('ci.design_status = ?'); params.push(status); }
    // JSON_LENGTH 对 NULL 列返回 NULL, 必须先判非空, 否则整个条件为 UNKNOWN 把行全筛掉
    if (has === 'img') where.push("ci.design_images IS NOT NULL AND JSON_LENGTH(ci.design_images) > 0");
    else if (has === 'pdf') where.push("ci.design_pdfs IS NOT NULL AND JSON_LENGTH(ci.design_pdfs) > 0");
    else if (has === 'fee') where.push('ci.design_fee IS NOT NULL');
    if (keyword) {
      const like = `%${keyword}%`;
      where.push('(ci.inquiry_no LIKE ? OR ci.contact_name LIKE ? OR eu.nickname LIKE ? OR ci.design_note LIKE ?)');
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const joins = ` LEFT JOIN c_end_user eu ON eu.id = ci.user_id
     LEFT JOIN factory f ON f.id = ci.matched_factory_id
     LEFT JOIN order_main o ON o.inquiry_id = ci.id`;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM c_inquiry ci${joins} ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT ci.id, ci.inquiry_no, ci.product_type, ci.quantity, ci.status,
              ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs, ci.design_fee,
              ci.contact_name, ci.contact_phone, ci.created_at, ci.accepted_at,
              eu.nickname AS user_nickname, f.name AS factory_name,
              o.id AS order_id, o.order_no, o.status AS order_status
       FROM c_inquiry ci${joins} ${whereSql}
       ORDER BY ci.id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]);

    // 全库概况（不受筛选影响）：顶部四个数就是给运营看总量、不看他当前筛了什么
    const [[stat]] = await pool.query(
      `SELECT COUNT(*) total,
              SUM(design_status = 'need') need_cnt,
              SUM(design_status = 'public') public_cnt,
              SUM(design_images IS NOT NULL AND JSON_LENGTH(design_images) > 0) has_img,
              SUM(design_pdfs IS NOT NULL AND JSON_LENGTH(design_pdfs) > 0) has_pdf,
              SUM(design_fee IS NOT NULL) has_fee,
              IFNULL(SUM(design_fee), 0) fee_sum
       FROM c_inquiry`);

    res.json(ok({
      list: rows,
      total,
      page,
      size,
      stat: {
        total: Number(stat.total) || 0,
        need: Number(stat.need_cnt) || 0,
        public: Number(stat.public_cnt) || 0,
        hasImg: Number(stat.has_img) || 0,
        hasPdf: Number(stat.has_pdf) || 0,
        hasFee: Number(stat.has_fee) || 0,
        feeSum: Number(stat.fee_sum) || 0,
      },
    }));
  } catch (err) {
    res.status(500).json(fail(err.message));
  }
});

module.exports = router;
module.exports.adminRouter = adminRouter;
