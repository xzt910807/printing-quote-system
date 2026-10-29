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
const chat = require('../services/inquiryChatService');

const FILES_DIR = path.join(__dirname, '..', '..', 'uploads', 'files');
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE_MB || 20) * 1024 * 1024;

// 允许的文件类型白名单
const ALLOWED_EXTENSIONS = ['.pdf', '.ai', '.cdr', '.psd', '.eps', '.zip', '.rar', '.7z', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.svg', '.dwg'];
const ALLOWED_MIMES = [
  'application/pdf', 'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
  'application/postscript', 'image/jpeg', 'image/png', 'image/tiff', 'image/svg+xml',
  'application/octet-stream', // CDR/AI/DWG 等常以 octet-stream 上传
];

/**
 * multipart 里的文件名按 latin1 解（busboy 行为）, 中文名会成 mojibake：
 * 「礼盒刀模图.pdf」→「ç¤¼ç›’åˆ€æ¨å›¾.pdf」, 会话文件列表里直接不可读。
 * 纯 ASCII 原样返回; 只有能干净转回 UTF-8（不出现替换符）才用转后的,
 * 免得本来就是 UTF-8 的名字被二次解码搞坏
 */
function decodeFileName(raw) {
  const s = String(raw || '');
  if (!s || /^[\x20-\x7e]*$/.test(s)) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.indexOf('\uFFFD') >= 0 ? s : fixed;
}

/**
 * 询价文件该落到哪个会话：会话键是 inquiry×factory。工厂侧对家就是本厂;
 * 客户侧得知道对面是谁 —— 聊天页上传会带 factoryId, 从别处（如询价详情）传时
 * 按已匹配工厂兜底; 一个都没对上（还没推厂的询价）就只存文件不进消息流
 */
async function resolveInquiryThread(refId, factoryId, wantFactoryId) {
  if (factoryId) return factoryId;
  if (wantFactoryId) {
    const [[p]] = await pool.query(
      'SELECT id FROM factory_inquiry_push WHERE inquiry_id = ? AND factory_id = ?', [refId, wantFactoryId]
    );
    if (p) return wantFactoryId;
  }
  const [[inq]] = await pool.query('SELECT matched_factory_id FROM c_inquiry WHERE id = ?', [refId]);
  return inq && inq.matched_factory_id ? Number(inq.matched_factory_id) : 0;
}

// multer 存储配置
const storage = multer.diskStorage({
  destination(req, file, cb) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
    cb(null, FILES_DIR);
  },
  filename(req, file, cb) {
    const original = decodeFileName(file.originalname);
    const ext = path.extname(original).toLowerCase() || '';
    // 注：正则字面量里写 \w 就是一个反斜杠加 w, 要字符类必须写单反斜杠;
    // 之前双反斜杠使白名单实际失效, 连正常字母数字都被替换成下划线
    const safeName = path.basename(original, ext).replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 50);
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
    const originalName = decodeFileName(req.file.originalname);

    const [ret] = await pool.query(
      'INSERT INTO file_transfer (ref_type, ref_id, sender_type, sender_id, file_name, file_url, file_size, mime_type) VALUES (?,?,?,?,?,?,?,?)',
      [refType, refId, senderType, senderId, originalName, fileUrl, req.file.size, req.file.mimetype]
    );

    // 询价里的文件同时作为一条会话消息进消息流：不然只躺在底部面板上, 对方不点开根本不知道有新文件
    let threaded = false;
    if (refType === 'inquiry') {
      try {
        const threadFactoryId = await resolveInquiryThread(refId, factoryId, parseInt(req.body.factoryId, 10) || 0);
        if (threadFactoryId) {
          await chat.sendFileMessage({
            inquiryId: refId,
            factoryId: threadFactoryId,
            senderType,
            // 会话表的工厂发送人是操作员（factory_user.id）, 与 file_transfer 存厂id的口径不同
            senderId: userId || (req.factoryUser ? req.factoryUser.id : factoryId),
            fileId: ret.insertId,
            fileName: originalName,
            isImage: /^image\//.test(req.file.mimetype || ''),
          });
          threaded = true;
        }
      } catch (e) {
        // 消息写失败不能把已落盘入库的文件带崩（例如存量库还没补 msg_type 列）
        console.warn('[fileTransfer] 文件会话消息写入失败:', e.message);
      }
    }

    res.json(ok({ id: ret.insertId, fileUrl, fileName: originalName, fileSize: req.file.size, threaded }));
  } catch (err) {
    // 清理已落盘的文件（multer 已保存）
    if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(400).json(fail(err.message));
  }
});

/**
 * 单个文件能不能被这个身份取走（与 /list 同一口径, 下载接口必须过这道）
 * 之前 /:id/download 只靠挂载中间件校了“登录了”, 登录用户把 id 改一个就能拉走别人询价/订单的刀模图
 * 询价文件是会话内私物：工厂只能取自己那条会话里的（同一条询价推给三家厂, A 厂的不给 B 厂）
 */
async function assertFileReadable(file, userId, factoryId) {
  if (file.ref_type === 'inquiry') {
    if (userId) {
      // 客户是询价归属人, 自己各条会话里的文件都能取
      const [[inq]] = await pool.query('SELECT id FROM c_inquiry WHERE id = ? AND user_id = ?', [file.ref_id, userId]);
      if (!inq) throw new Error('无权访问');
      return;
    }
    if (factoryId) {
      const [[im]] = await pool.query(
        "SELECT id FROM inquiry_message WHERE msg_type = 'file' AND file_id = ? AND inquiry_id = ? AND factory_id = ?",
        [file.id, file.ref_id, factoryId]
      );
      if (!im) throw new Error('无权访问');
      return;
    }
    throw new Error('无权访问');
  }
  // 订单与工单各自只有一对买卖方, 按归属表校即可
  const table = file.ref_type === 'order' ? 'order_main' : file.ref_type === 'issue' ? 'issue_ticket' : null;
  if (!table) throw new Error('未知的文件归属类型');
  const ownerCol = userId ? 'user_id' : 'factory_id';
  const ownerVal = userId || factoryId;
  if (!ownerVal) throw new Error('无权访问');
  const [[own]] = await pool.query(`SELECT id FROM ${table} WHERE id = ? AND ${ownerCol} = ?`, [file.ref_id, ownerVal]);
  if (!own) throw new Error('无权访问');
}

/**
 * GET /list?refType=&refId= — 查关联文件列表
 * refType=inquiry 时可用 factoryId 收窄到某一个会话
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

    // 询价按会话取：一条询价常同时推给多家厂, 上传与收到的文件只属于那一段对话
    if (refType === 'inquiry') {
      const threadFactoryId = factoryId || (parseInt(req.query.factoryId, 10) || 0);
      const [rows] = await pool.query(
        `SELECT ft.id, ft.sender_type, ft.sender_id, ft.file_name, ft.file_url, ft.file_size, ft.mime_type, ft.created_at
         FROM file_transfer ft
         JOIN inquiry_message im ON im.msg_type = 'file' AND im.file_id = ft.id
         WHERE ft.ref_type = 'inquiry' AND ft.ref_id = ?${threadFactoryId ? ' AND im.factory_id = ?' : ''}
         GROUP BY ft.id ORDER BY ft.created_at ASC`,
        threadFactoryId ? [refId, threadFactoryId] : [refId]
      );
      return res.json(ok({ list: rows }));
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
    const [[row]] = await pool.query('SELECT id, ref_type, ref_id, file_url, file_name FROM file_transfer WHERE id = ?', [id]);
    if (!row) throw new Error('文件不存在');
    await assertFileReadable(row, req.user ? req.user.id : null, req.factory ? req.factory.id : null);
    const filePath = path.join(__dirname, '..', '..', row.file_url.replace(/^\//, ''));
    if (!fs.existsSync(filePath)) throw new Error('文件已丢失');
    res.download(filePath, row.file_name);
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
