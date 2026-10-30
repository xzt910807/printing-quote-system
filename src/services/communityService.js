/**
 * UGC 社区服务层（Batch D4）
 *
 * 三条不能让步的设计：
 * 1. 身份只认令牌。author_type / user_id / factory_id 一律由中间件 resolveIdentity 从
 *    请求头推导后传进来，服务层绝不从 body 读这三个字段——否则任何客户 POST 一个
 *    {author_type:'factory'} 就能绕过先发后审。
 * 2. 计数只在状态变化时动。评论数只统计 published，点赞数与 community_like 行数严格一致，
 *    取消走 DELETE + 减一，重复点靠唯一键幂等（先试 INSERT，ER_DUP_ENTRY 才减）。
 * 3. 图片/视频没有机审。contentGuard 只有 msg_sec_check，本期不接 mediaCheckAsync，
 *    所以媒体只能靠「先发后审 + 举报回退 + 后台人工」，代码里不能假装有机审兜底。
 *
 * 审核矩阵（与 docs/ops.md「社区运营」一节同口径）：
 *   工厂发帖/评论      → published（直接公开，不进人工队列）
 *   客户发帖/评论      → published + audit_note='待人工抽查'（先发后审）
 *   机审命中 risky     → pending（图片视频同条目一并压住）
 *   举报累计达阈值     → published 回退 pending + 站内信留痕
 *   后台 approve/reject/remove → published / rejected / removed（后两者必须填原因）
 */
const { pool } = require('../config/db');
const contentGuard = require('./contentGuard');
const communityPricing = require('./communityPricing');
const calibrationService = require('./calibrationService');
const capabilityService = require('./capabilityService');

/** 社区媒体一律落这个前缀，入库前必校：防止把外链 URL 塞进 post 变成钓鱼跳板 */
const UPLOAD_PREFIX = '/uploads/community/';
const MAX_IMAGES = 9;
const MAX_TITLE_LEN = 100;
const MAX_CONTENT_LEN = 5000;
/** 举报累计到几次就自动回退待审（设 0 等于关掉这条自动回退） */
const REPORT_HOLD = Number(process.env.COMMUNITY_REPORT_HOLD) > 0
  ? Number(process.env.COMMUNITY_REPORT_HOLD) : 3;
const REASONS = ['porn', 'ad', 'abuse', 'fake', 'other'];
const POST_STATUS = ['pending', 'published', 'rejected', 'removed'];

function bad(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

const likeStr = (v) => String(v == null ? '' : v).trim();

/** 只接受本站托管的社区媒体地址，其它（外链、data:、绝对路径）一律拒 */
function normalizeMediaUrl(raw, label) {
  const s = likeStr(raw);
  if (!s) return null;
  if (!s.startsWith(UPLOAD_PREFIX) || s.includes('..')) {
    throw bad(`${label}地址不合法，只能使用平台上传返回的地址`);
  }
  return s.slice(0, 500);
}

function normalizeImages(raw) {
  if (raw == null || raw === '') return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  if (arr.length > MAX_IMAGES) throw bad(`最多 ${MAX_IMAGES} 张图片`);
  const out = [];
  for (const it of arr) {
    const u = normalizeMediaUrl(typeof it === 'string' ? it : (it && it.url), '图片');
    if (u) out.push(u);
  }
  return out;
}

/** 身份 → 机审要用的 openid（工厂员工可能没绑微信，checkText 会自动降级放行） */
async function openidOf(identity) {
  if (identity.type === 'factory') return contentGuard.factoryOpenid(identity.userId);
  return contentGuard.userOpenid(identity.userId);
}

/* ==================== 分类 ==================== */

async function listCategories({ includeInactive = false } = {}) {
  const sql = `SELECT id, code, name, sort, is_active FROM community_category
               ${includeInactive ? '' : 'WHERE is_active = 1'}
               ORDER BY sort ASC, id ASC`;
  const [rows] = await pool.query(sql);
  return rows;
}

async function upsertCategory({ code, name, sort, isActive }) {
  const c = likeStr(code).toLowerCase().slice(0, 30);
  const n = likeStr(name).slice(0, 50);
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(c)) throw bad('分类编码只能是小写字母开头的字母数字下划线');
  if (!n) throw bad('分类名称不能为空');
  const s = Number(sort) || 0;
  const a = Number(isActive) === 0 ? 0 : 1;
  await pool.query(
    `INSERT INTO community_category (code, name, sort, is_active) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), sort = VALUES(sort), is_active = VALUES(is_active)`,
    [c, n, s, a]);
  const [[row]] = await pool.query('SELECT id, code, name, sort, is_active FROM community_category WHERE code = ?', [c]);
  return row;
}

/** 停用分类（不物理删：老帖还挂着这个 code，删了它们就掉出版块） */
async function toggleCategory(id, isActive) {
  const r = await pool.query('UPDATE community_category SET is_active = ? WHERE id = ?', [Number(isActive) === 1 ? 1 : 0, id]);
  if (!r[0].affectedRows) throw bad('分类不存在', 404);
  return { id: Number(id), isActive: Number(isActive) === 1 ? 1 : 0 };
}

/* ==================== 发帖 / 评论 ==================== */

/**
 * 发帖（分级审核在这里落地）
 * 标题与正文合并成一次机审：外部接口有配额，两段文本分开检测要双倍调用，收益只是
 * 报错时能指出哪一段违规——社区场景直接告诉用户「含违规内容」就够了。
 */
async function createPost({ identity, title, content, categoryCode, images, videoUrl, coverUrl, spec }) {
  const t = likeStr(title).slice(0, MAX_TITLE_LEN);
  const body = likeStr(content).slice(0, MAX_CONTENT_LEN);
  if (!t) throw bad('标题不能为空');
  if (body.length < 5) throw bad('正文至少 5 个字');
  const cat = likeStr(categoryCode).slice(0, 30);
  const [[category]] = await pool.query(
    'SELECT code, is_active FROM community_category WHERE code = ?', [cat]);
  if (!category) throw bad('版块不存在');
  if (!category.is_active) throw bad('该版块已停用，换一个再发');

  const imgArr = normalizeImages(images);
  const video = normalizeMediaUrl(videoUrl, '视频');
  const cover = normalizeMediaUrl(coverUrl, '封面');
  // 纯文字帖（经验交流、工艺问答）是社区主体，不强制配图；正文上面的 5 字下限已经保证不是空帖

  // 结构化规格 + 平台参考价快照（Batch E）：算不出价的组合只丢掉规格，帖子照常发，
  // 把原因通过 estimateError 回给端上提示——不能因为一个选填项让人白写一屏正文
  const norm = communityPricing.normalizeSpec(spec);
  const est = norm.spec ? communityPricing.estimateOf(norm.spec) : { ok: false, estimate: null, error: null };
  const estimateError = norm.error || est.error || null;

  const openid = await openidOf(identity);
  const guard = await contentGuard.checkText(`${t}\n${body}`, { openid, scene: 'community' });
  // 机审命中就整条压住待人工；否则按身份分级：工厂直接公开、客户先发后审
  const status = guard.pass ? 'published' : 'pending';
  const note = !guard.pass ? '机审命中，待人工复核'
    : (identity.type === 'factory' ? null : '待人工抽查');

  const [r] = await pool.query(
    `INSERT INTO community_post
       (user_id, author_type, factory_id, category_code, title, content, images, video_url, cover_url, status, audit_note, spec, estimate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [identity.userId, identity.type, identity.factoryId || null, cat, t, body,
      JSON.stringify(imgArr), video, cover, status, note,
      norm.spec ? JSON.stringify(norm.spec) : null,
      est.estimate ? JSON.stringify(est.estimate) : null]);
  const post = await getPostById(r.insertId);
  // 单价算出来了但没落成快照属于事故，estimateError 置空的唯一条件是 estimate 已就位
  if (estimateError) post.estimateError = estimateError;
  return post;
}

async function createComment({ identity, postId, content, parentId, quotePrice, quoteValidDays }) {
  const body = likeStr(content).slice(0, 1000);
  if (body.length < 1) throw bad('评论内容不能为空');
  const pid = Number(postId) || 0;
  const [[post]] = await pool.query('SELECT id, status FROM community_post WHERE id = ?', [pid]);
  if (!post) throw bad('帖子不存在', 404);
  if (post.status !== 'published') throw bad('该帖当前不可评论');
  const parent = Number(parentId) || null;
  if (parent) {
    const [[p]] = await pool.query('SELECT id, post_id FROM community_comment WHERE id = ? AND status = ?', [parent, 'published']);
    if (!p || Number(p.post_id) !== pid) throw bad('回复的评论不存在');
  }

  // 答价（Batch E）：只有工厂身份带价才算结构化报价。客户身份误传 quotePrice 一律忽略
  // 而不报错——端上拼参数出错不该把整条评论打回，评论内容本身才是主体。
  let isQuote = 0;
  let price = null;
  let validDays = null;
  if (identity.type === 'factory' && quotePrice !== undefined && quotePrice !== null && quotePrice !== '') {
    const p = Number(quotePrice);
    if (!Number.isFinite(p) || p <= 0 || p > 1000000) throw bad('答价需在 0~1000000 元/个之间');
    const d = (quoteValidDays === undefined || quoteValidDays === null || quoteValidDays === '')
      ? 7 : Number(quoteValidDays);
    if (!Number.isFinite(d) || d < 1 || d > 30) throw bad('报价有效期需在 1~30 天之间');
    isQuote = 1;
    // quote_price 是 decimal(12,4)，四舍五入到 4 位再入库，避免 1.23456 被 MySQL 截断成误差
    price = Math.round(p * 10000) / 10000;
    validDays = Math.round(d);
  }

  const openid = await openidOf(identity);
  const guard = await contentGuard.checkText(body, { openid, scene: 'community' });
  const status = guard.pass ? 'published' : 'pending';
  const note = !guard.pass ? '机审命中，待人工复核'
    : (identity.type === 'factory' ? null : '待人工抽查');

  const [r] = await pool.query(
    `INSERT INTO community_comment
       (post_id, user_id, author_type, factory_id, parent_id, content, status, audit_note,
        is_quote, quote_price, quote_valid_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [pid, identity.userId, identity.type, identity.factoryId || null, parent, body, status, note,
      isQuote, price, validDays]);
  if (status === 'published') {
    await pool.query('UPDATE community_post SET comment_count = comment_count + 1 WHERE id = ?', [pid]);
  }
  return getComment(r.insertId);
}

/**
 * 采纳答价（Batch E）：只有帖主能采纳自己帖子里的一条工厂报价，同帖互斥（至多一条 is_accepted=1）。
 *
 * 为什么不同时自动建询价单：采纳是信任信号（反哺撮合），不是下单动作。自动建单会产生一堆
 * 无人跟进的死单（询价还必须带联系人与收货地址），客户真要下单走详情页「按此参数询价」
 * → 计算器（已带规格回填）→ 现有 POST /api/c/quote，链路本来就有。
 */
async function acceptQuote(identity, postId, commentId) {
  const pid = Number(postId) || 0;
  const cid = Number(commentId) || 0;
  const [[post]] = await pool.query(
    'SELECT id, user_id, author_type, accepted_comment_id FROM community_post WHERE id = ?', [pid]);
  if (!post) throw bad('帖子不存在', 404);
  if (post.author_type !== identity.type || Number(post.user_id) !== Number(identity.userId)) {
    throw bad('只有帖主可以采纳报价', 403);
  }
  if (!cid) throw bad('缺少要采纳的评论');
  const [[c]] = await pool.query(
    'SELECT id, post_id, author_type, is_quote, status FROM community_comment WHERE id = ?', [cid]);
  if (!c) throw bad('评论不存在', 404);
  if (Number(c.post_id) !== pid) throw bad('该评论不属于这个帖子');
  if (c.author_type !== 'factory' || Number(c.is_quote) !== 1) throw bad('只能采纳工厂的报价评论');
  if (c.status !== 'published') throw bad('该报价当前不可采纳');
  // 幂等：重复点同一条直接返回 unchanged，不重复写库（端上按钮会连点）
  if (Number(post.accepted_comment_id) === cid) return { accepted: true, unchanged: true, commentId: cid };

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 同帖互斥：先撤旧采纳再置位新条，事务保证不会出现「两条同时被采纳」
    await conn.query('UPDATE community_comment SET is_accepted = 0 WHERE post_id = ? AND is_accepted = 1', [pid]);
    await conn.query('UPDATE community_comment SET is_accepted = 1 WHERE id = ?', [cid]);
    await conn.query('UPDATE community_post SET accepted_comment_id = ? WHERE id = ?', [cid, pid]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { accepted: true, unchanged: false, commentId: cid };
}

/* ==================== 点赞 / 收藏 ==================== */

/** 目标存在性校验（点赞/收藏/举报共用，防往不存在的 id 上刷计数） */
async function assertTarget(targetType, targetId) {
  const id = Number(targetId) || 0;
  if (!id) throw bad('目标不存在');
  if (targetType === 'post') {
    const [[row]] = await pool.query('SELECT id, status FROM community_post WHERE id = ?', [id]);
    if (!row) throw bad('内容不存在或已删除', 404);
    if (row.status === 'removed' || row.status === 'rejected') throw bad('内容已下架，不能互动');
    return { table: 'community_post', id };
  }
  if (targetType === 'comment') {
    const [[row]] = await pool.query('SELECT id, post_id, status FROM community_comment WHERE id = ?', [id]);
    if (!row) throw bad('内容不存在或已删除', 404);
    if (row.status !== 'published') throw bad('内容已下架，不能互动');
    return { table: 'community_comment', id, postId: Number(row.post_id) };
  }
  throw bad('互动对象类型不正确');
}

/**
 * 点赞开关：先试 INSERT，撞唯一键（ER_DUP_ENTRY）说明已点过 → DELETE 并减一
 * 为什么不用 INSERT ... ON DUPLICATE KEY UPDATE：那个写法一条语句里既可能插行又可能更新行，
 * 分不清是「新增点赞」还是「重复点击」，计数就会越跑越偏
 */
async function toggleLike({ identity, targetType, targetId }) {
  const t = await assertTarget(targetType, targetId);
  try {
    await pool.query(
      'INSERT INTO community_like (target_type, target_id, user_id, author_type) VALUES (?, ?, ?, ?)',
      [targetType, t.id, identity.userId, identity.type]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    await pool.query(
      'DELETE FROM community_like WHERE target_type = ? AND target_id = ? AND author_type = ? AND user_id = ?',
      [targetType, t.id, identity.type, identity.userId]);
    await pool.query(
      `UPDATE ${t.table} SET like_count = GREATEST(like_count - 1, 0) WHERE id = ?`, [t.id]);
    return { liked: false, targetType, targetId: t.id };
  }
  await pool.query(`UPDATE ${t.table} SET like_count = like_count + 1 WHERE id = ?`, [t.id]);
  return { liked: true, targetType, targetId: t.id };
}

async function toggleFavorite({ identity, postId }) {
  const t = await assertTarget('post', postId);
  try {
    await pool.query(
      'INSERT INTO community_favorite (post_id, user_id, author_type) VALUES (?, ?, ?)',
      [t.id, identity.userId, identity.type]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    await pool.query(
      'DELETE FROM community_favorite WHERE post_id = ? AND author_type = ? AND user_id = ?',
      [t.id, identity.type, identity.userId]);
    await pool.query('UPDATE community_post SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?', [t.id]);
    return { favorited: false, postId: t.id };
  }
  await pool.query('UPDATE community_post SET favorite_count = favorite_count + 1 WHERE id = ?', [t.id]);
  return { favorited: true, postId: t.id };
}

/* ==================== 举报 ==================== */

/**
 * 举报：唯一键让同一举报人对同一目标只能计一次，否则一个人连点三次就能把别人的
 * 正常内容刷回待审队列。达阈值回退只在目标当前是 published 时发生，且写站内信留痕。
 */
async function report({ identity, targetType, targetId, reason, detail }) {
  const t = await assertTarget(targetType, targetId);
  const rt = targetType === 'post' || targetType === 'comment' ? targetType : null;
  if (!rt) throw bad('举报对象类型不正确');
  const rs = likeStr(reason).slice(0, 30);
  if (!REASONS.includes(rs)) throw bad('举报理由不正确');
  const d = likeStr(detail).slice(0, 300) || null;

  let inserted = true;
  try {
    await pool.query(
      `INSERT INTO community_report (target_type, target_id, reporter_id, reporter_type, reason, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rt, t.id, identity.userId, identity.type, rs, d]);
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
    inserted = false;   // 重复举报：不累计、不回退，只给一个「已收到」的回复
  }
  if (!inserted) return { accepted: false, duplicated: true, message: '你已举报过，平台会尽快处理' };

  if (rt === 'post') await pool.query('UPDATE community_post SET report_count = report_count + 1 WHERE id = ?', [t.id]);
  const [[cnt]] = await pool.query(
    'SELECT COUNT(*) AS n FROM community_report WHERE target_type = ? AND target_id = ?', [rt, t.id]);
  let held = false;
  if (Number(cnt.n) >= REPORT_HOLD) {
    const table = rt === 'post' ? 'community_post' : 'community_comment';
    const [r2] = await pool.query(
      `UPDATE ${table} SET status = 'pending', audit_note = ? WHERE id = ? AND status = 'published'`,
      [`举报累计 ${cnt.n} 次，自动回退待审`, t.id]);
    if (r2.affectedRows) {
      held = true;
      // 评论被压回待审就不再公开，所属帖的 comment_count 得同步减一（口径与 syncCommentCount 一致）
      if (rt === 'comment') await syncCommentCount(t.postId, 'published', 'pending');
      // 留痕走 c_message 的 user_id=0 平台告警占位（与 contentGuard 同一约定）
      pool.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (0, 'community_hold', '社区内容举报达阈值回退待审', ?, ?, ?)`,
        [`举报 ${rt}#${t.id} 累计 ${cnt.n} 次，已回退待人工复审`, 'community', t.id]
      ).catch((e) => console.error('[community] 举报留痕写库失败:', e.message));
    }
  }
  return { accepted: true, duplicated: false, held, reportCount: Number(cnt.n) };
}

/* ==================== 后台审核 ==================== */

/**
 * 评论算不算进 comment_count，只看它是否 published；后台 approve/reject/remove 与举报处置
 * 都会翻这个状态，不在这里同步就会出现「待审评论通过后计数还是 0」「下架的评论还被计数」
 * （作者自删走 deleteMine，另有处理）
 */
async function syncCommentCount(postId, fromStatus, toStatus) {
  const pid = Number(postId) || 0;
  if (!pid || (fromStatus === 'published') === (toStatus === 'published')) return;
  const delta = toStatus === 'published' ? '+ 1' : '- 1';
  await pool.query(
    `UPDATE community_post SET comment_count = GREATEST(comment_count ${delta}, 0) WHERE id = ?`, [pid]);
}

/**
 * 审核帖子/评论
 * action: approve → published / reject → rejected / remove → removed / top / essence
 * 驳回与下架必须填原因（作者端会显示 audit_note，空原因等于让人猜）
 */
async function audit({ targetType = 'post', targetId, action, note, adminId }) {
  const id = Number(targetId) || 0;
  const table = targetType === 'comment' ? 'community_comment' : 'community_post';
  // 评论表没有 title 列，这里只取两张表都有的列（帖子与评论共用同一段审核逻辑）
  const [[row]] = await pool.query(`SELECT id, status, user_id, author_type FROM ${table} WHERE id = ?`, [id]);
  if (!row) throw bad('内容不存在', 404);
  const n = likeStr(note).slice(0, 300);

  if (action === 'top' || action === 'essence') {
    const col = action === 'top' ? 'is_top' : 'is_essence';
    await pool.query(`UPDATE ${table} SET ${col} = IF(${col} = 1, 0, 1) WHERE id = ?`, [id]);
    const [[after]] = await pool.query(`SELECT ${col} AS v FROM ${table} WHERE id = ?`, [id]);
    return { id, action, value: after.v };
  }
  if (action === 'approve') {
    await pool.query(
      `UPDATE ${table} SET status = 'published', audit_note = ? WHERE id = ?`,
      [n || '后台审核通过', id]);
    if (targetType === 'comment') await syncCommentCount((await getCommentRow(id)).post_id, row.status, 'published');
    return { id, action, status: 'published' };
  }
  if (action === 'reject' || action === 'remove') {
    if (!n) throw bad('驳回或下架必须填写原因');
    const status = action === 'reject' ? 'rejected' : 'removed';
    await pool.query(`UPDATE ${table} SET status = ?, audit_note = ? WHERE id = ?`, [status, n, id]);
    if (targetType === 'comment') await syncCommentCount((await getCommentRow(id)).post_id, row.status, status);
    return { id, action, status };
  }
  throw bad('审核动作不正确');
}

async function getCommentRow(id) {
  const [[c]] = await pool.query('SELECT post_id FROM community_comment WHERE id = ?', [id]);
  return c || {};
}

/**
 * 举报处置
 * dismiss：举报不成立，目标不动；reject：举报成立，目标下架（post=removed / comment=rejected）
 * 处置时把目标当前 pending 一并解决掉——举报达阈值回退待审的那条，人工判完就该离开队列
 */
async function handleReport({ reportId, action, note, adminId }) {
  const id = Number(reportId) || 0;
  const [[rec]] = await pool.query('SELECT * FROM community_report WHERE id = ?', [id]);
  if (!rec) throw bad('举报记录不存在', 404);
  if (rec.status !== 'pending') throw bad('该举报已处置过');
  const act = likeStr(action);
  if (act !== 'reject' && act !== 'dismiss') throw bad('处置动作只能是 reject / dismiss');
  const n = likeStr(note).slice(0, 300);
  if (!n) throw bad('处置必须填写备注');

  const table = rec.target_type === 'comment' ? 'community_comment' : 'community_post';
  if (act === 'reject') {
    const status = rec.target_type === 'comment' ? 'rejected' : 'removed';
    // post_id 只在评论表上，帖子表没这一列（举报的 target_type 是运行时才知道的，必须分支）
    let before = null;
    if (rec.target_type === 'comment') {
      const [[c]] = await pool.query('SELECT post_id, status FROM community_comment WHERE id = ?', [rec.target_id]);
      before = c;
    }
    await pool.query(`UPDATE ${table} SET status = ?, audit_note = ? WHERE id = ?`,
      [status, `举报处置：${n}`, rec.target_id]);
    if (before) await syncCommentCount(before.post_id, before.status, status);
  }
  await pool.query(
    'UPDATE community_report SET status = ?, handler_id = ?, handle_note = ? WHERE id = ?',
    [act === 'reject' ? 'handled' : 'dismissed', adminId || null, n, id]);
  return { id, action: act, targetStatus: act === 'reject' ? (rec.target_type === 'comment' ? 'rejected' : 'removed') : undefined };
}

/* ==================== 查询 ==================== */

/** 列表/详情共用的作者名与工厂名取法（一次 JOIN 搭完，避免逐行回查） */
const POST_SELECT = `SELECT p.id, p.title, p.content, p.category_code, p.author_type, p.user_id, p.factory_id,
       p.images, p.video_url, p.cover_url, p.status, p.audit_note,
       p.view_count, p.like_count, p.comment_count, p.favorite_count, p.report_count,
       p.is_top, p.is_essence, p.created_at, p.updated_at,
       p.spec, p.estimate, p.accepted_comment_id,
       COALESCE(cu.nickname, f.name, fu.real_name, fu.username, '匿名') AS author_name,
       f.name AS factory_name, cu.avatar_url AS author_avatar, cc.name AS category_name,
       f.verification_level AS author_verification_level,
       f.license_verified AS author_license_verified,
       (SELECT 1 FROM factory_media fm
         WHERE fm.factory_id = p.factory_id AND fm.media_type = 'certificate'
           AND fm.audit_status = 'approved' LIMIT 1) AS author_has_certificate
FROM community_post p
LEFT JOIN c_end_user cu ON cu.id = p.user_id AND p.author_type = 'user'
LEFT JOIN factory_user fu ON fu.id = p.user_id AND p.author_type = 'factory'
LEFT JOIN factory f ON f.id = p.factory_id
LEFT JOIN community_category cc ON cc.code = p.category_code`;

function parseImages(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

/** JSON 列经 mysql2 可能返回对象/数组或字符串（spec / estimate 两个 Batch E 新列同此） */
function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/**
 * 工厂作者的信任徽章（Batch E）。客户作者一律 null，**不是空对象**：
 * 端上 `wx:if="{{authorTrust}}"` 判空比逐字段判更省事，给 {} 会让它一律亮徽章。
 */
function trustOf(authorType, level, licenseVerified, hasCertificate) {
  if (authorType !== 'factory') return null;
  return {
    verificationLevel: Number(level) || 0,
    licenseVerified: Number(licenseVerified) === 1,
    hasCertificate: !!hasCertificate,
  };
}

function shapePost(row, { full = false, withNote = false } = {}) {
  const out = {
    id: row.id,
    title: row.title,
    categoryCode: row.category_code,
    categoryName: row.category_name || row.category_code,
    authorType: row.author_type,
    authorName: row.author_name,
    factoryName: row.factory_name,
    factoryId: row.factory_id,
    images: parseImages(row.images),
    videoUrl: row.video_url,
    coverUrl: row.cover_url,
    status: row.status,
    viewCount: Number(row.view_count) || 0,
    likeCount: Number(row.like_count) || 0,
    commentCount: Number(row.comment_count) || 0,
    favoriteCount: Number(row.favorite_count) || 0,
    reportCount: Number(row.report_count) || 0,
    isTop: Number(row.is_top) || 0,
    isEssence: Number(row.is_essence) || 0,
    createdAt: row.created_at,
    authorTrust: trustOf(row.author_type, row.author_verification_level,
      row.author_license_verified, row.author_has_certificate),
    acceptedCommentId: Number(row.accepted_comment_id) || null,
  };
  // 规格与参考价（Batch E）：列表只给单价与数量（卡片上一个「¥x/个起」就够了），
  // 详情才下发整份成本拆解（material/plate/printing/finishing/fixed）
  const spec = parseJson(row.spec, null);
  if (spec) {
    out.spec = spec;
    out.specText = communityPricing.specTextOf(spec);
  }
  const estimate = parseJson(row.estimate, null);
  if (estimate) {
    // 信度动态算：快照里的金额是发布当时的，但「准不准」要看现在的成交样本。
    // 若把发布当日的信度一起落库再原样回放，老帖会永远显示「样本积累中」。
    const conf = calibrationService.confidenceOf({
      productType: spec ? spec.productType : null,
      materialCode: spec ? spec.materialCode : null,
      printMode: spec ? spec.printMode : null,
    });
    out.estimate = full ? { ...estimate, confidence: conf } : {
      unitPrice: estimate.unitPrice,
      quantity: estimate.quantity,
      calculatedAt: estimate.calculatedAt,
      confidenceLevel: conf.level,
    };
    // 端上 wxml 不能调函数取嵌套字段，平铺一层直接渲染
    out.confidenceText = conf.text;
    // 区间口径的免责句：告诉读者这是历史成交，不是报价承诺（样本不足时为空串，端上不渲染）
    out.confidenceNote = conf.note;
  }
  // 摘要只给列表用；详情才下发全文与 audit_note（作者本人能看到驳回原因）
  if (full) {
    out.content = row.content;
    out.auditNote = row.audit_note;
    out.updatedAt = row.updated_at;
    out.userId = row.user_id;
  } else {
    if (row.content) out.summary = String(row.content).replace(/\s+/g, ' ').slice(0, 80);
    // 后台列表与作者本人视角（scope=mine）都要看得见审核结论：机审命中 / 待人工抽查 / 举报回退,
    // 否则运营不知道这条为什么在队列里、作者只会反复重发
    if (withNote) out.auditNote = row.audit_note;
  }
  return out;
}

/**
 * 信息流查询
 * scope: feed（只 published，C 端默认）/ mine（本人全部状态，被驳回也能看到原因）/ admin（后台可按状态筛）
 * sort : hot（热度）/ new（最新）—— 热度公式把「赞 + 评论×2 + 收藏×3」减去发布天数的一半，
 *        让老帖自然沉底，不需要额外的定时任务算分
 */
async function listPosts({ status, category, keyword, authorType, userId, scope = 'feed', sort = 'hot', page = 1, size = 10 }) {
  const where = [];
  const args = [];
  if (scope === 'feed') where.push("p.status = 'published'");
  else if (scope === 'mine') {
    if (!authorType || !userId) throw bad('参数不完整');
    // 本人看自己的内容：全部状态都返回（被驳回/下架也要能看到原因），但身份两个条件都要对
    where.push('p.author_type = ?', 'p.user_id = ?');
    args.push(authorType, Number(userId));
  } else if (status && POST_STATUS.includes(status)) {
    where.push('p.status = ?');
    args.push(status);
  }
  if (category) { where.push('p.category_code = ?'); args.push(String(category).slice(0, 30)); }
  if (keyword) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    const k = `%${String(keyword).slice(0, 50)}%`;
    args.push(k, k);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM community_post p ${whereSql}`, args);
  const sizeN = Math.min(Math.max(Number(size) || 10, 1), 50);
  const pageN = Math.max(Number(page) || 1, 1);
  const offset = (pageN - 1) * sizeN;
  const orderSql = sort === 'new'
    ? 'ORDER BY p.is_top DESC, p.created_at DESC, p.id DESC'
    : 'ORDER BY p.is_top DESC, (p.like_count + p.comment_count * 2 + p.favorite_count * 3 - DATEDIFF(NOW(), p.created_at) / 2) DESC, p.id DESC';
  const [rows] = await pool.query(
    `${POST_SELECT} ${whereSql} ${orderSql} LIMIT ${sizeN} OFFSET ${offset}`, args);
  return {
    list: rows.map((r) => shapePost(r, { withNote: scope !== 'feed' })),
    total: Number(total),
    page: pageN,
    size: sizeN,
    pages: Math.ceil(Number(total) / sizeN),
  };
}

async function getPostById(id) {
  const [[row]] = await pool.query(`${POST_SELECT} WHERE p.id = ?`, [Number(id) || 0]);
  if (!row) throw bad('内容不存在或已删除', 404);
  return shapePost(row, { full: true });
}

async function listComments(postId, { adminAll = false } = {}) {
  const pid = Number(postId) || 0;
  const statusSql = adminAll ? '' : "AND c.status = 'published'";
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.parent_id, c.content, c.like_count, c.status, c.audit_note, c.created_at,
            c.author_type, c.user_id, c.factory_id,
            c.is_quote, c.quote_price, c.quote_valid_days, c.is_accepted,
            COALESCE(cu.nickname, f.name, fu.real_name, fu.username, '匿名') AS author_name,
            f.name AS factory_name,
            f.verification_level AS author_verification_level,
            f.license_verified AS author_license_verified,
            (SELECT 1 FROM factory_media fm
              WHERE fm.factory_id = c.factory_id AND fm.media_type = 'certificate'
                AND fm.audit_status = 'approved' LIMIT 1) AS author_has_certificate
     FROM community_comment c
     LEFT JOIN c_end_user cu ON cu.id = c.user_id AND c.author_type = 'user'
     LEFT JOIN factory_user fu ON fu.id = c.user_id AND c.author_type = 'factory'
     LEFT JOIN factory f ON f.id = c.factory_id
     WHERE c.post_id = ? ${statusSql}
     ORDER BY c.created_at ASC, c.id ASC`, [pid]);
  return rows.map((r) => ({
    id: r.id,
    postId: r.post_id,
    parentId: r.parent_id,
    content: r.content,
    likeCount: Number(r.like_count) || 0,
    status: r.status,
    auditNote: r.audit_note,
    authorType: r.author_type,
    authorName: r.author_name,
    factoryName: r.factory_name,
    // 答价三件套（Batch E）：isQuote=0 的普通评论这三项全为空，端上据此区分渲染
    isQuote: Number(r.is_quote) || 0,
    quotePrice: r.quote_price == null ? null : Number(r.quote_price),
    quoteValidDays: r.quote_valid_days == null ? null : Number(r.quote_valid_days),
    isAccepted: Number(r.is_accepted) || 0,
    authorTrust: trustOf(r.author_type, r.author_verification_level,
      r.author_license_verified, r.author_has_certificate),
    createdAt: r.created_at,
  }));
}

async function getComment(id) {
  const [[r]] = await pool.query(
    `SELECT c.id, c.post_id, c.parent_id, c.content, c.like_count, c.status, c.audit_note, c.created_at,
            c.author_type, c.user_id, c.is_quote, c.quote_price, c.quote_valid_days, c.is_accepted,
            COALESCE(cu.nickname, fu.real_name, fu.username, '匿名') AS author_name
     FROM community_comment c
     LEFT JOIN c_end_user cu ON cu.id = c.user_id AND c.author_type = 'user'
     LEFT JOIN factory_user fu ON fu.id = c.user_id AND c.author_type = 'factory'
     WHERE c.id = ?`, [Number(id) || 0]);
  if (!r) throw bad('评论不存在', 404);
  return {
    id: r.id, postId: r.post_id, parentId: r.parent_id, content: r.content,
    likeCount: Number(r.like_count) || 0, status: r.status, auditNote: r.audit_note,
    authorType: r.author_type, authorName: r.author_name, createdAt: r.created_at,
    isQuote: Number(r.is_quote) || 0,
    quotePrice: r.quote_price == null ? null : Number(r.quote_price),
    quoteValidDays: r.quote_valid_days == null ? null : Number(r.quote_valid_days),
    isAccepted: Number(r.is_accepted) || 0,
  };
}

/**
 * 工厂侧的「待答价求助」：把报价求助/供需帖按本方生产能力筛出来。
 *
 * 为什么必须做这个入口：答价（createComment 的 is_quote）与社区声望（反哺撮合的 tiebreaker）
 * 都要靠工厂先看到帖子才可能产生。此前工厂端没有任何社区入口，只能自己逛 C 端社区碰运气，
 * 等于让供给侧靠缘分——那条数据链就一直是空的。
 *
 * 能力匹配分两步：SQL 只做粗筛（时间/板块/未采纳/自己没答过/不是自己发的），能力匹配在内存里做，
 * 因为 spec 是 JSON 列，在 SQL 里展开数组匹配工艺的写法既不通用也读不懂。
 */
async function listFactoryRequests(factoryId, { limit = 5 } = {}) {
  const fid = Number(factoryId) || 0;
  const size = Math.min(Math.max(Number(limit) || 5, 1), 20);
  const [rows] = await pool.query(
    `${POST_SELECT}
     WHERE p.status = 'published'
       AND p.category_code IN ('price', 'demand')
       AND p.estimate IS NOT NULL
       AND p.accepted_comment_id IS NULL
       AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND (p.factory_id IS NULL OR p.factory_id <> ?)
       AND NOT EXISTS (
         SELECT 1 FROM community_comment c
         WHERE c.post_id = p.id AND c.author_type = 'factory' AND c.factory_id = ?
       )
     ORDER BY p.created_at DESC
     LIMIT 60`,
    [fid, fid]);
  const caps = capabilityService.getByFactory(fid);
  // 未配置产能标签的工厂 canHandle 永远是 false，硬过滤会让新厂看到一片空——
  // 改成不过滤但标注「待完善标签」，让新工厂先有活干，再引导去补标签
  const capEmpty = !caps.productType.length && !caps.printMode.length
    && !caps.material.length && !caps.process.length;
  const scored = [];
  for (const r of rows) {
    const spec = parseJson(r.spec, null) || {};
    let score = 0;
    let hit = 0;
    if (spec.productType && caps.productType.includes(spec.productType)) { score += 2; hit += 1; }
    if (spec.printMode && caps.printMode.includes(spec.printMode)) { score += 1; hit += 1; }
    if (spec.materialCode && caps.material.includes(spec.materialCode)) { score += 1; hit += 1; }
    for (const p of (Array.isArray(spec.processes) ? spec.processes : [])) {
      if (caps.process.includes(p)) { score += 1; hit += 1; }
    }
    // 配了产能却一个维度都不匹配：不是本方工艺范围内的活，不占屏
    if (!capEmpty && score === 0) continue;
    scored.push({ row: r, score, hit });
  }
  scored.sort((a, b) => (b.score - a.score)
    || (new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime()));
  const list = scored.slice(0, size).map(({ row, hit }) => ({
    ...shapePost(row),
    matchText: hit > 0 ? '匹配你的产能 ' + hit + ' 项' : '待完善产能标签',
  }));
  return { list, total: list.length, capEmpty };
}

/** 我的：帖子（含被驳回/下架，带原因）+ 收藏的帖子 */
async function mine(identity) {
  const posts = await listPosts({ scope: 'mine', authorType: identity.type, userId: identity.userId, sort: 'new', size: 50 });
  // 收藏一次查完（旧写法逐条回查 getPostById，50 条就是 50 次查询）
  const [favs] = await pool.query(
    `${POST_SELECT}
     JOIN community_favorite cf ON cf.post_id = p.id AND cf.author_type = ? AND cf.user_id = ?
     WHERE p.status = 'published'
     ORDER BY cf.created_at DESC, cf.id DESC LIMIT 50`,
    [identity.type, identity.userId]);
  return { posts: posts.list, total: posts.total, favorites: favs.map((r) => shapePost(r)) };
}

/**
 * 删除：只有作者本人（后台下架走 audit remove）
 * 「本人」要 author_type + user_id 两个条件都对——客户 id 5 与工厂员工 id 5 是两个人
 * 先查归属再改状态：靠 affectedRows 判权限会把「已下架再删一次」误报成无权（值没变则 affectedRows=0）
 */
async function deleteMine(identity, targetType, id) {
  const num = Number(id) || 0;
  const table = targetType === 'comment' ? 'community_comment' : 'community_post';
  const [[own]] = await pool.query(
    `SELECT id, status, user_id, author_type${table === 'community_comment' ? ', post_id' : ''} FROM ${table} WHERE id = ?`, [num]);
  if (!own) throw bad('内容不存在或已删除', 404);
  if (own.author_type !== identity.type || Number(own.user_id) !== Number(identity.userId)) {
    throw bad('只能删除自己发布的内容', 403);
  }
  await pool.query(`UPDATE ${table} SET status = ?, audit_note = ? WHERE id = ?`,
    ['removed', '作者自行删除', num]);
  if (table === 'community_comment' && own.status === 'published') {
    await pool.query('UPDATE community_post SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = ?', [own.post_id]);
  }
  return { deleted: true, targetType, id: num };
}

/* ==================== 浏览量（降级优先于报错） ==================== */

/** 同身份 60 秒内重复进详情只算一次；计数不准可以接受，绝不能因为计数失败而让详情 500 */
const VIEW_DEDUPE_MS = 60 * 1000;
const viewSeen = new Map(); // `${key}:${postId}` -> ts

function viewKey(identity, ip) {
  const who = identity ? `${identity.type}:${identity.userId}` : String(ip || 'anon');
  return who;
}

function bumpView(postId, identity, ip) {
  const key = `${viewKey(identity, ip)}:${postId}`;
  const now = Date.now();
  const last = viewSeen.get(key);
  if (last && now - last < VIEW_DEDUPE_MS) return false;
  viewSeen.set(key, now);
  pool.query('UPDATE community_post SET view_count = view_count + 1 WHERE id = ?', [postId])
    .catch(() => { /* 浏览量失败不影响响应 */ });
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of viewSeen) { if (now - ts > VIEW_DEDUPE_MS * 5) viewSeen.delete(k); }
}, 5 * 60 * 1000).unref();

/* ==================== 后台列表（帖子/评论/举报） ==================== */

async function adminListComments({ status = 'pending', page = 1, size = 20 }) {
  // 状态走参数绑定，不把请求里的字符串拼进 SQL（已在白名单里也不行，拼串早晚出事）
  const st = POST_STATUS.includes(status) ? status : 'pending';
  const sizeN = Math.min(Math.max(Number(size) || 20, 1), 100);
  const pageN = Math.max(Number(page) || 1, 1);
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM community_comment WHERE status = ?', [st]);
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.content, c.status, c.audit_note, c.like_count, c.created_at, c.author_type, c.user_id,
            c.is_quote, c.quote_price, c.quote_valid_days, c.is_accepted,
            COALESCE(cu.nickname, f.name, fu.real_name, fu.username, '匿名') AS author_name,
            p.title AS post_title
     FROM community_comment c
     LEFT JOIN community_post p ON p.id = c.post_id
     LEFT JOIN c_end_user cu ON cu.id = c.user_id AND c.author_type = 'user'
     LEFT JOIN factory_user fu ON fu.id = c.user_id AND c.author_type = 'factory'
     LEFT JOIN factory f ON f.id = c.factory_id
     WHERE c.status = ?
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT ${sizeN} OFFSET ${(pageN - 1) * sizeN}`, [st]);
  return {
    total: Number(total), page: pageN, size: sizeN, pages: Math.ceil(Number(total) / sizeN),
    list: rows.map((r) => ({
      id: r.id, postId: r.post_id, postTitle: r.post_title, content: r.content,
      status: r.status, auditNote: r.audit_note, likeCount: Number(r.like_count) || 0,
      authorType: r.author_type, authorName: r.author_name, createdAt: r.created_at,
      // 后台也要看得见答价与采纳（运营据此核查报价是否被滥用）
      isQuote: Number(r.is_quote) || 0,
      quotePrice: r.quote_price == null ? null : Number(r.quote_price),
      quoteValidDays: r.quote_valid_days == null ? null : Number(r.quote_valid_days),
      isAccepted: Number(r.is_accepted) || 0,
    })),
  };
}

async function adminListReports({ status = 'pending', page = 1, size = 20 }) {
  const st = ['pending', 'handled', 'dismissed'].includes(status) ? status : 'pending';
  const sizeN = Math.min(Math.max(Number(size) || 20, 1), 100);
  const pageN = Math.max(Number(page) || 1, 1);
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM community_report WHERE status = ?', [st]);
  const [rows] = await pool.query(
    `SELECT r.*, p.title AS post_title, c.content AS comment_content
     FROM community_report r
     LEFT JOIN community_post p ON r.target_type = 'post' AND p.id = r.target_id
     LEFT JOIN community_comment c ON r.target_type = 'comment' AND c.id = r.target_id
     WHERE r.status = ?
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${sizeN} OFFSET ${(pageN - 1) * sizeN}`, [st]);
  return {
    total: Number(total), page: pageN, size: sizeN, pages: Math.ceil(Number(total) / sizeN),
    list: rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      targetTitle: r.target_type === 'comment' ? (r.comment_content || '').slice(0, 60) : r.post_title,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      reporterType: r.reporter_type,
      reporterId: r.reporter_id,
      handlerId: r.handler_id,
      handleNote: r.handle_note,
      createdAt: r.created_at,
    })),
  };
}

/** 后台概览计数（面板顶部四个筛选项后面的数字） */
async function adminStats() {
  const [[row]] = await pool.query(
    `SELECT
       SUM(status = 'pending') AS pending_posts,
       SUM(status = 'published') AS published_posts,
       SUM(status = 'rejected') AS rejected_posts,
       SUM(status = 'removed') AS removed_posts
     FROM community_post`);
  const [[c]] = await pool.query("SELECT COUNT(*) AS n FROM community_comment WHERE status = 'pending'");
  const [[r]] = await pool.query("SELECT COUNT(*) AS n FROM community_report WHERE status = 'pending'");
  return {
    pendingPosts: Number(row.pending_posts) || 0,
    publishedPosts: Number(row.published_posts) || 0,
    rejectedPosts: Number(row.rejected_posts) || 0,
    removedPosts: Number(row.removed_posts) || 0,
    pendingComments: Number(c.n) || 0,
    pendingReports: Number(r.n) || 0,
  };
}

module.exports = {
  UPLOAD_PREFIX, MAX_IMAGES, REASONS, POST_STATUS, REPORT_HOLD,
  listCategories, upsertCategory, toggleCategory,
  createPost, createComment, acceptQuote,
  toggleLike, toggleFavorite, report,
  audit, handleReport,
  listPosts, getPostById, listComments, getComment, mine, deleteMine,
  listFactoryRequests,
  bumpView,
  adminListComments, adminListReports, adminStats,
};
