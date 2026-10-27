const { pool } = require('../config/db');

/**
 * 微信服务统一封装：access_token 缓存 + 订阅消息发送
 * 未配置 WX_APPID/WX_SECRET 时整体静默降级（开发模式），不影响主流程
 */

const tokenCache = { token: null, expireAt: 0 };

/**
 * 微信接口统一超时（毫秒）。
 * token 是订阅消息与内容检测的必经入口，而内容检测已挂在询价/IM 主链路上，
 * 无超时会导致微信侧卡住时直接拖慢用户提交，故超时即抛错由调用方降级。
 */
const WX_FETCH_TIMEOUT_MS = Number(process.env.WX_TIMEOUT_MS || 3000);

function isWxConfigured() {
  return !!(process.env.WX_APPID && process.env.WX_SECRET);
}

async function getAccessToken() {
  if (!isWxConfigured()) throw new Error('未配置微信密钥');
  const now = Date.now();
  if (tokenCache.token && tokenCache.expireAt > now + 60 * 1000) return tokenCache.token;
  const url = 'https://api.weixin.qq.com/cgi-bin/token'
    + '?grant_type=client_credential'
    + '&appid=' + encodeURIComponent(process.env.WX_APPID)
    + '&secret=' + encodeURIComponent(process.env.WX_SECRET);
  const res = await fetch(url, { signal: AbortSignal.timeout(WX_FETCH_TIMEOUT_MS) });
  const data = await res.json();
  if (!data.access_token) throw new Error('获取微信 access_token 失败：' + (data.errmsg || '未知错误'));
  tokenCache.token = data.access_token;
  tokenCache.expireAt = now + (data.expires_in || 7200) * 1000;
  return tokenCache.token;
}

/**
 * 发送订阅消息（未配置密钥/模板ID、openid 为空或开发身份时静默跳过）
 * @param {string} openid  接收者 openid
 * @param {string} templateId 订阅消息模板 ID（微信公众平台申请）
 * @param {Object} opts { page 点击跳转页面, data 模板数据 { thing1: {value}, ... } }
 * @returns {Promise<{skipped?: boolean, sent?: boolean, errcode?: number, error?: string}>}
 */
async function sendSubscribe(openid, templateId, opts = {}) {
  if (!isWxConfigured() || !openid || !templateId || String(openid).startsWith('dev_')) {
    return { skipped: true };
  }
  try {
    const token = await getAccessToken();
    const res = await fetch(
      'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(token),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touser: openid,
          template_id: templateId,
          page: opts.page || undefined,
          data: opts.data || {},
        }),
      }
    );
    const r = await res.json();
    if (r.errcode !== 0) {
      console.warn('[wxSubscribe] 发送失败:', r.errcode, r.errmsg);
      return { sent: false, errcode: r.errcode, error: r.errmsg };
    }
    return { sent: true };
  } catch (e) {
    console.warn('[wxSubscribe] 发送异常:', e.message);
    return { skipped: true, error: e.message };
  }
}

/**
 * 手机号快速验证组件 code 换手机号（phonenumber.getPhoneNumber 接口）
 * 供小程序 button open-type=getPhoneNumber 回调里的 detail.code 兑换明文手机号。
 * 未配置 WX_APPID/WX_SECRET 或 code 失效时抛错，由调用方降级为手动输入。
 */
async function getPhoneByCode(code) {
  if (!isWxConfigured()) throw new Error('服务端未配置微信密钥，无法解析授权手机号');
  if (!code) throw new Error('授权 code 为空');
  const token = await getAccessToken();
  const res = await fetch(
    'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=' + encodeURIComponent(token),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }
  );
  const data = await res.json();
  if (data.errcode !== 0 || !data.phone_info) {
    throw new Error('微信手机号授权失败：' + (data.errmsg || '未知错误'));
  }
  return data.phone_info.purePhoneNumber || data.phone_info.phoneNumber;
}

/**
 * 按 C端用户ID发送订阅消息（内部查 openid；用户不存在或无 openid 时跳过）
 * 注意：data 字段名（thing1/character_string1/time2 等）必须与微信后台申请的模板一致，
 *       运营申请模板后如字段不同，请调整各调用点构造的 data 键名。
 */
async function notifyUser(userId, templateId, opts = {}) {
  if (!templateId || !userId) return { skipped: true };
  const [rows] = await pool.query('SELECT openid FROM c_end_user WHERE id = ?', [userId]);
  return sendSubscribe(rows.length ? rows[0].openid : null, templateId, opts);
}

/**
 * F-102 生成「无数量限制小程序码」（getwxacodeunlimit）
 * scene 为扫码携带参数（最长32字符，如 f_12），page 为落地页（pages/quote/quote）
 * 返回 PNG 图片 Buffer；未配置密钥抛「未配置微信密钥」由调用方降级
 */
async function getWxacodeUnlimit(scene, page) {
  if (!isWxConfigured()) throw new Error('未配置微信密钥');
  const token = await getAccessToken();
  const res = await fetch(
    'https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=' + encodeURIComponent(token),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scene: String(scene),
        page: String(page),
        width: 430,
        auto_color: false,
        line_color: { r: 37, g: 99, b: 235 },
        is_hyaline: false,
      }),
    }
  );
  const buf = Buffer.from(await res.arrayBuffer());
  // 微信失败时返回 JSON（errcode/errmsg），成功才是 PNG（以 0x89PNG 头识别）
  if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
    let msg = '未知错误';
    try { msg = JSON.parse(buf.toString('utf8')).errmsg || msg; } catch (e) { /* 非 JSON 按未知错误 */ }
    throw new Error('生成小程序码失败：' + msg);
  }
  return buf;
}

module.exports = { isWxConfigured, getAccessToken, getPhoneByCode, sendSubscribe, notifyUser, getWxacodeUnlimit };
