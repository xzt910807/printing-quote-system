const express = require('express');
const router = express.Router();
const { ok, fail, toCsv, sendCsv, maskPhone } = require('../utils/helpers');
const { pool } = require('../config/db');
const matchService = require('../services/matchService');
const orderService = require('../services/orderService');
const logisticsService = require('../services/logisticsService');
const wxpay = require('../services/wxpay');
const wxService = require('../services/wxService');
const { requireAdmin, requireUser, optionalUser } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');
const catalog = require('../services/catalogService');
const guard = require('../services/contentGuard');

/**
 * GET /api/c/config
 * C端公开配置（小程序启动时拉取）：订阅消息模板ID等
 */
router.get('/config', (req, res) => {
  res.json(ok({
    subscribeTmplIds: [
      process.env.WX_TMPL_ORDER_ACCEPTED,
      process.env.WX_TMPL_ORDER_SHIPPED,
      process.env.NEWS_SUBSCRIBE_TEMPLATE_ID,
    ].filter(Boolean),
    newsSubscribeTmplId: process.env.NEWS_SUBSCRIBE_TEMPLATE_ID || '',
    // Stage9 产品类型联动配置（印刷方式/材料/工艺白名单），小程序端据此收窄可选项
    productConfig: catalog.baseData.productConfig || {},
    // 028：后道工艺清单随目录动态下发（仅 code/name，无价格），小程序端不再写死——
    // 目录新增/停用工序，C 端选项与一句话解析同步生效，无需改小程序代码
    finishingProcesses: Object.values(catalog.baseData.finishing || {})
      .map((r) => ({ code: r.code, name: r.name })),
  }));
});

/**
 * POST /api/c/quote
 * C端报价 + 匹配工厂列表
 */
router.post('/quote', optionalUser, async (req, res) => {
  try {
    // 已登录用户自动关联 user_id；匿名询价照常可用（锁定模式例外：后端强制登录+绑手机）
    const data = await matchService.createCInquiry({ ...req.body, userId: req.user ? req.user.id : null });
    res.json(ok(data));
  } catch (err) {
    console.error(err);
    res.status(err.status || 400).json(fail(err.message, err.status || 400));
  }
});

/**
 * GET /api/c/my-inquiries
 * 我的询价列表（需登录；工厂联系方式仅接单后下发）
 * 分页 + 服务端搜索（单号/产品类型/工厂名）；顶部统计全量不受 keyword 影响
 */
router.get('/my-inquiries', requireUser, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 50);
    const keyword = String(req.query.keyword || '').trim().slice(0, 50);
    const where = ['ci.user_id = ?'];
    const params = [req.user.id];
    if (keyword) {
      const like = '%' + keyword + '%';
      where.push('(ci.inquiry_no LIKE ? OR ci.product_type LIKE ? OR f.name LIKE ?)');
      params.push(like, like, like);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT ci.id, ci.inquiry_no, ci.product_type, ci.print_mode, ci.quantity,
              ci.length_m, ci.width_m, ci.height_m,
              ci.material_type, ci.material_code, ci.color_count, ci.processes,
              ci.status, ci.created_at, ci.accepted_at, ci.matched_factory_id, ci.expires_at,
              ci.factory_quoted_price, ci.factory_quoted_at, ci.factory_quote_expires_at,
              ci.factory_quote_remark, ci.user_confirmed_at,
              ci.design_status,
              -- 系统报价存的是 finalPrice(含税总价), 旧键 totalPrice 作兜底; CAST 统一两位小数
              CAST(COALESCE(
                JSON_UNQUOTE(JSON_EXTRACT(ci.system_quote, '$.finalPrice')),
                JSON_UNQUOTE(JSON_EXTRACT(ci.system_quote, '$.totalPrice'))
              ) AS DECIMAL(12,2)) AS total_price,
              f.name AS factory_name, f.contact AS factory_contact, f.phone AS factory_phone
       FROM c_inquiry ci
       LEFT JOIN factory f ON ci.matched_factory_id = f.id
       ${whereSql}
       ORDER BY ci.created_at DESC, ci.id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM c_inquiry ci
       LEFT JOIN factory f ON ci.matched_factory_id = f.id ${whereSql}`,
      params
    );
    // 顶部统计（询价数/进行中/已下单）全量口径, 分页后不能再用当页列表计数
    const [statRows] = await pool.query(
      'SELECT status, COUNT(*) AS c FROM c_inquiry WHERE user_id = ? GROUP BY status',
      [req.user.id]
    );
    const byStatus = {};
    statRows.forEach((s) => { byStatus[s.status] = Number(s.c); });
    const sum = (keys) => keys.reduce((a, k) => a + (byStatus[k] || 0), 0);
    const total = Number(cnt.total);
    rows.forEach((r) => {
      // 报价有效期（P1-8）：过期标记，前端显示「价格已失效，请重新报价」
      r.expired = !!(r.expires_at && new Date(r.expires_at) < new Date());
      // 017 工厂报价有效期：过期后不可确认，前端显示「报价已过期」
      r.factory_quote_expired = !!(r.factory_quote_expires_at && new Date(r.factory_quote_expires_at) < new Date());
      // 联系方式仅接单后可见（factory_quoted/user_confirmed 属于新流程在途态，同样不下发）
      if (!['accepted', 'converted'].includes(r.status)) {
        r.factory_contact = null;
        r.factory_phone = null;
      }
      // processes 为 JSON 字符串，解析后供「再次询价」复用参数
      if (typeof r.processes === 'string') {
        try { r.processes = JSON.parse(r.processes); } catch (e) { r.processes = []; }
      }
      if (!r.processes) r.processes = [];
      // 下发生产参数人读文案（尺寸/印刷方式/材质/色数/工艺）, 询价卡摘要展示
      Object.assign(r, catalog.describeSpec(r));
    });
    res.json(ok({
      total, page, pageSize, hasMore: page * pageSize < total,
      stats: {
        total: sum(Object.keys(byStatus)),
        active: sum(['quoted', 'matched', 'factory_quoted']),
        accepted: sum(['accepted', 'converted', 'user_confirmed']),
      },
      list: rows,
    }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /api/c/bind-inquiries
 * 匿名询价认领：登录成功后，把登录前本地记录的匿名询价并入当前账号
 * 仅绑定 user_id 为 NULL 的记录，防止抢占他人数据
 */
router.post('/bind-inquiries', requireUser, async (req, res) => {
  try {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : [])
      .map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 50);
    if (!ids.length) return res.json(ok({ updated: 0 }));
    const [ret] = await pool.query(
      'UPDATE c_inquiry SET user_id = ? WHERE id IN (?) AND user_id IS NULL',
      [req.user.id, ids]
    );
    res.json(ok({ updated: ret.affectedRows }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /api/c/bind-factory
 * 微信用户输邀请码绑定工厂身份（stage14 身份分流，方案B）
 * 校验码存在且未使用 → 事务内改 role + 标记用码；重复绑定/无效码报错
 * body: { code } → { role, factoryId, factoryName }
 */
router.post('/bind-factory', requireUser, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const code = String((req.body && req.body.code) || '').trim().toUpperCase();
    if (!code) throw new Error('请输入邀请码');

    const [users] = await conn.query('SELECT role FROM c_end_user WHERE id = ?', [req.user.id]);
    if (users.length && users[0].role === 'factory') throw new Error('已绑定工厂身份，请勿重复绑定');

    const [codes] = await conn.query(
      'SELECT id, factory_id, used FROM factory_invite_code WHERE code = ?', [code]
    );
    if (!codes.length) throw new Error('邀请码无效');
    if (codes[0].used) throw new Error('邀请码已被使用');

    const factoryId = codes[0].factory_id;
    const [factories] = await conn.query('SELECT id, name, status FROM factory WHERE id = ?', [factoryId]);
    if (!factories.length || !factories[0].status) throw new Error('对应工厂不存在或已停用');

    await conn.beginTransaction();
    // 乐观占位：并发重复用码时仅一个成功（used=0 条件二次校验）
    const [used] = await conn.query(
      'UPDATE factory_invite_code SET used = 1 WHERE id = ? AND used = 0', [codes[0].id]
    );
    if (!used.affectedRows) throw new Error('邀请码已被使用');
    await conn.query(
      "UPDATE c_end_user SET role = 'factory', factory_id = ? WHERE id = ?",
      [factoryId, req.user.id]
    );
    // 021 微信一键登录：绑定成功即把该微信 openid 关联到工厂 owner 员工账号（仅 owner 未关联时；
    // 该 openid 已关联其他工厂时由 uk_factory_user_openid 唯一索引拦截，忽略冲突不影响绑定主流程）
    const [[binder]] = await conn.query('SELECT openid FROM c_end_user WHERE id = ?', [req.user.id]);
    if (binder && binder.openid) {
      try {
        await conn.query(
          "UPDATE factory_user SET openid = ? WHERE factory_id = ? AND role = 'owner' AND openid IS NULL",
          [binder.openid, factoryId]
        );
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }
    await conn.commit();
    res.json(ok({ role: 'factory', factoryId, factoryName: factories[0].name }));
  } catch (err) {
    await conn.rollback();
    res.status(400).json(fail(err.message));
  } finally {
    conn.release();
  }
});

/**
 * GET /api/c/my-messages
 * 我的站内消息（需登录），分页 + 服务端搜索（标题/内容），返回全量未读数
 */
router.get('/my-messages', requireUser, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 50);
    const keyword = String(req.query.keyword || '').trim().slice(0, 50);
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (keyword) {
      const like = '%' + keyword + '%';
      where.push('(title LIKE ? OR content LIKE ?)');
      params.push(like, like);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT id, type, title, content, ref_type, ref_id, is_read, created_at
       FROM c_message ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM c_message ${whereSql}`,
      params
    );
    const [[unreadCnt]] = await pool.query(
      'SELECT COUNT(*) AS unread FROM c_message WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    rows.forEach((r) => { r.is_read = !!r.is_read; });
    const total = Number(cnt.total);
    res.json(ok({ total, page, pageSize, hasMore: page * pageSize < total, unread: unreadCnt.unread, list: rows }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /api/c/my-messages/read
 * 标记消息已读：{ id: 123 } 单条；{ all: true } 全部
 */
router.post('/my-messages/read', requireUser, async (req, res) => {
  try {
    const { id, all } = req.body || {};
    if (all) {
      const [ret] = await pool.query(
        'UPDATE c_message SET is_read = 1 WHERE user_id = ? AND is_read = 0',
        [req.user.id]
      );
      return res.json(ok({ updated: ret.affectedRows }));
    }
    if (!id) throw new Error('缺少 id 或 all 参数');
    const [ret] = await pool.query(
      'UPDATE c_message SET is_read = 1 WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    res.json(ok({ updated: ret.affectedRows }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/c/my-orders
 * 我的订单（需登录）：分页 + 服务端搜索（订单号/工厂名/来源询价单号）
 */
router.get('/my-orders', requireUser, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 50);
    const data = await orderService.listUserOrders(req.user.id, {
      status: req.query.status, page, pageSize, keyword: req.query.keyword,
    });
    // F-30：订单列表态脱敏——收货人电话与工厂电话（详情/对家联系走归属通道明文）
    data.list.forEach((o) => {
      o.contact_phone = maskPhone(o.contact_phone);
      o.factory_phone = maskPhone(o.factory_phone);
    });
    res.json(ok(data));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * GET /api/c/order/:id
 * 订单详情（本人）：完整规格/设计稿/地址快照/金额明细, 供订单详情页
 */
router.get('/order/:id', requireUser, async (req, res) => {
  try {
    const data = await orderService.getOrderDetail(parseInt(req.params.id, 10), req.user.id);
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * 收货地址簿（stage13）：CRUD + 设默认；订单用的是支付时的地址快照，改地址簿不影响历史订单
 */
router.get('/my-addresses', requireUser, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM user_address WHERE user_id = ? ORDER BY is_default DESC, id DESC',
      [req.user.id]
    );
    res.json(ok({ total: rows.length, list: rows }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

router.post('/address', requireUser, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.contactName || !String(b.contactName).trim()) throw new Error('请填写联系人姓名');
    if (!b.contactPhone || !/^1[3-9]\d{9}$/.test(String(b.contactPhone).trim())) {
      throw new Error('请填写正确的手机号');
    }
    if (!b.detailAddress || !String(b.detailAddress).trim()) throw new Error('请填写详细地址');
    const fields = [
      String(b.contactName).trim(), String(b.contactPhone).trim(),
      b.province || '', b.city || '', b.district || '', String(b.detailAddress).trim(),
    ];
    // 内容安全：收货人与详细地址会随单展示给工厂与快递员
    await guard.assertTextAllowed([
      { label: '收货人', value: fields[0] },
      { label: '详细地址', value: fields[5] },
    ], { openid: req.user.openid, scene: 'profile' });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      let id = parseInt(b.id, 10) || null;
      if (id) {
        const [rows] = await conn.query('SELECT id FROM user_address WHERE id = ? AND user_id = ?', [id, req.user.id]);
        if (!rows.length) throw new Error('地址不存在或不属于你');
        await conn.query(
          'UPDATE user_address SET contact_name=?, contact_phone=?, province=?, city=?, district=?, detail_address=? WHERE id=?',
          [...fields, id]
        );
      } else {
        const [ret] = await conn.query(
          'INSERT INTO user_address (user_id, contact_name, contact_phone, province, city, district, detail_address) VALUES (?,?,?,?,?,?,?)',
          [req.user.id, ...fields]
        );
        id = ret.insertId;
      }
      // 设默认：事务内清同用户其他默认（每用户至多一个默认地址）
      if (b.isDefault || b.setDefault) {
        await conn.query('UPDATE user_address SET is_default = 0 WHERE user_id = ? AND id != ?', [req.user.id, id]);
        await conn.query('UPDATE user_address SET is_default = 1 WHERE id = ?', [id]);
      }
      await conn.commit();
      res.json(ok({ id }));
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

router.delete('/address/:id', requireUser, async (req, res) => {
  try {
    const [ret] = await pool.query('DELETE FROM user_address WHERE id = ? AND user_id = ?', [
      parseInt(req.params.id, 10), req.user.id,
    ]);
    if (!ret.affectedRows) throw new Error('地址不存在或不属于你');
    res.json(ok({ deleted: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/c/order/:id/status
 * 用户操作订单：{ action: 'complete' | 'cancel' }
 */
router.post('/order/:id/status', requireUser, async (req, res) => {
  try {
    const data = await orderService.updateStatus({
      orderId: parseInt(req.params.id, 10),
      action: req.body && req.body.action,
      actor: 'user',
      actorId: req.user.id,
      extra: req.body || {},
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/c/order/:id/logistics
 * 订单物流详情（本人订单）：发货信息 + 轨迹（快递100 未配置时降级为空轨迹）
 */
router.get('/order/:id/logistics', requireUser, async (req, res) => {
  try {
    const data = await logisticsService.getOrderLogistics(parseInt(req.params.id, 10), {
      type: 'user', id: req.user.id,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/c/order/:id/pay
 * 支付订单（双轨）：
 *   payMethod=wechat  → JSAPI 统一下单，返回 wx.requestPayment 参数（未配商户号时优雅提示）
 *   payMethod=offline → 标记线下转账，工厂确认收款后订单生效
 *   缺省/mock        → 模拟支付（演示/开发用，直接落 paid）
 * body: { payMethod?, addressId? } —— addressId 确认收货地址并落快照（不传自动取默认地址）
 */
router.post('/order/:id/pay', requireUser, async (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const body = req.body || {};
    const payMethod = body.payMethod || body.method || 'mock';
    if (payMethod === 'wechat') {
      const data = await wxpay.createOrderPay(orderId, req.user);
      return res.json(ok(data));
    }
    if (payMethod === 'offline') {
      const data = await orderService.markOfflinePay({
        orderId,
        userId: req.user.id,
        addressId: body.addressId ? parseInt(body.addressId, 10) : null,
      });
      return res.json(ok(data));
    }
    const data = await orderService.payOrder({
      orderId,
      userId: req.user.id,
      method: 'mock',
      addressId: body.addressId ? parseInt(body.addressId, 10) : null,
    });
    res.json(ok(data, { notice: '当前为模拟支付（真实支付渠道未接入）' }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/c/pay/notify
 * 微信支付结果回调（v3，resource AES-256-GCM 加密，无鉴权——微信服务器调用）
 * P0 安全链：验签（平台证书/公钥模式，见 wxpay.verifyNotify）→ 解密 →
 *             商户号核对 → 金额核对（markPaidByTradeNo 内），任一步失败均不落库。
 * 验签不通过返 401（伪回调）；系统异常返 5xx 让微信按其重试策略再推。
 * 注意：WXPAY_NOTIFY_URL 必须公网可达并指向本路径
 */
router.post('/pay/notify', async (req, res) => {
  try {
    const { resource } = req.body || {};
    if (!resource) return res.status(400).json({ code: 'FAIL', message: 'missing resource' });
    try {
      await wxpay.verifyNotify(req);
    } catch (e) {
      console.error('[PAY] 回调验签失败 ip=' + (req.headers['x-forwarded-for'] || req.socket.remoteAddress) + ':', e.message);
      return res.status(401).json({ code: 'FAIL', message: 'verify failed' });
    }
    const plain = wxpay.decryptNotify(resource);
    wxpay.assertNotifyMchid(plain);
    if (plain.trade_state === 'SUCCESS' && plain.out_trade_no) {
      const paidFen = plain.amount && plain.amount.total;
      const r = await orderService.markPaidByTradeNo(plain.out_trade_no, plain.transaction_id, paidFen);
      if (!r.matched) console.warn('[PAY] 回调订单未匹配 out_trade_no=' + plain.out_trade_no);
      if (r.amountMismatch) {
        // 金额不一致：应答 SUCCESS 停止重试（重试也不会过），已记错误日志由人工核查
        console.error('[PAY] 回调金额不一致已拦截 orderNo=' + plain.out_trade_no);
      }
    }
    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (err) {
    console.error('[PAY] 回调处理失败:', err.message);
    res.status(500).json({ code: 'FAIL', message: err.message });
  }
});

/**
 * GET /api/c/order/list
 * 管理端：全部订单列表
 */
router.get('/order/list', requireAdmin, requirePermission('order:view'), async (req, res) => {
  try {
    const data = await orderService.listAllOrders({
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 50,
      status: req.query.status,
      keyword: req.query.keyword,
      escrowStatus: req.query.escrowStatus,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * GET /api/c/admin/order/:id/logistics
 * 管理端查看订单物流（兜底排查用）：发货信息 + 轨迹
 */
router.get('/admin/order/:id/logistics', requireAdmin, requirePermission('order:view'), async (req, res) => {
  try {
    const data = await logisticsService.getOrderLogistics(parseInt(req.params.id, 10), {
      type: 'admin', id: 0,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/c/admin/order/:id/status
 * 管理端操作订单（兜底代操作）：{ action: 'confirm'|'produce'|'ship'|'complete'|'cancel' }
 */
router.post('/admin/order/:id/status', requireAdmin, requirePermission('order:manage'), async (req, res) => {
  try {
    const data = await orderService.updateStatus({
      orderId: parseInt(req.params.id, 10),
      action: req.body && req.body.action,
      actor: 'admin',
      actorId: 0,
      extra: req.body || {},
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/c/admin/order/:id/refund
 * 管理端退款：wechat+已配置先走微信原路退款；线下/mock 直接标记（退款人工执行）。
 * 前置状态必须是 refunding（已支付订单取消或用户申请后进入待退款）
 */
router.post('/admin/order/:id/refund', requireAdmin, requirePermission('order:manage'), async (req, res) => {
  try {
    const data = await orderService.confirmRefund({
      orderId: parseInt(req.params.id, 10),
      reason: req.body && req.body.reason,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/c/inquiry/list
 * C端询价列表（管理后台使用）
 * ⚠️ 必须写在 /inquiry/:id 之前，否则 'list' 会被当成 :id 捕获
 */
router.get('/inquiry/list', requireAdmin, requirePermission('c_inquiry:view'), async (req, res) => {
  try {
    const { page = 1, pageSize = 50, status, keyword } = req.query;

    const conditions = [];
    const params = [];
    if (status) { conditions.push('ci.status = ?'); params.push(status); }
    // stage14 列表搜索：询价号 / 联系人 / 联系电话 模糊匹配
    if (keyword && String(keyword).trim()) {
      const like = '%' + String(keyword).trim() + '%';
      conditions.push('(ci.inquiry_no LIKE ? OR ci.contact_name LIKE ? OR ci.contact_phone LIKE ?)');
      params.push(like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    const [rows] = await pool.query(
      `SELECT ci.*,
              (SELECT COUNT(*) FROM c_inquiry_quote_view qv WHERE qv.inquiry_id = ci.id) AS view_count,
              (SELECT COUNT(*) FROM c_inquiry_quote_view qv WHERE qv.inquiry_id = ci.id AND qv.selected = 1) AS selected_count
       FROM c_inquiry ci ${where} ORDER BY ci.id DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(pageSize), offset]
    );
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS total FROM c_inquiry ci ${where}`,
      params
    );

    rows.forEach((r) => {
      if (typeof r.processes === 'string') {
        try { r.processes = JSON.parse(r.processes); } catch (e) { r.processes = []; }
      }
      if (!r.processes) r.processes = [];

      if (typeof r.system_quote === 'string') {
        try { r.system_quote = JSON.parse(r.system_quote); } catch (e) { r.system_quote = null; }
      }
    });

    res.json({
      success: true,
      data: rows,
      total: cnt[0].total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/c/inquiry/export
 * 导出C端询价 CSV（管理后台）
 * ⚠️ 必须写在 /inquiry/:id 之前，否则 'export' 会被当成 :id 捕获
 */
router.get('/inquiry/export', requireAdmin, requirePermission('c_inquiry:view'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ci.id, ci.inquiry_no, ci.product_type, ci.quantity, ci.status,
              ci.contact_name, ci.contact_phone, ci.created_at, ci.accepted_at,
              f.name AS matched_factory
       FROM c_inquiry ci
       LEFT JOIN factory f ON ci.matched_factory_id = f.id
       ORDER BY ci.id DESC`
    );
    const csv = toCsv([
      { key: 'id', label: 'ID' },
      { key: 'inquiry_no', label: '询价号' },
      { key: 'product_type', label: '产品类型' },
      { key: 'quantity', label: '数量' },
      { key: 'status', label: '状态' },
      { key: 'matched_factory', label: '匹配工厂' },
      { key: 'contact_name', label: '联系人' },
      { key: 'contact_phone', label: '联系电话' },
      { key: 'created_at', label: '创建时间' },
      { key: 'accepted_at', label: '接单时间' },
    ], rows);
    sendCsv(res, 'inquiries.csv', csv);
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

/**
 * 询价归属校验（防陌生人对他人询价乱推送/窥视联系方式）
 * 规则：已归属（登录用户创建）的询价仅本人可查看/操作；
 * 匿名询价（user_id=NULL）放行匿名流程，但登录用户操作时顺带绑定归属，只被「抢注」一次。
 */
async function assertInquiryAccess(inquiryId, user) {
  const [rows] = await pool.query('SELECT id, user_id FROM c_inquiry WHERE id = ?', [inquiryId]);
  if (!rows.length) throw new Error('询价不存在');
  if (rows[0].user_id) {
    if (!user || rows[0].user_id !== user.id) throw new Error('无权操作该询价');
  } else if (user) {
    await pool.query('UPDATE c_inquiry SET user_id = ? WHERE id = ? AND user_id IS NULL', [user.id, inquiryId]);
  }
}

/**
 * POST /api/c/inquiry/:id/select-factory
 * 用户选择工厂，推送询价
 */
router.post('/inquiry/:id/select-factory', optionalUser, async (req, res) => {
  try {
    const inquiryId = req.params.id;
    await assertInquiryAccess(inquiryId, req.user);
    // F-11：已登录用户推送前必须已绑定手机号（匿名询价走手输联系人流程）
    if (req.user && !req.user.phone) {
      return res.status(403).json({ ...fail('请先授权手机号，以便工厂与您联系', 403), needPhone: true });
    }
    const { factoryId, contactName, contactPhone } = req.body;
    if (!factoryId) throw new Error('必须指定 factoryId');
    const data = await matchService.selectFactory({ inquiryId, factoryId, contactName, contactPhone });
    res.json(ok(data));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message));
  }
});

/**
 * POST /api/c/inquiry/:id/confirm-quote（017 新流程）
 * 用户确认工厂正式报价 → 生成订单（订单金额 = 工厂报价，非系统参考价）
 */
router.post('/inquiry/:id/confirm-quote', optionalUser, async (req, res) => {
  try {
    const inquiryId = parseInt(req.params.id, 10);
    const data = await matchService.confirmFactoryQuote({ inquiryId, user: req.user || null });
    res.json(ok(data, { notice: '订单已生成，请尽快支付' }));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message));
  }
});

/**
 * GET /api/c/factory/:factoryId/quote/:inquiryId（F-02/03/04）
 * 查看指定工厂对该询价的实时报价；询价过期返回 410
 */
router.get('/factory/:factoryId/quote/:inquiryId', optionalUser, async (req, res) => {
  try {
    const data = await matchService.getFactoryQuote({
      inquiryId: parseInt(req.params.inquiryId, 10),
      factoryId: parseInt(req.params.factoryId, 10),
      userId: req.user ? req.user.id : null,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message));
  }
});

/**
 * PUT /api/c/user/phone（F-11 配套：补齐/更换手机号）
 * body: { phone } 明文手机号，或 { code } 微信手机号快速验证组件 code（需配置 WX_APPID/WX_SECRET）
 */
router.put('/user/phone', requireUser, async (req, res) => {
  try {
    let phone = '';
    const body = req.body || {};
    if (body.code) {
      // 微信一键授权：code 换明文手机号，未配置密钥时抛错由前端降级手输
      phone = String(await wxService.getPhoneByCode(String(body.code).trim()));
    } else {
      phone = String(body.phone || '').trim();
    }
    if (!/^1\d{10}$/.test(phone)) throw new Error('手机号格式不正确');
    await pool.query('UPDATE c_end_user SET phone = ? WHERE id = ?', [phone, req.user.id]);
    res.json(ok({ phone }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/c/order/:id/rate（F-70：订单评分 1-5 星）
 */
router.post('/order/:id/rate', requireUser, async (req, res) => {
  try {
    const data = await matchService.rateOrder({
      orderId: parseInt(req.params.id, 10),
      userId: req.user.id,
      rating: (req.body || {}).rating,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message));
  }
});

/**
 * POST /api/c/order/:id/refund（F-56：用户申请退款）
 * 已支付且未发货（pending/confirmed/producing）的订单可申请；
 * 申请后进入待退款（refunding），工厂/平台确认后原路退回并站内信通知
 * body: { reason? }
 */
router.post('/order/:id/refund', requireUser, async (req, res) => {
  try {
    // 内容安全：退款理由会同步到工厂操作日志
    await guard.assertTextAllowed(
      [{ label: '退款理由', value: (req.body || {}).reason }],
      { openid: req.user.openid, scene: 'chat' }
    );
    const data = await orderService.applyRefund({
      orderId: parseInt(req.params.id, 10),
      userId: req.user.id,
      reason: (req.body || {}).reason,
    });
    res.json(ok(data, { notice: '退款申请已提交，确认后款项将原路退回' }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/c/inquiry/:id
 * C端查询询价状态（工厂接单后返回其联系方式）
 * ⚠️ 必须放在 /inquiry/list 之后，否则 'list' 会被 :id 捕获
 */
router.get('/inquiry/:id', optionalUser, async (req, res) => {
  try {
    await assertInquiryAccess(req.params.id, req.user);
    const data = await matchService.getInquiryStatus(req.params.id);
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * DELETE /api/c/inquiry/:id
 * 删除询价（连带清理推送记录，管理后台）
 */
router.delete('/inquiry/:id', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    await conn.beginTransaction();
    const [ret] = await conn.query('DELETE FROM c_inquiry WHERE id = ?', [id]);
    if (!ret.affectedRows) throw new Error('询价不存在');
    await conn.query('DELETE FROM factory_inquiry_push WHERE inquiry_id = ?', [id]);
    await conn.commit();
    res.json(ok({ id, deleted: true }));
  } catch (err) {
    await conn.rollback();
    res.status(400).json(fail(err.message));
  } finally {
    conn.release();
  }
});

module.exports = router;