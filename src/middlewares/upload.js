/**
 * 大文件上传通道（Batch D3）
 *
 * 为什么要单独开：`app.js` 里的 `express.json({ limit: '2mb' })` 把请求体钉死在 2MB，
 * 而工厂图集的视频动辄十几 MB——沿用现有 base64 图集通道根本传不上来（base64 还会比
 * 原文件大约 1/3）。这里走 multer 的 diskStorage：文件直接落盘、不进内存、不占请求体限额，
 * 只把相对路径写进库。写法参照 src/routes/fileTransfer.js 的既有实现。
 *
 * 安全口径（与文件传输那套一致，只是更严）：
 * - 扩展名 + MIME 双白名单，两者都要过：只校扩展名，把 .exe 改名成 .mp4 就能塞进来；
 *   只校 MIME，客户端随便伪造一个 video/mp4 也进得来
 * - 落盘文件名一律服务端生成（身份 id + 时间戳 + 随机串），不采用客户端给的原始名，
 *   避免 "../../x" 之类路径穿越
 * - 目录只有 uploads/factory-media 与 uploads/community 两个，都是本服务自己托管的静态目录
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { fail } = require('../utils/helpers');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

// 体积上限单独可配：20MB 是「手机拍一段验厂短视频」够用、又不至于把磁盘填满的量
const VIDEO_MAX_MB = Number(process.env.MEDIA_VIDEO_MAX_MB) > 0 ? Number(process.env.MEDIA_VIDEO_MAX_MB) : 20;
const IMAGE_MAX_MB = 5;

/** multipart 的 originalname 是 latin1 解析的，中文名要转回 UTF-8（同 fileTransfer.js） */
function decodeFileName(raw) {
  const s = String(raw || '');
  if (!s || /^[\x20-\x7e]*$/.test(s)) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.indexOf('\uFFFD') >= 0 ? s : fixed;
}

/**
 * @param {object} cfg
 *   sub     uploads 下的子目录名
 *   prefix  文件名前缀
 *   maxMb   单文件上限
 *   exts    允许的扩展名（小写、不含点）
 *   mimes   允许的 MIME
 *   label   报错文案里的类型名
 */
function makeUploader({ sub, prefix, maxMb, exts, mimes, label }) {
  const dir = path.join(UPLOAD_ROOT, sub);
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const ext = (path.extname(decodeFileName(file.originalname)) || '').toLowerCase().replace(/^\./, '');
      // 身份优先取工厂、再取 C 端用户，都没有就用 0（此时多半是鉴权前置失败，文件也不会入库）
      const who = (req.factory && req.factory.id) || (req.user && req.user.id) || (req.identity && req.identity.userId) || 0;
      cb(null, `${prefix}_${who}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`);
    },
  });
  const mw = multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024 },
    fileFilter(req, file, cb) {
      const ext = (path.extname(decodeFileName(file.originalname)) || '').toLowerCase().replace(/^\./, '');
      if (!exts.includes(ext)) return cb(new Error(`不支持的${label}格式：仅允许 ${exts.join('/')}`));
      if (!mimes.includes(file.mimetype)) return cb(new Error(`${label}内容类型不正确：仅允许 ${mimes.join('/')}`));
      cb(null, true);
    },
  });
  const handler = mw.single('file');
  // multer 的错误（超限 / 类型不符 / multipart 解析失败）默认会冒到全局错误处理变成 500，
  // 这里就地转成 400 + 人话，端上才能把「视频超过 20MB」这种原因显示给用户
  return function uploadMiddleware(req, res, next) {
    handler(req, res, (err) => {
      if (!err) return next();
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `${label}不能超过 ${maxMb}MB`
        : (err.message || '上传失败');
      res.status(400).json(fail(msg));
    });
  };
}

// 工厂图集视频（mp4/mov）：与图片同目录，靠文件名前缀和 media_type 区分
const videoUpload = makeUploader({
  sub: 'factory-media', prefix: 'vid', maxMb: VIDEO_MAX_MB,
  exts: ['mp4', 'mov'], mimes: ['video/mp4', 'video/quicktime'], label: '视频',
});

// 视频首帧封面：工厂端可传（也可不传，端上用占位图）
const coverUpload = makeUploader({
  sub: 'factory-media', prefix: 'cover', maxMb: IMAGE_MAX_MB,
  exts: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], label: '封面图',
});

// 社区图片（Batch D4 用）：落在独立目录，便于和工厂图集分开关权限/清理
const imageUpload = makeUploader({
  sub: 'community', prefix: 'img', maxMb: IMAGE_MAX_MB,
  exts: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], label: '图片',
});

// 社区视频（Batch D4）：限额与工厂图集一致，但必须落 /uploads/community/
// 不能直接复用 videoUpload：那个实例写死落 factory-media，而社区入库前会校验 url 前缀必须是
// /uploads/community/（防塞任意外链），复用会让视频通道永远存不进去
const communityVideoUpload = makeUploader({
  sub: 'community', prefix: 'cvid', maxMb: VIDEO_MAX_MB,
  exts: ['mp4', 'mov'], mimes: ['video/mp4', 'video/quicktime'], label: '视频',
});

module.exports = { videoUpload, coverUpload, imageUpload, communityVideoUpload, UPLOAD_ROOT, VIDEO_MAX_MB, IMAGE_MAX_MB };
