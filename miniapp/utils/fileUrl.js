/**
 * 协同文件（file_transfer）出参的展示辅助
 * 聊天页的文件消息气泡与工单详情页的附件列表共用, 避免两处各写一份判定
 */
const api = require('./api');

// 手机能直接预览的位图格式；tif/svg/ai 等交给 openDocument 或退化成复制链接
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

/** 落盘路径拼成可访问 URL：按段转义, 中文/空格/# 不处理会被截断或当错路径 */
function fileUrl(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  return api.BASE_URL + u.split('/').map(encodeURIComponent).join('/');
}

/** 是否图片：优先看 mime, 老数据 mime 缺失时按扩展名兜底 */
function isImageFile(row) {
  if (!row) return false;
  return /^image\//.test(row.mime_type || '') || IMAGE_EXT.test(row.file_name || '');
}

/** 字节数转可读大小（不足 1MB 显 KB, 与列表右侧摘要一致） */
function fileSizeText(b) {
  const n = Number(b) || 0;
  return n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.ceil(n / 1024)) + 'KB';
}

/** 文档气泡上的格式标签：取扩展名大写, 拿不到就写「文件」 */
function fileExtText(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toUpperCase().slice(0, 4) : '文件';
}

module.exports = { fileUrl, isImageFile, fileSizeText, fileExtText };
