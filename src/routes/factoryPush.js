const express = require('express');
const router = express.Router();
const { ok, fail } = require('../utils/helpers');
const { requireFactory } = require('../middlewares/auth');
const { requirePermission, permsForRole } = require('../config/permissions');
const matchService = require('../services/matchService');
const orderService = require('../services/orderService');
const logisticsService = require('../services/logisticsService');
const opLog = require('../services/opLogService');

// F-158：订单推进动作 → 操作日志动作编码
const ACTION_LOG_MAP = {
  confirm: 'order_confirm',
  produce: 'order_produce',
  ship: 'order_ship',
  cancel: 'order_cancel',
  sendSample: 'order_sample_send',
  confirmSample: 'order_sample_confirm',
};

// 分页参数统一收口：页码≥1, 每页默认 20 上限 50, 关键词截 50 字符（与 C 端列表同契约）
function pageParams(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const keyword = String(req.query.keyword || '').trim().slice(0, 50);
  return { page, pageSize, keyword };
}

// 工厂查看自己的询价列表（令牌对应工厂必须与 :factoryId 一致，防冒充）
router.get('/:factoryId/inquiries', requireFactory, requirePermission('inquiry:view'), async (req, res) => {
  try {
    const { page, pageSize, keyword } = pageParams(req);
    const data = await matchService.listFactoryInquiries(req.factory.id, {
      status: req.query.status, keyword, page, pageSize,
    });
    res.json(ok({ total: data.total, page, pageSize, hasMore: page * pageSize < data.total, list: data.list }));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

// 工厂接单/拒单（只能操作推给自己工厂的询价；事务内幂等，防重复接单）
router.post('/inquiry/:pushId/respond', requireFactory, requirePermission('inquiry:accept'), async (req, res) => {
  try {
    const { response } = req.body;
    if (!['accept', 'decline'].includes(response)) throw new Error('response 必须为 accept 或 decline');
    const data = await matchService.respondInquiry({
      pushId: req.params.pushId,
      response,
      factoryId: req.factory.id,
    });
    // F-158：接单/拒单落操作日志
    opLog.logOp({
      factoryId: req.factory.id,
      factoryUser: req.factoryUser,
      action: response === 'accept' ? 'accept' : 'decline',
      detail: `询价推送 #${req.params.pushId}`
        + (data.inquiryId ? `（询价 #${data.inquiryId}）` : '')
        + (data.orderNo ? `，生成订单 ${data.orderNo}` : ''),
      req,
    });
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// 017 新流程：工厂正式报价（matched → factory_quoted，用户确认后才生成订单）
// body: { price, remark?, validDays?, designFee? } — price 为工厂正式报价金额（元）
// 021 designFee：询价声明「需要设计」时工厂可单列设计费（计入总价，用户确认弹窗可见）
router.post('/inquiry/:pushId/quote', requireFactory, requirePermission('inquiry:accept'), async (req, res) => {
  try {
    const b = req.body || {};
    const data = await matchService.factoryQuoteInquiry({
      pushId: req.params.pushId,
      price: b.price,
      remark: b.remark,
      validDays: b.validDays,
      designFee: b.designFee,
      factoryId: req.factory.id,
    });
    opLog.logOp({
      factoryId: req.factory.id,
      factoryUser: req.factoryUser,
      action: 'factory_quote',
      detail: `询价推送 #${req.params.pushId}（询价 #${data.inquiryId}）正式报价 ¥${data.factoryQuotedPrice}`
        + (data.designFee ? `，含设计费 ¥${data.designFee}` : ''),
      req,
    });
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// 工厂订单列表（本厂订单, 服务端分页 + 订单号/联系人搜索）
router.get('/:factoryId/orders', requireFactory, requirePermission('order:view'), async (req, res) => {
  try {
    const { page, pageSize, keyword } = pageParams(req);
    const data = await orderService.listFactoryOrders(req.factory.id, {
      status: req.query.status, keyword, page, pageSize,
    });
    res.json(ok({ total: data.total, page, pageSize, hasMore: page * pageSize < data.total, list: data.list }));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

// 工厂推进订单状态 body { action: 'confirm'|'produce'|'ship'|'cancel', weightKg?, expressCompany?, expressNo? }
// stage13：confirm 可携带 weightKg（按重运费模板必填）；ship 必须携带 expressCompany+expressNo
router.post('/order/:id/status', requireFactory, async (req, res) => {
  try {
    // F-26：按动作分流权限——发货需 order:ship，其余推进（确认/生产/取消）需 order:manage
    const action = req.body && req.body.action;
    const needPerm = action === 'ship' ? 'order:ship' : 'order:manage';
    if (!permsForRole(req.factoryUser.role).includes(needPerm)) {
      return res.status(403).json(fail('无权执行该操作（缺少权限：' + needPerm + '）', 403));
    }
    const data = await orderService.updateStatus({
      orderId: parseInt(req.params.id, 10),
      action: req.body && req.body.action,
      actor: 'factory',
      actorId: req.factory.id,
      extra: req.body || {},
    });
    // F-158：订单推进落操作日志
    const act = req.body && req.body.action;
    opLog.logOp({
      factoryId: req.factory.id,
      factoryUser: req.factoryUser,
      action: ACTION_LOG_MAP[act] || 'order_status',
      detail: `订单 ${data.orderNo || '#' + data.orderId}：${data.from} → ${data.to}`
        + (act === 'ship' && req.body.expressNo ? `（${req.body.expressCompany || ''} ${req.body.expressNo}）` : ''),
      req,
    });
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// 工厂查看订单物流（本厂订单）：发货信息 + 轨迹
router.get('/order/:id/logistics', requireFactory, requirePermission('order:view'), async (req, res) => {
  try {
    const data = await logisticsService.getOrderLogistics(parseInt(req.params.id, 10), {
      type: 'factory', id: req.factory.id,
    });
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// 工厂确认线下收款（用户选择线下转账的订单，核实到账后标记生效）
router.post('/order/:id/offline-paid', requireFactory, requirePermission('finance:view'), async (req, res) => {
  try {
    const data = await orderService.markOfflinePaid({
      orderId: parseInt(req.params.id, 10),
      factoryId: req.factory.id,
    });
    // F-158：收款确认落操作日志
    opLog.logOp({
      factoryId: req.factory.id,
      factoryUser: req.factoryUser,
      action: 'offline_paid',
      detail: `订单 ${data.orderNo || '#' + req.params.id} 确认线下收款`,
      req,
    });
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// 工厂确认退款（F-56）：待退款订单（用户申请/取消已支付订单）确认后原路退回并通知用户
router.post('/order/:id/refund-confirm', requireFactory, requirePermission('finance:view'), async (req, res) => {
  try {
    const data = await orderService.confirmRefund({
      orderId: parseInt(req.params.id, 10),
      factoryId: req.factory.id,
      reason: req.body && req.body.reason,
    });
    // F-158：退款确认落操作日志
    opLog.logOp({
      factoryId: req.factory.id,
      factoryUser: req.factoryUser,
      action: 'refund_confirm',
      detail: `订单 ${data.orderNo} 确认退款（渠道：${data.channel}）`,
      req,
    });
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;
