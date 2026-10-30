const { pool } = require('../config/db');
const { isWxConfigured, getAccessToken } = require('./wxService');

/**
 * 内容安全护栏：微信 msgSecCheck 文本同步检测
 *
 * 设计原则是「降级优先于拦截」——未配置密钥、无有效 openid、接口限流或超时，
 * 一律放行；只有微信明确判定 risky（或显式开启 SEC_REVIEW_BLOCK 时的 review）才拒绝提交。
 * 理由：内容安全属于风控手段，不能因为第三方接口抖动而阻断询价、沟通与下单主链路。
 *
 * 命中拦截时会向管理员站内信（c_message user_id=0 平台告警占位，与管理后台告警中心同一约定），
 * 便于运营回溯是谁在提交违规内容，openid 与原文片段一并留证。
 */

/** 官方单次 content 上限 2500 字符，留余量避免边界截断 */
const MAX_CHECK_LEN = 2000;
/** 检测超时（毫秒）：超时立即降级放行，不拖慢业务响应 */
const CHECK_TIMEOUT_MS = Number(process.env.SEC_TIMEOUT_MS || 1500);

/** 业务场景 → 微信 scene 码（1=论坛 2=社交日志 3=电商 4=其他） */
const SCENE_CODES = {
  community: 1,   // Batch D4 UGC 社区（论坛场景码以前没人用，现在帖子/评论都走这一类）
  chat: 2, comment: 2,
  inquiry: 3, media: 3,
  profile: 4,
};

function skip(reason) {
  return { pass: true, skipped: true, reason };
}

function degrade(err) {
  console.warn('[secGuard] 文本检测降级放行:', err.message);
  return { pass: true, degraded: true, reason: 'api-error: ' + err.message };
}

/** 违规留证：写管理员站内信（fire-and-forget，失败不影响拦截结果） */
async function reportViolation(opts, content, suggest, label) {
  const scene = opts.scene || 'unknown';
  const msg = `内容安全拦截：场景 ${scene}，openid ${opts.openid || '-'}，判定 ${suggest}${label ? '（label ' + label + '）' : ''}，片段「${String(content).slice(0, 60)}」`;
  console.warn('[secGuard] ' + msg);
  pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
     VALUES (0, 'content_violation', '内容安全拦截', ?, 'secGuard', 0)`,
    [msg.slice(0, 500)]
  ).catch((e) => console.error('[secGuard] 告警写库失败:', e.message));
}

/**
 * 检测单段文本
 * @param {string} text 待检内容
 * @param {Object} opts { openid 提交者微信openid（v2 必填）, scene 场景键 }
 * @returns {Promise<{pass:boolean,skipped?:boolean,degraded?:boolean,suggest?:string,label?:number,reason?:string}>}
 */
async function checkText(text, opts = {}) {
  const content = String(text || '').trim();
  if (!content) return skip('empty');
  if (process.env.SEC_TEXT_ENABLED === '0') return skip('disabled');
  if (!isWxConfigured()) return skip('not-configured');
  // 开发身份（dev_ 前缀）无真实 openid，微信侧无法判定用户，跳过
  const openid = opts.openid;
  if (!openid || String(openid).startsWith('dev_')) return skip('no-openid');

  let token;
  try { token = await getAccessToken(); } catch (e) { return degrade(e); }

  try {
    const res = await fetch(
      'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=' + encodeURIComponent(token),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        body: JSON.stringify({
          content: content.slice(0, MAX_CHECK_LEN),
          version: 2, // v1 已下线，v2 要求必须携带 openid 与 scene
          scene: SCENE_CODES[opts.scene] || 4,
          openid: String(openid),
        }),
      }
    );
    const data = await res.json();
    if (data.errcode !== 0) {
      // 44823 内容超长 / 45009 接口调用超限 / -1 系统繁忙 等均降级，不阻断业务
      return degrade(new Error('errcode=' + data.errcode + ' ' + (data.errmsg || '')));
    }
    const suggest = (data.result && data.result.suggest) || 'pass';
    const label = data.result && data.result.label;
    const blockReview = process.env.SEC_REVIEW_BLOCK === '1';
    if (suggest === 'risky' || (suggest === 'review' && blockReview)) {
      await reportViolation(opts, content, suggest, label);
      return { pass: false, suggest, label };
    }
    return { pass: true, suggest, label };
  } catch (e) {
    return degrade(e);
  }
}

/**
 * 多字段检测，任一命中即抛错（各路由 try/catch 会转成 400 提示）
 * 逐字段调用以便定位是哪个字段违规，代价是多次接口请求——单表单通常 1-2 个文本字段，可接受。
 * @param {Array<{label:string,value:*}>|Array<string>} fields 待检字段
 * @param {Object} opts { openid, scene }
 */
async function assertTextAllowed(fields, opts = {}) {
  const items = (fields || [])
    .map((f) => (typeof f === 'string' ? { label: '', value: f } : f))
    .filter((f) => f.value !== undefined && f.value !== null && String(f.value).trim() !== '');

  for (const it of items) {
    const r = await checkText(it.value, opts);
    if (!r.pass) {
      throw new Error((it.label ? it.label + '中' : '') + '含有违规内容，请修改后重新提交');
    }
  }
  return { checked: items.length };
}

/** C 端用户 openid */
async function userOpenid(userId) {
  if (!userId) return null;
  const [[row]] = await pool.query('SELECT openid FROM c_end_user WHERE id = ?', [userId]);
  return row ? row.openid : null;
}

/** 工厂员工 openid（未绑定微信时为 null，检测自动降级） */
async function factoryOpenid(factoryUserId) {
  if (!factoryUserId) return null;
  const [[row]] = await pool.query('SELECT openid FROM factory_user WHERE id = ?', [factoryUserId]);
  return row ? row.openid : null;
}

module.exports = { checkText, assertTextAllowed, userOpenid, factoryOpenid };
