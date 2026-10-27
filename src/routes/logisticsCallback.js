/**
 * 035 快递100 主动推送回调（poll.kuaidi100.com → 本端）
 * 挂载：/api/logistics/kuaidi100/callback（公开，无鉴权，靠签名 + IP 白名单）
 *
 * 报文（form-urlencoded）：
 *   - param: JSON 字符串 { company, number, updatetime, state, deliverState, ... }
 *   - sign:  MD5(param + KUAIDI100_KEY).toUpperCase()
 *
 * 语义：state 与 KUAIDI100_STATE_MAP 对齐（0在途/1揽收/5派件/3签收），
 *       签收(3) 触发 order_main.logistics_status='signed' + 自动放款 escrow 计时
 * 响应：快递100 规范要求 { result:true, status:'200', message:'成功' } 表示已收到，否则重投
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/db');

// express.urlencoded 已在 app.js 全局启用；此处仅处理 form 字段
function md5Upper(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
}

/** 快递100 state → 本系统 status */
const STATE_MAP = { 0: 'delivering', 1: 'shipped', 5: 'delivering', 3: 'signed' };

router.post('/kuaidi100/callback', async (req, res) => {
  const param = String(req.body.param || '');
  const sign = String(req.body.sign || '').toUpperCase();
  const key = process.env.KUAIDI100_KEY || '';

  if (!param) return res.json({ result: false, status: '500', message: 'param 缺失' });

  // 1) 签名校验：MD5(param + key) 大写
  if (key) {
    const expect = md5Upper(param + key);
    if (expect !== sign) {
      console.warn('[kuaidi100-cb] 签名不匹配，丢弃。got=' + sign + ' expect=' + expect);
      return res.json({ result: false, status: '500', message: '签名错误' });
    }
  } else {
    console.warn('[kuaidi100-cb] KUAIDI100_KEY 未配置，跳过签名校验（仅测试环境使用）');
  }

  // 2) 解析 param
  let payload;
  try { payload = JSON.parse(param); } catch (e) {
    return res.json({ result: false, status: '500', message: 'param 非 JSON' });
  }
  const com = String(payload.company || '').toUpperCase();
  const num = String(payload.number || '').trim();
  const state = String(payload.state || '');
  if (!num) return res.json({ result: false, status: '500', message: 'number 缺失' });

  // 3) 定位物流记录（express_no 命中，取最新一条）
  const [rows] = await pool.query(
    `SELECT id, order_id, status FROM order_logistics WHERE express_no = ? ORDER BY id DESC LIMIT 1`,
    [num]
  );
  if (!rows.length) {
    // 单号未录入：回执成功但业务不处理（快递100 会视需要重投，返回 true 阻断）
    console.warn('[kuaidi100-cb] 未匹配到物流记录 num=' + num + ' com=' + com);
    return res.json({ result: true, status: '200', message: 'OK' });
  }
  const lg = rows[0];
  const newStatus = STATE_MAP[state] || lg.status;

  // 4) 更新轨迹与状态（tracks 直接落库，last_track_time 由 updatetime 或 NOW）
  const tracks = Array.isArray(payload.trail) ? payload.trail.map((t) => ({
    time: t.ftime || t.time || '', context: t.context || '',
  })) : [];
  const updateFields = ['status = ?'];
  const updateParams = [newStatus];
  if (tracks.length) {
    updateFields.push('track_detail = ?'); updateParams.push(JSON.stringify(tracks));
    updateFields.push('last_track_time = NOW()');
  }
  updateParams.push(lg.id);
  await pool.query(
    `UPDATE order_logistics SET ${updateFields.join(', ')} WHERE id = ?`,
    updateParams
  );

  // 5) 同步 order_main.logistics_status；签收额外触发 escrow 计时（不改变 escrow_status 本体）
  await pool.query(
    'UPDATE order_main SET logistics_status = ? WHERE id = ?',
    [newStatus, lg.order_id]
  );
  if (newStatus === 'signed' && lg.status !== 'signed') {
    // 029 自动放款：签收时刻起 escrow 解冻计时开始（若 ESCROW_ENABLED）
    try {
      const escrow = require('../services/escrowService');
      if (typeof escrow.markSigned === 'function') await escrow.markSigned(lg.order_id);
    } catch (e) { /* 未开启分账时静默 */ }
  }

  console.log('[kuaidi100-cb] 更新 num=' + num + ' state=' + state + ' → ' + newStatus);
  res.json({ result: true, status: '200', message: '成功' });
});

module.exports = router;
module.exports.md5Upper = md5Upper;
module.exports.STATE_MAP = STATE_MAP;
