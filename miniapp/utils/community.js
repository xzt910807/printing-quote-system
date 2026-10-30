/**
 * UGC 社区（Batch D4）页面共用辅助
 *
 * 身份这件事在后端是「只认令牌」的：resolveIdentity 先看 X-Factory-*、再看 X-User-*。
 * 而 utils/api.js 只自动带客户头（X-User-Id/Token）, 工厂头历史上是各页面自己 authHeaders()
 * 补的——社区四个页面都要带, 就收到这里来一份, 免得出现「社区里工厂发帖被记成客户」这种
 * 既绕过了直接公开、又让后台审核队列认错人的错。
 */
const api = require('./api');

/** 当前是不是工厂视角（与 tabBar 的 role 分流同源） */
function isFactory() {
  return (wx.getStorageSync('role') || 'customer') === 'factory';
}

/**
 * 请求头：工厂身份时补 X-Factory-Id/Token（工厂头是客户头的超集, 两套都带上后端按工厂判）;
 * 客户身份返回空对象——api.request/upload 已经自动带了 X-User-*, 这里再拼一份只会打架
 */
function identityHeaders() {
  if (!isFactory()) return {};
  const a = wx.getStorageSync('factoryAuth') || {};
  if (!a.factoryId || !a.token) return {};
  return { 'X-Factory-Id': String(a.factoryId), 'X-Factory-Token': a.token };
}

/** 发帖入口的提示文案：让人在按之前就知道自己发出去的东西走的是哪条审核线 */
function identityHint() {
  return isFactory()
    ? '当前身份：工厂 · 内容发布后直接公开'
    : '当前身份：客户 · 内容先发布后抽查';
}

/** 落盘路径拼成可访问 URL：/uploads/community/xxx 要在真机上补后端域名 */
function mediaUrl(u) {
  if (!u) return '';
  if (u.indexOf('http') === 0) return u;
  return api.BASE_URL + u;
}

/** 九宫格里的图：一次 previewImage 要能左右翻, 所以整组 URL 先备好 */
function mediaUrls(list) {
  return (Array.isArray(list) ? list : []).map(mediaUrl).filter(Boolean);
}

/** 时间友好展示：1 小时内「刚刚」/ 24 小时内「N小时前」/ 7 天内「N天前」/ 更早给日期 */
function friendTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t).slice(0, 16).replace('T', ' ');
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  const diff = Date.now() - d.getTime();
  if (diff >= 0 && diff < 3600e3) return '刚刚';
  if (diff >= 0 && diff < 86400e3) return Math.floor(diff / 3600e3) + '小时前';
  if (diff >= 0 && diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + '天前';
  const md = p(d.getMonth() + 1) + '-' + p(d.getDate());
  return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '-' + md;
}

/**
 * 帖子/评论出参的展示层加工：后端下发的是驼峰业务字段, wxml 里不做运算
 * （小程序模板表达式不支持函数调用, 计数与时间必须在这里算好）
 */
function shapeItem(p) {
  const imgs = mediaUrls(p.images);
  return Object.assign({}, p, {
    imageUrl: imgs,
    imageCount: imgs.length,
    videoSrc: mediaUrl(p.videoUrl),
    coverSrc: mediaUrl(p.coverUrl),
    authorText: p.authorType === 'factory' ? '工厂' : '客户',
    authorBadge: p.authorType === 'factory' ? 'badge-green' : 'badge-blue',
    authorShow: p.factoryName || p.authorName || '匿名',
    timeText: friendTime(p.createdAt),
    statText: (p.commentCount > 0 ? p.commentCount + '评论' : '')
      + (p.likeCount > 0 ? (p.commentCount > 0 ? ' · ' : '') + p.likeCount + '赞' : ''),
  });
}

module.exports = { isFactory, identityHeaders, identityHint, mediaUrl, mediaUrls, friendTime, shapeItem };
