/**
 * 运维告警通道（P1 监控告警）：
 *   1) 企微/钉钉群机器人 webhook（ALERT_WEBHOOK_URL，可选，未配置静默跳过）
 *   2) 站内消息兜底——给全部启用管理员发 c_message(type='system')，
 *      管理后台消息中心天然可见（alertToAdmin 带冷却去重，防告警风暴）
 * 所有方法内部吞错：告警失败绝不能影响业务主流程。
 */
const axios = require('axios');
const { pool } = require('../config/db');

// 冷却表：同 key 在 COOLDOWN_MS 内只发一次（内存版，单实例部署够用）
const COOLDOWN_MS = 30 * 60 * 1000;
const lastSentAt = new Map();

function inCooldown(key) {
  const t = lastSentAt.get(key);
  if (t && Date.now() - t < COOLDOWN_MS) return true;
  lastSentAt.set(key, Date.now());
  // 简单防膨胀
  if (lastSentAt.size > 200) {
    for (const [k, v] of lastSentAt) { if (Date.now() - v >= COOLDOWN_MS) lastSentAt.delete(k); }
  }
  return false;
}

/** webhook 推送（按 URL 特征适配企微/钉钉报文格式） */
async function pushWebhook(text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return { skipped: true };
  const isDingTalk = /oapi\.dingtalk\.com/.test(url);
  const body = isDingTalk
    ? { msgtype: 'text', text: { content: '[印刷报价系统] ' + text } }
    : { msgtype: 'markdown', markdown: { content: '[印刷报价系统] ' + text } };
  try {
    const res = await axios.post(url, body, { timeout: 8000 });
    const code = res.data && (res.data.errcode !== undefined ? res.data.errcode : 0);
    return { sent: code === 0, raw: res.data };
  } catch (e) {
    console.warn('[alert] webhook 推送失败:', e.message);
    return { sent: false, error: e.message };
  }
}

/**
 * 发运维告警：webhook（若配置）+ 管理员站内信（若 alertToAdmin）
 * @param {string} key   去重键（如 'cron_tick'），同 key 30 分钟冷却
 * @param {string} text  告警内容
 * @param {Object} opts  { alertToAdmin: 是否额外发管理员站内信, force: 忽略冷却 }
 */
async function send(key, text, opts = {}) {
  try {
    if (!opts.force && inCooldown(key)) return { cooldown: true };
    const results = { key };
    results.webhook = await pushWebhook(text);
    if (opts.alertToAdmin) results.adminMsg = await notifyAdmins(key, text);
    return results;
  } catch (e) {
    console.warn('[alert] 告警发送异常（已忽略）:', e.message);
    return { error: e.message };
  }
}

/** 给启用中的管理员逐个发站内消息（admin 消息中心按 user_id=? AND type='system' 读取） */
async function notifyAdmins(key, content) {
  try {
    const [admins] = await pool.query('SELECT id FROM admin_user WHERE status = 1');
    let inserted = 0;
    for (const a of admins) {
      await pool.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'system', '系统告警', ?, 'alert', NULL)`,
        [a.id, String(content).slice(0, 480)]
      );
      inserted++;
    }
    return { adminCount: inserted };
  } catch (e) {
    console.warn('[alert] 管理员站内信失败:', e.message);
    return { error: e.message };
  }
}

module.exports = { send, notifyAdmins, pushWebhook };
