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

module.exports = router;
