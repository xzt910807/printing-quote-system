/**
 * F-57：平台服务费台账
 * 订单支付成功（mock 模拟 / 微信回调 / 工厂确认线下收款）时记录服务费应收，
 * 订单维度幂等（uk_order），分账执行（F-44）待微信支付服务商资质下发后对接。
 */
const { pool } = require('../config/db');
const { round } = require('../utils/helpers');

// 服务费率：环境变量 SERVICE_FEE_RATE 可覆盖（默认 5%，上限 50% 与微信分账比例约束一致）
const FEE_RATE = Math.min(Math.max(parseFloat(process.env.SERVICE_FEE_RATE, 10) || 0.05, 0), 0.5);

/**
 * 记录一笔订单的服务费（幂等：同订单重复调用仅首笔生效）
 * @param {object} p { orderId, payMethod: 'wechat'|'offline'|'mock' }
 */
async function recordFee({ orderId, payMethod }) {
  try {
    const [rows] = await pool.query(
      'SELECT id, order_no, inquiry_id, total_price, shipping_fee, sample_fee FROM order_main WHERE id = ?',
      [orderId]
    );
    if (!rows.length) return;
    const o = rows[0];
    const amount = round(
      (Number(o.total_price) || 0) + (Number(o.shipping_fee) || 0) + (Number(o.sample_fee) || 0), 2
    );
    if (amount <= 0) return;
    const feeAmount = round(amount * FEE_RATE, 2);
    let inquiryNo = null;
    if (o.inquiry_id) {
      const [iq] = await pool.query('SELECT inquiry_no FROM c_inquiry WHERE id = ?', [o.inquiry_id]);
      if (iq.length) inquiryNo = iq[0].inquiry_no;
    }
    const [ret] = await pool.query(
      `INSERT IGNORE INTO platform_fee_ledger
         (order_id, order_no, inquiry_no, order_amount, fee_rate, fee_amount, pay_method, status)
       VALUES (?,?,?,?,?,?,?, 'pending')`,
      [o.id, o.order_no, inquiryNo, amount, FEE_RATE, feeAmount, payMethod || 'mock']
    );
    if (ret.affectedRows) {
      console.log('[fee] 服务费台账 orderNo=' + o.order_no + ' amount=' + amount + ' fee=' + feeAmount + ' (' + payMethod + ')');
    }
  } catch (e) {
    // 台账失败不影响支付主流程，仅告警
    console.error('[feeService] 台账记录失败 orderId=' + orderId + ':', e.message);
  }
}

/** 管理端台账列表 */
async function listLedger({ status, page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const [[cnt]] = await pool.query('SELECT COUNT(*) c FROM platform_fee_ledger' + w, params);
  const offset = (Math.max(1, page) - 1) * pageSize;
  const [rows] = await pool.query(
    'SELECT * FROM platform_fee_ledger' + w + ' ORDER BY id DESC LIMIT ? OFFSET ?',
    [...params, pageSize, offset]
  );
  const [[sum]] = await pool.query(
    'SELECT COALESCE(SUM(fee_amount),0) s FROM platform_fee_ledger' + w, params
  );
  return { total: cnt.c, feeTotal: round(Number(sum.s), 2), list: rows };
}

module.exports = { recordFee, listLedger, FEE_RATE };
