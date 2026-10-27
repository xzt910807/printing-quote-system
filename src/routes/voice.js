/**
 * F-105 语音识别路由（第三方 ASR 通道）
 * POST /api/voice/recognize  multipart 音频（字段名 audio）→ { success, data: { text } }
 * 匿名可用（语音报价是匿名核心流程）；按 IP 限流防讯飞额度被刷；
 * 音频落盘到 data/voice-tmp（uploads 目录被静态托管，录音含隐私不可公网直链）。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { recognizeAudio, isConfigured } = require('../services/asrService');
const { ok, fail } = require('../utils/helpers');

// ===== 临时目录（每次启动确保存在）=====
const uploadDir = path.join(__dirname, '..', '..', 'data', 'voice-tmp');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase() || '.pcm';
    cb(null, 'voice_' + Date.now() + '_' + Math.floor(Math.random() * 1000) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 一句话报价远用不到 10MB，封顶防滥用
});

// ===== 轻量 IP 限流：讯飞按量计费，防恶意刷额度（1 分钟 30 次/IP）=====
const WINDOW = 60 * 1000;
const MAX_REQS = 30;
const hits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const kept = arr.filter((t) => now - t < WINDOW);
    if (kept.length) hits.set(k, kept); else hits.delete(k);
  }
}, 60 * 1000).unref();

function voiceRateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress) || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (arr.length >= MAX_REQS) {
    return res.status(429).json(fail('操作太频繁，请稍后再试', 429));
  }
  arr.push(now);
  hits.set(ip, arr);
  next();
}

function safeUnlink(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* 忽略 */ }
}

router.post('/recognize', voiceRateLimit, (req, res) => {
  upload.single('audio')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '音频过大（限 10MB）' : '音频上传失败：' + err.message;
      return res.status(400).json(fail(msg));
    }
    const tmpPath = req.file && req.file.path;
    try {
      if (!req.file) throw new Error('未接收到音频文件');
      if (!isConfigured()) {
        throw Object.assign(new Error('语音识别未配置，请联系管理员'), { status: 503 });
      }
      const text = await recognizeAudio(tmpPath);
      res.json(ok({ text }));
    } catch (e) {
      res.status(e.status || 500).json(fail('语音识别失败：' + e.message, e.status || 500));
    } finally {
      safeUnlink(tmpPath);
      safeUnlink(tmpPath && tmpPath + '.pcm');
    }
  });
});

module.exports = router;
