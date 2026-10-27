/**
 * 协同文件传输路由
 * 用户/工厂在询价或订单上下文中互传设计源文件(PDF/AI/CDR/ZIP)，最大 20MB。
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireUser, requireFactory } = require('../middlewares/auth');

const FILES_DIR = path.join(__dirname, '..', '..', 'uploads', 'files');
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 20) * 1024 * 1024;

// 允许的文件类型白名单
const ALLOWED_EXTENSIONS = ['.pdf', '.ai', '.cdr', '.psd', '.eps', '.zip', '.rar', '.7z', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.svg', '.dwg'];
const ALLOWED_MIMES = [
  'application/pdf', 'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
  'application/postscript', 'image/jpeg', 'image/png', 'image/tiff', 'image/svg+xml',
  'application/octet-stream', // CDR/AI/DWG 等常以 octet-stream 上传
];

// multer 存储配置
const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    cb(null, FILES_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || '';
    const safeName = path.basename(file.originalname, ext).replace(/[^\\w\\u4e00-\\u9fa5\\-]/g, '_').slice(0, 50);
    const refType = req.body.refType || 'misc';
    const refId = req.body.refId || '0';
    cb(null, `${refType}_${refId}_${Date.now()}_${safeName}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return cb(new Error('不支持的文件类型：' + ext));
    }
    cb(null, true);
  },
});

/**
 * POST /upload — 上传文件
 * body: refType(inquiry|order), refId, file(multer)
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const refType = String(req.body.refType || '').trim();
    const refId = parseInt(req.body.refId, 10);
    if (!['inquiry', 'order', 'issue'].includes(refType)) throw new Error('refType 必须为 inquiry/order/issue');
    if (!refId) throw new Error('refId 不能为空');
    if (!req.file) throw new Error('未选择文件');

    // 归属校验
    const userId = req.user ? req.user.id : null;
    const factoryId = req.factory ? req.factory.id : null;
    if (userId) {
      if (refType === 'inquiry') {
        const [[inq]] = await pool.query('SELECT id FROM c_inquiry WHERE id = ? AND user_id = ?', [refId, userId]);
        if (!inq) throw new Error('无权操作该询价');
      } else if (refType === 'order') {
        const [[ord]] = await pool.query('SELECT id FROM order_main WHERE id = ? AND user_id = ?', [refId, userId]);
        if (!ord) throw new Error('无权操作该订单');
      } else { // issue
        const [[tk]] = await pool.query('SELECT id FROM issue_ticket WHERE id = ? AND user_id = ?', [refId, userId]);
        if (!tk) throw new Error('无权操作该工单');
      }
    } else if (factoryId) {
      if (refType === 'inquiry') {
        const [[push]] = await pool.query('SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_id = ?', [refId, factoryId]);
        if (!push) throw new Error('该询价未推送给你厂');
      } else if (refType === 'order') {
        const [[ord]] = await pool.query('SELECT id FROM order_main WHERE id = ? AND factory_id = ?', [refId, factoryId]);
        if (!ord) throw new Error('无权操作该订单');
      } else { // issue
        const [[tk]] = await pool.query('SELECT id FROM issue_ticket WHERE id = ? AND factory_id = ?', [refId, factoryId]);
        if (!tk) throw new Error('该工单不属于你厂');
      }
    } else {
      throw new Error('未登录');
    }

    const senderType = userId ? 'user' : 'factory';
    const senderId = userId || factoryId;
    const fileUrl = '/uploads/files/' + req.file.filename;

    const [ret] = await pool.query(
      'INSERT INTO file_transfer (ref_type, ref_id, sender_type, sender_id, file_name, file_url, file_size, mime_type) VALUES (?,?,?,?,?,?,?,?)',
      [refType, refId, senderType, senderId, req.file.originalname, fileUrl, req.file.size, req.file.mimetype]
    );
    res.json(ok({ id: ret.insertId, fileUrl, fileName: req.file.originalname, fileSize: req.file.size }));
  } catch (err) {
    // 清理已落盘的文件（multer 已保存）
    if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /list?refType=&refId= — 查关联文件列表
 */
router.get('/list', async (req, res) => {
  try {
    const refType = String(req.query.refType || '').trim();
    const refId = parseInt(req.query.refId, 10);
    if (!refType || !refId) throw new Error('参数不完整');

    const userId = req.user ? req.user.id : null;
    const factoryId = req.factory ? req.factory.id : null;

    // 权限校验（列表与上传同机制）
    if (userId) {
      if (refType === 'inquiry') {
        const [[inq]] = await pool.query('SELECT id FROM c_inquiry WHERE id = ? AND user_id = ?', [refId, userId]);
        if (!inq) throw new Error('无权访问');
      } else if (refType === 'order') {
        const [[ord]] = await pool.query('SELECT id FROM order_main WHERE id = ? AND user_id = ?', [refId, userId]);
        if (!ord) throw new Error('无权访问');
      } else if (refType === 'issue') {
        const [[tk]] = await pool.query('SELECT id FROM issue_ticket WHERE id = ? AND user_id = ?', [refId, userId]);
        if (!tk) throw new Error('无权访问');
      }
    } else if (factoryId) {
      if (refType === 'order') {
        const [[ord]] = await pool.query('SELECT id FROM order_main WHERE id = ? AND factory_id = ?', [refId, factoryId]);
        if (!ord) throw new Error('无权访问');
      } else if (refType === 'issue') {
        const [[tk]] = await pool.query('SELECT id FROM issue_ticket WHERE id = ? AND factory_id = ?', [refId, factoryId]);
        if (!tk) throw new Error('无权访问');
      } else if (refType === 'inquiry') {
        const [[push]] = await pool.query('SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_id = ?', [refId, factoryId]);
        if (!push) throw new Error('无权访问');
      }
    } else {
      // admin 无 userId/factoryId，不拦截（上游需已接 requireAdmin）
    }

    const [rows] = await pool.query(
      'SELECT id, sender_type, sender_id, file_name, file_url, file_size, mime_type, created_at FROM file_transfer WHERE ref_type = ? AND ref_id = ? ORDER BY created_at ASC',
      [refType, refId]
    );
    res.json(ok({ list: rows }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /:id/download — 下载文件
 */
router.get('/:id/download', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[row]] = await pool.query('SELECT file_url, file_name FROM file_transfer WHERE id = ?', [id]);
    if (!row) throw new Error('文件不存在');
    const filePath = path.join(__dirname, '..', '..', row.file_url.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) throw new Error('文件已丢失');
    res.download(filePath, row.file_name);
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
