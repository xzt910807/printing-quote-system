/**
 * 交易担保(分账)服务
 * 单商户号模式：资金入平台 → profit_sharing=true 冻结 → 确认收货后解冻 → 线下结算
 *
 * 开关设计：
 *   WXPAY_ESCROW_ENABLED=1 → 启用担保链路（需同时 wxpay.isConfigured()==true 才调 API）
 *   WXPAY_ESCROW_ENABLED=0/未配 → 全降级：不标 frozen不解冻，pay_status=paid 后资金直接可用
 */
const { pool } = require('../config/db');
const wxpay = require('./wxpay');

const PLATFORM_FEE_RATE = Number(process.env.WXPAY_PLATFORM_FEE_RATE || 0.03);
const AUTO_RELEASE_DAYS = Number(process.env.WXPAY_AUTO_RELEASE_DAYS || 7);
const ESCROW_ENABLED = process.env.WXPAY_ESCROW_ENABLED === '1';

function isEscrowActive() {
  return ESCROW_ENABLED;
}

function httpError(message, status) {
  const e = new Error(message); e.status = status; return e;
}

/**
 * 标记订单为担保冻结状态（支付回调成功后调用）
 * 未开启 ESCROW 时直接 return，保证 escrow_status 保持默认 'none'
 */
async function markFrozen(orderId) {
  if (!ESCROW_ENABLED) return;
  await pool.query("UPDATE order_main SET escrow_status = 'frozen' WHERE id = ? AND pay_status = 'paid'", [orderId]);
}

/**
 * 确认收货 → 解冻放款
 * 计算平台服务费，调用分账完结接口解冻全部资金，标记已放款
 */
async function confirmRelease(orderId, actor) {
  const [[order]] = await pool.query('SELECT * FROM order_main WHERE id = ?', [orderId]);
  if (!order) throw httpError('订单不存在', 404);
  if (actor === 'user' && order.user_id !== actor.id) throw httpError('无权操作', 403);
  if (order.escrow_status !== 'frozen') throw httpError('订单不处于冻结状态', 409);
  if (order.status !== 'shipped') throw httpError('仅已发货订单可确认放款', 409);

  const totalAmount = Number(order.total_price || 0) + Number(order.shipping_fee || 0) + Number(order.sample_fee || 0);
  const platformFee = Math.round(totalAmount * PLATFORM_FEE_RATE * 100) / 100;
  const factoryAmount = Math.round((totalAmount - platformFee) * 100) / 100;

  // 调用微信分账完结（解冻剩余资金给平台商户）——仅在 ESCROW 开关开启且 wxpay 已配时执行
  if (ESCROW_ENABLED && wxpay.isConfigured()) {
    try {
      const outOrderNo = `PS_${order.order_no}`;
      await wxpay.profitSharingFinish({
        orderNo: order.order_no,
        outOrderNo,
        description: '确认收货放款',
      });
      await pool.query(
        `INSERT INTO profit_sharing_log (order_id, action, request_body, response_body, success) VALUES (?,?,?,?,1)`,
        [orderId, 'finish', JSON.stringify({ outOrderNo }), JSON.stringify({ status: 'ok' })]
      );
    } catch (e) {
      await pool.query(
        `INSERT INTO profit_sharing_log (order_id, action, request_body, response_body, success) VALUES (?,?,?,?,0)`,
        [orderId, 'finish', JSON.stringify({ orderNo: order.order_no }), JSON.stringify({ error: e.message })]
      );
      // 分账失败不阻断放款（降级为线下结算）
      console.warn('[escrow] 分账完结调用失败，降级处理:', e.message);
    }
  }

  await pool.query(
    `UPDATE order_main SET escrow_status = 'released', platform_fee = ?, factory_amount = ?, released_at = NOW() WHERE id = ?`,
    [platformFee, factoryAmount, orderId]
  );
  return { orderId, platformFee, factoryAmount };
}

/**
 * 发起争议（冻结资金不动）
 */
async function disputeHold(orderId, userId, reason) {
  const [[order]] = await pool.query('SELECT id, escrow_status FROM order_main WHERE id = ? AND user_id = ?', [orderId, userId]);
  if (!order) throw httpError('订单不存在', 404);
  if (order.escrow_status !== 'frozen') throw httpError('当前状态不可发起争议', 409);

  // 标记争议（通过 issue_ticket 关联，escrow_status 保持 frozen）
  await pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
     VALUES (0, 'escrow_dispute', ?, ?, 'order', ?)`,
    ['订单争议', `订单 ${orderId} 用户发起争议：${(reason || '').slice(0, 200)}`, orderId]
  );
}

/**
 * 管理端仲裁
 */
async function arbitrate(orderId, { decision, refundPercent, note }) {
  const [[order]] = await pool.query('SELECT * FROM order_main WHERE id = ?', [orderId]);
  if (!order) throw httpError('订单不存在', 404);
  if (order.escrow_status !== 'frozen') throw httpError('订单不处于冻结状态', 409);

  if (decision === 'refund') {
    // 全额退款
    const totalFen = Math.round((Number(order.total_price || 0) + Number(order.shipping_fee || 0) + Number(order.sample_fee || 0)) * 100);
    if (wxpay.isConfigured() && order.pay_method === 'wechat') {
      const refundNo = `RF_${order.order_no}_${Date.now()}`;
      await wxpay.refund({ refundNo, orderNo: order.order_no, refundFen: totalFen, totalFen, reason: note || '平台仲裁退款' });
    }
    await pool.query("UPDATE order_main SET escrow_status = 'refunded', pay_status = 'refunded' WHERE id = ?", [orderId]);
  } else if (decision === 'release') {
    // 放款给工厂
    await confirmRelease(orderId, 'admin');
  } else if (decision === 'partial_refund') {
    // 部分退款
    const pct = Math.min(Math.max(Number(refundPercent) || 0, 0), 100);
    const totalFen = Math.round((Number(order.total_price || 0) + Number(order.shipping_fee || 0) + Number(order.sample_fee || 0)) * 100);
    const refundFen = Math.round(totalFen * pct / 100);
    if (wxpay.isConfigured() && order.pay_method === 'wechat' && refundFen > 0) {
      const refundNo = `PR_${order.order_no}_${Date.now()}`;
      await wxpay.refund({ refundNo, orderNo: order.order_no, refundFen, totalFen, reason: note || '平台仲裁部分退款' });
    }
    const releaseAmount = Math.round((totalFen - refundFen) / 100);
    const platformFee = Math.round(releaseAmount * PLATFORM_FEE_RATE * 100) / 100;
    const factoryAmount = Math.round((releaseAmount - platformFee) * 100) / 100;
    await pool.query(
      `UPDATE order_main SET escrow_status = 'partial_refund', platform_fee = ?, factory_amount = ?, released_at = NOW() WHERE id = ?`,
      [platformFee, factoryAmount, orderId]
    );
  } else {
    throw httpError('decision 必须为 refund/release/partial_refund', 400);
  }

  await pool.query(
    `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id) VALUES (?, 'escrow_arbitrate', ?, ?, 'order', ?)`,
    [order.user_id, '平台仲裁结果', `订单 ${order.order_no} 仲裁结果：${decision}${note ? '（' + note + '）' : ''}`, orderId]
  );
}

/**
 * 自动放款：发货超过 N 天未确认的订单
 */
async function autoReleaseExpired() {
  const [rows] = await pool.query(
    `SELECT id FROM order_main WHERE status = 'shipped' AND escrow_status = 'frozen'
     AND shipped_at < DATE_SUB(NOW(), INTERVAL ? DAY)`, [AUTO_RELEASE_DAYS]
  );
  let count = 0;
  for (const row of rows) {
    try { await confirmRelease(row.id, 'system'); count++; } catch (e) { /* skip */ }
  }
  if (count) console.log('[escrow] 自动放款', count, '笔');
  return count;
}

module.exports = { markFrozen, confirmRelease, disputeHold, arbitrate, autoReleaseExpired, isEscrowActive, PLATFORM_FEE_RATE, AUTO_RELEASE_DAYS, ESCROW_ENABLED };
