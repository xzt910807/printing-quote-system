const { pool } = require('../config/db');
const { round } = require('../utils/helpers');
const wxSubscribe = require('./wxService');
const shippingService = require('./shippingService');
const logisticsService = require('./logisticsService');
const feeService = require('./feeService');
const wxpay = require('./wxpay');

/**
 * 订单状态流转规则
 * from: 允许的来源状态；to: 目标状态；by: 允许的操作方（factory=工厂端 user=用户端 admin=管理后台）
 */
const STATUS_ACTIONS = {
  confirm:  { from: ['pending'],              to: 'confirmed', by: ['factory', 'admin'] },
  // Stage13 修复：生产/发货前必须已支付（此前未支付即可推进，状态机与支付完全解耦）。
  // admin 为平台兜底（兼容线下收款），不受 requirePaid 限制。
  // 打样订单：客户确认样品（sample_confirmed）后同样需要已支付才能投产
  produce:  { from: ['confirmed', 'sample_confirmed'], to: 'producing', by: ['factory', 'admin'], requirePaid: true },
  ship:     { from: ['producing'],            to: 'shipped',   by: ['factory', 'admin'], requirePaid: true },
  complete: { from: ['shipped'],              to: 'completed', by: ['user', 'admin'] },
  cancel:   { from: ['pending', 'confirmed'], to: 'cancelled', by: ['user', 'factory', 'admin'] },
  // 打样流程（P1-9）：工厂确认后寄样 → 客户确认样品 → 才进入生产
  sendSample:    { from: ['confirmed'], to: 'sampling',         by: ['factory', 'admin'] },
  confirmSample: { from: ['sampling'],  to: 'sample_confirmed', by: ['user', 'admin'] },
};

// 状态变化后给用户的站内消息文案
const STATUS_MESSAGE = {
  confirmed: { title: '订单已确认', content: (o) => `订单 ${o.order_no} 已被工厂确认，等待安排生产。` },
  sampling: { title: '样品已寄出', content: (o) => `订单 ${o.order_no} 样品已寄出，收到后请核对并确认样品。` },
  sample_confirmed: { title: '样品已确认', content: (o) => `订单 ${o.order_no} 样品已确认，工厂将安排生产。` },
  producing: { title: '订单开始生产', content: (o) => `订单 ${o.order_no} 已开始生产，请耐心等待。` },
  shipped:   { title: '订单已发货', content: (o) => `订单 ${o.order_no} 已发货，请留意收货并及时确认。` },
  completed: { title: '订单已完成', content: (o) => `订单 ${o.order_no} 已完成，感谢您的信任！` },
  cancelled: { title: '订单已取消', content: (o) => `订单 ${o.order_no} 已取消。` },
};

/**
 * 用户端：我的订单（分页 + 服务端搜索）
 * keyword 命中：订单号 / 工厂名 / 来源询价单号（询价卡「查看订单」靠询价单号检索兼容翻页外定位）
 */
async function listUserOrders(userId, { status, page = 1, pageSize = 20, keyword } = {}) {
  const conditions = ['o.user_id = ?'];
  const params = [userId];
  if (status) { conditions.push('o.status = ?'); params.push(status); }
  if (keyword && String(keyword).trim()) {
    const like = '%' + String(keyword).trim().slice(0, 50) + '%';
    conditions.push('(o.order_no LIKE ? OR f.name LIKE ? OR ci.inquiry_no LIKE ?)');
    params.push(like, like, like);
  }
  const where = 'WHERE ' + conditions.join(' AND ');
  const [rows] = await pool.query(
    `SELECT o.*, f.name AS factory_name, f.contact AS factory_contact, f.phone AS factory_phone,
            ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs
     FROM order_main o LEFT JOIN factory f ON o.factory_id = f.id
     LEFT JOIN c_inquiry ci ON o.inquiry_id = ci.id
     ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(pageSize, 10), (parseInt(page, 10) - 1) * parseInt(pageSize, 10)]
  );
  const [cnt] = await pool.query(
    `SELECT COUNT(*) AS total FROM order_main o
     LEFT JOIN factory f ON o.factory_id = f.id
     LEFT JOIN c_inquiry ci ON o.inquiry_id = ci.id ${where}`,
    params
  );
  const total = Number(cnt[0].total);
  return { total, page: parseInt(page, 10), pageSize: parseInt(pageSize, 10), hasMore: page * pageSize < total, list: rows };
}

/**
 * 工厂端：本厂订单
 */
async function listFactoryOrders(factoryId, status) {
  let sql = `SELECT o.*, u.nickname AS user_nickname,
                    ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs
             FROM order_main o LEFT JOIN c_end_user u ON o.user_id = u.id
             LEFT JOIN c_inquiry ci ON o.inquiry_id = ci.id
             WHERE o.factory_id = ?`;
  const params = [factoryId];
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  sql += ' ORDER BY o.created_at DESC, o.id DESC LIMIT 100';
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * 管理端：全部订单（分页）
 */
async function listAllOrders({ page = 1, pageSize = 50, status, keyword, escrowStatus } = {}) {
  const conditions = [];
  const params = [];
  if (status) { conditions.push('o.status = ?'); params.push(status); }
  // 029 仲裁：按 escrow_status 筛选（frozen/released/refunded/partial_refund/none）
  if (escrowStatus) { conditions.push('o.escrow_status = ?'); params.push(String(escrowStatus)); }
  // stage14 列表搜索：订单号 / 联系人 / 联系电话 模糊匹配
  if (keyword && String(keyword).trim()) {
    const like = '%' + String(keyword).trim() + '%';
    conditions.push('(o.order_no LIKE ? OR o.contact_name LIKE ? OR o.contact_phone LIKE ?)');
    params.push(like, like, like);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const [rows] = await pool.query(
    `SELECT o.*, f.name AS factory_name, u.nickname AS user_nickname,
            ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs
     FROM order_main o LEFT JOIN factory f ON o.factory_id = f.id
     LEFT JOIN c_end_user u ON o.user_id = u.id
     LEFT JOIN c_inquiry ci ON o.inquiry_id = ci.id
     ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(pageSize, 10), (parseInt(page, 10) - 1) * parseInt(pageSize, 10)]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM order_main o ${where}`, params);
  return { total: cnt[0].total, page: parseInt(page, 10), pageSize: parseInt(pageSize, 10), list: rows };
}

/**
 * 订单详情
 */
async function getOrder(orderId) {
  const [rows] = await pool.query(
    `SELECT o.*, f.name AS factory_name, f.contact AS factory_contact, f.phone AS factory_phone,
            ci.design_status, ci.design_note, ci.design_images, ci.design_pdfs
     FROM order_main o LEFT JOIN factory f ON o.factory_id = f.id
     LEFT JOIN c_inquiry ci ON o.inquiry_id = ci.id
     WHERE o.id = ?`,
    [orderId]
  );
  if (!rows.length) throw new Error('订单不存在');
  return rows[0];
}

/**
 * 变更订单状态（事务 + 归属校验 + 状态机校验；消息通知用户）
 * @param {Object} p { orderId, action, actor: 'factory'|'user'|'admin', actorId, extra }
 *   extra.weightKg      确认订单时填写货物重量（按重运费模板必填）
 *   extra.expressCompany / extra.expressNo  发货时必填
 */
async function updateStatus({ orderId, action, actor, actorId, extra = {} }) {
  const rule = STATUS_ACTIONS[action];
  if (!rule) throw new Error('不支持的操作：' + action);
  if (!rule.by.includes(actor)) throw new Error('无权执行该操作');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM order_main WHERE id = ? FOR UPDATE', [orderId]);
    if (!rows.length) throw new Error('订单不存在');
    const order = rows[0];

    // 归属校验：工厂只能操作自己的订单，用户只能操作自己的订单
    if (actor === 'factory' && order.factory_id !== actorId) {
      throw new Error('无权操作其他工厂的订单');
    }
    if (actor === 'user' && order.user_id !== actorId) {
      throw new Error('无权操作他人的订单');
    }

    if (!rule.from.includes(order.status)) {
      throw new Error(`当前状态（${order.status}）不能执行该操作`);
    }

    // Stage13：生产/发货前必须已支付（用户反馈 bug：客户未支付即可推进）
    if (rule.requirePaid && actor !== 'admin' && order.pay_status !== 'paid') {
      throw new Error('订单未支付，请先完成支付');
    }

    // 退款流程中（refunding/refunded）禁止推进任何状态（cancel 除外——取消本身是终止动作）。
    // 修复「生产中+退款中」双状态冲突：退款未处理完又被确认/发货/完成，状态语义混乱。
    if (rule.to !== 'cancelled' && ['refunding', 'refunded'].includes(order.pay_status)) {
      throw new Error('订单正在退款流程中，请先处理完退款再进行其他操作');
    }

    // confirm：工厂确认订单时按默认运费模板计算运费；
    // 按重计费模板必须填写货物重量（工厂最清楚实际重量），用户支付前可见运费明细。
    // 可携带 sampleFee 设定打样费（0=免打样），随首款一并收取
    if (action === 'confirm') {
      if (extra.sampleFee !== undefined && extra.sampleFee !== null && extra.sampleFee !== '') {
        const sf = Number(extra.sampleFee);
        if (!(sf >= 0)) throw new Error('打样费不能为负数');
        await conn.query('UPDATE order_main SET sample_fee = ? WHERE id = ?', [sf, orderId]);
      }
      const tpl = await shippingService.getDefaultTemplate();
      if (tpl) {
        const rawW = extra.weightKg;
        const w = (rawW !== undefined && rawW !== null && rawW !== '') ? Number(rawW) : null;
        if (tpl.mode === 'weight' && !(w > 0)) {
          throw new Error('默认运费模板为按重计费，请填写货物重量（kg）');
        }
        const { fee } = shippingService.calcShippingFee(tpl, {
          totalPrice: order.total_price, quantity: order.quantity, weightKg: w,
        });
        if (w) {
          await conn.query('UPDATE order_main SET shipping_fee = ?, weight_kg = ? WHERE id = ?', [fee, w, orderId]);
        } else {
          await conn.query('UPDATE order_main SET shipping_fee = ? WHERE id = ?', [fee, orderId]);
        }
      }
    }

    // ship：必须录入物流信息（快递公司+单号），同事务写 order_logistics 与发货时间
    if (action === 'ship') {
      const company = String(extra.expressCompany || '').trim();
      const expressNo = String(extra.expressNo || '').trim();
      if (!company) throw new Error('请选择快递公司');
      if (!expressNo) throw new Error('请填写快递单号');
      const companyName = logisticsService.expressCompanyName(company);
      const receiverAddress = snapshotToText(order.address_snapshot, order.address);
      const [fRows] = await conn.query('SELECT name FROM factory WHERE id = ?', [order.factory_id]);
      await conn.query(
        `INSERT INTO order_logistics
           (order_id, express_company, express_company_name, express_no,
            sender_name, receiver_name, receiver_phone, receiver_address, status, ship_time)
         VALUES (?,?,?,?,?,?,?,?, 'shipped', NOW())`,
        [orderId, company, companyName, expressNo,
         (fRows[0] && fRows[0].name) || '', order.contact_name || '', order.contact_phone || '', receiverAddress]
      );
      await conn.query(
        "UPDATE order_main SET shipped_at = NOW(), logistics_status = 'shipped' WHERE id = ?",
        [orderId]
      );
    }

    await conn.query('UPDATE order_main SET status = ? WHERE id = ?', [rule.to, orderId]);

    // 打样进度联动（sendSample→样品已寄 / confirmSample→客户已确认）
    if (action === 'sendSample') {
      await conn.query("UPDATE order_main SET sample_status = 'sent' WHERE id = ?", [orderId]);
    }
    if (action === 'confirmSample') {
      await conn.query("UPDATE order_main SET sample_status = 'confirmed' WHERE id = ?", [orderId]);
    }

    // Stage13 修复：取消已支付订单联动退款标记（此前 pay_status 残留 paid）
    // P1-10 调整：已支付订单取消后进入 refunding（待人工退款），管理端确认后标记 refunded
    if (rule.to === 'cancelled' && order.pay_status === 'paid') {
      await conn.query("UPDATE order_main SET pay_status = 'refunding' WHERE id = ?", [orderId]);
    }
    // 确认收货：物流状态同步为已签收（幂等，物流页据此展示终态）
    if (rule.to === 'completed') {
      await conn.query("UPDATE order_main SET logistics_status = 'signed' WHERE id = ?", [orderId]);
    }

    // 站内消息：通知登录用户（用户自己取消时不通知自己）
    const msg = STATUS_MESSAGE[rule.to];
    const selfCancel = actor === 'user' && rule.to === 'cancelled';
    if (msg && order.user_id && !selfCancel) {
      await conn.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'order_status', ?, ?, 'order', ?)`,
        [order.user_id, msg.title, msg.content(order), orderId]
      );
    }

    await conn.commit();

    // 029 交易担保：确认收货后如订单处于冻结，自动放款（失败不阻断主流程，定时任务兼子）
    if (rule.to === 'completed' && order.escrow_status === 'frozen') {
      try {
        const escrow = require('./escrowService');
        await escrow.confirmRelease(orderId, actor === 'admin' ? 'admin' : { id: order.user_id });
      } catch (e) { console.warn('[escrow] confirmRelease 失败 orderId=' + orderId + ':', e.message); }
    }

    // 订阅消息：发货通知（事务外发送；未配置微信/模板时静默跳过，失败不影响主流程）
    if (rule.to === 'shipped' && order.user_id) {
      try {
        await wxSubscribe.notifyUser(order.user_id, process.env.WX_TMPL_ORDER_SHIPPED, {
          page: 'pages/mine/mine',
          data: {
            // ⚠️ 字段名需与微信后台申请的模板一致，按实际模板字段调整
            character_string1: { value: String(order.order_no || '').slice(0, 32) },
            thing2: { value: '您的订单已发货，请留意收货' },
          },
        });
      } catch (e) {
        console.warn('[orderService] 发货订阅通知失败:', e.message);
      }
    }

    return { orderId, orderNo: order.order_no, from: order.status, to: rule.to };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 支付订单（支付渠道预留）
 * 当前为模拟支付：直接标记已支付，便于闭环演示与测试。
 * Stage13：支付金额 = 货款 total_price + 运费 shipping_fee（工厂确认时已按默认模板计算）；
 * 支持 addressId 确认收货地址（不传则自动取默认地址），地址以快照形式落库，改地址簿不影响历史订单。
 * TODO: 接入微信支付/支付宝时，在此处发起统一下单并返回支付参数，
 *       支付成功回调中再落库 pay_status='paid'。
 */
async function payOrder({ orderId, userId, method, addressId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM order_main WHERE id = ? FOR UPDATE', [orderId]);
    if (!rows.length) throw new Error('订单不存在');
    const order = rows[0];

    if (order.user_id !== userId) throw new Error('无权操作他人的订单');
    if (order.status === 'cancelled') throw new Error('订单已取消，无法支付');
    if (order.pay_status === 'paid') throw new Error('订单已支付，请勿重复支付');
    if (['refunding', 'refunded'].includes(order.pay_status)) throw new Error('订单正在退款流程中，无法支付');

    // 收货地址：优先用传入 addressId（校验归属），否则自动取默认地址；落快照
    let addressToSave = null;
    if (addressId) {
      const [addrs] = await conn.query('SELECT * FROM user_address WHERE id = ? AND user_id = ?', [addressId, userId]);
      if (!addrs.length) throw new Error('收货地址不存在或不属于你');
      addressToSave = addrs[0];
    } else if (!order.address_id) {
      const [defs] = await conn.query('SELECT * FROM user_address WHERE user_id = ? AND is_default = 1 LIMIT 1', [userId]);
      if (defs.length) addressToSave = defs[0];
    }
    if (addressToSave) {
      const snap = {
        contact_name: addressToSave.contact_name, contact_phone: addressToSave.contact_phone,
        province: addressToSave.province, city: addressToSave.city, district: addressToSave.district,
        detail_address: addressToSave.detail_address,
      };
      await conn.query(
        'UPDATE order_main SET address_id = ?, address_snapshot = ? WHERE id = ?',
        [addressToSave.id, JSON.stringify(snap), orderId]
      );
    }

    await conn.query(
      "UPDATE order_main SET pay_status = 'paid', pay_method = ?, paid_at = NOW() WHERE id = ?",
      [method || 'mock', orderId]
    );
    await conn.commit();
    // F-57：服务费台账（事务已提交，幂等；失败仅告警不影响支付结果）
    feeService.recordFee({ orderId, payMethod: method || 'mock' });
    const shippingFee = Number(order.shipping_fee) || 0;
    const sampleFee = Number(order.sample_fee) || 0;
    const payAmount = round(Number(order.total_price || 0) + shippingFee + sampleFee, 2);
    return {
      orderId, orderNo: order.order_no,
      payStatus: 'paid', payMethod: method || 'mock',
      shippingFee, sampleFee, payAmount,
    };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 用户选择线下转账：只标记支付方式，不落 paid（工厂确认收款后由 markOfflinePaid 生效）
 */
async function markOfflinePay({ orderId, userId, addressId }) {
  const [rows] = await pool.query(
    'SELECT id, order_no, user_id, status, pay_status, total_price, shipping_fee, sample_fee FROM order_main WHERE id = ?',
    [orderId]
  );
  if (!rows.length) throw new Error('订单不存在');
  const order = rows[0];
  if (order.user_id !== userId) throw new Error('无权操作他人的订单');
  if (order.status === 'cancelled') throw new Error('订单已取消，无法支付');
  if (order.pay_status === 'paid') throw new Error('订单已支付');
  if (['refunding', 'refunded'].includes(order.pay_status)) throw new Error('订单正在退款流程中，无法支付');
  // 收货地址快照（同 payOrder，保证线下单工厂发货有地址）
  await saveAddressSnapshot(orderId, userId, addressId || null);
  await pool.query("UPDATE order_main SET pay_method = 'offline' WHERE id = ?", [orderId]);
  const payAmount = round(Number(order.total_price || 0) + Number(order.shipping_fee || 0) + Number(order.sample_fee || 0), 2);
  return {
    orderId, orderNo: order.order_no, payStatus: 'unpaid', payMethod: 'offline', payAmount,
    notice: '已选择线下转账，请与工厂沟通付款方式，工厂确认收款后订单生效',
  };
}

/** 收货地址快照：addressId 校验归属，缺省取默认地址（工厂发货依赖此地址） */
async function saveAddressSnapshot(orderId, userId, addressId) {
  let addressToSave = null;
  if (addressId) {
    const [addrs] = await pool.query('SELECT * FROM user_address WHERE id = ? AND user_id = ?', [addressId, userId]);
    if (!addrs.length) throw new Error('收货地址不存在或不属于你');
    addressToSave = addrs[0];
  } else {
    const [defs] = await pool.query('SELECT * FROM user_address WHERE user_id = ? AND is_default = 1 LIMIT 1', [userId]);
    if (defs.length) addressToSave = defs[0];
  }
  if (addressToSave) {
    const snap = {
      contact_name: addressToSave.contact_name, contact_phone: addressToSave.contact_phone,
      province: addressToSave.province, city: addressToSave.city, district: addressToSave.district,
      detail_address: addressToSave.detail_address,
    };
    await pool.query(
      'UPDATE order_main SET address_id = ?, address_snapshot = ? WHERE id = ?',
      [addressToSave.id, JSON.stringify(snap), orderId]
    );
  }
}

/**
 * 微信支付回调落库：按订单号标记已支付（幂等，回调可能重复推送）
 * P0 金额核对：传入回调报文里的实付金额（分）时，与订单应付金额比对，
 * 不一致绝不落 paid（防统一下单后被改价/拆分支付等异常报文刷单），只记日志人工核查。
 */
async function markPaidByTradeNo(orderNo, transactionId, paidFen) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, pay_status, total_price, shipping_fee, sample_fee FROM order_main WHERE order_no = ? FOR UPDATE',
      [orderNo]
    );
    if (!rows.length) { await conn.commit(); return { matched: false }; }
    // 仅 unpaid 可落 paid：refunding/refunded（退款流程）绝不可被回调覆盖，否则款退了又记已收
    if (rows[0].pay_status !== 'unpaid') { await conn.commit(); return { matched: true, skipped: true }; }
    // 金额核对（应付 = 货款+运费+打样费，与 wxpay.createOrderPay 下单金额同源公式）
    if (paidFen != null && Number.isFinite(Number(paidFen))) {
      const expectFen = Math.round(
        (Number(rows[0].total_price || 0) + Number(rows[0].shipping_fee || 0) + Number(rows[0].sample_fee || 0)) * 100
      );
      if (Number(paidFen) !== expectFen) {
        await conn.commit();
        console.error('[PAY][ALERT] 回调金额与订单应付不一致 orderNo=' + orderNo
          + ' 实付=' + paidFen + '分 应付=' + expectFen + '分，已拒绝落库，请人工核查');
        return { matched: true, amountMismatch: true, paidFen: Number(paidFen), expectFen };
      }
    }
    await conn.query(
      "UPDATE order_main SET pay_status = 'paid', pay_method = 'wechat', paid_at = NOW() WHERE id = ? AND pay_status = 'unpaid'",
      [rows[0].id]
    );
    await conn.commit();
    console.log('[PAY] 微信回调落库 orderNo=' + orderNo + ' txn=' + (transactionId || '-'));
    // F-57：服务费台账（幂等；重复回调在前置分支已拦截）
    feeService.recordFee({ orderId: rows[0].id, payMethod: 'wechat' });
    // 029 交易担保：微信支付回调后标记为冻结（需确认收货才解冻）
    if (process.env.WXPAY_ESCROW_ENABLED === '1' && wxpay.isConfigured()) {
      try {
        const escrow = require('./escrowService');
        await escrow.markFrozen(rows[0].id);
      } catch (e) { console.warn('[escrow] markFrozen 失败 orderId=' + rows[0].id + ':', e.message); }
    }
    return { matched: true };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 工厂确认线下收款：订单正式生效（requireFactory + 本厂归属由路由层保证）
 */
async function markOfflinePaid({ orderId, factoryId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, order_no, user_id, factory_id, status, pay_status FROM order_main WHERE id = ? FOR UPDATE', [orderId]);
    if (!rows.length) throw new Error('订单不存在');
    const order = rows[0];
    if (order.factory_id !== factoryId) throw new Error('无权操作其他工厂的订单');
    if (order.status === 'cancelled') throw new Error('订单已取消');
    if (order.pay_status === 'paid') throw new Error('订单已支付，请勿重复标记');
    if (['refunding', 'refunded'].includes(order.pay_status)) throw new Error('订单正在退款流程中，无法确认收款');
    await conn.query(
      "UPDATE order_main SET pay_status = 'paid', pay_method = 'offline', paid_at = NOW() WHERE id = ?",
      [orderId]
    );
    if (order.user_id) {
      await conn.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'order_status', ?, ?, 'order', ?)`,
        [order.user_id, '订单收款确认', `订单 ${order.order_no} 工厂已确认收到货款，订单正式生效。`, orderId]
      );
    }
    await conn.commit();
    // F-57：服务费台账（幂等；失败仅告警）
    feeService.recordFee({ orderId, payMethod: 'offline' });
    return { orderId, orderNo: order.order_no, payStatus: 'paid', payMethod: 'offline' };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * F-56：用户申请退款（已支付且未发货的订单）
 * pay_status paid → refunding；工厂在订单列表看到待退款标记，
 * 确认后由 confirmRefund 完成退款（原路退回 + 站内信通知用户）
 * body 可带 reason（200 字内），落工厂操作日志（F-158）
 */
async function applyRefund({ orderId, userId, reason }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT id, order_no, user_id, factory_id, status, pay_status FROM order_main WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!rows.length) throw new Error('订单不存在');
    const order = rows[0];
    if (order.user_id !== userId) throw new Error('无权操作他人的订单');
    if (order.pay_status !== 'paid') throw new Error('该订单当前不可申请退款（未支付或已在退款流程）');
    // 生产开始后物料/工时已投入，不允许用户单方申请退款，引导客服协商（工厂同意后可由平台处理）
    if (order.status === 'producing') {
      throw new Error('工厂已开始生产，如需退款请联系平台客服与工厂协商处理');
    }
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new Error('订单已发货或已完成，如需退款请联系平台客服');
    }
    await conn.query("UPDATE order_main SET pay_status = 'refunding' WHERE id = ?", [orderId]);
    // F-158：退款申请同步落工厂操作日志（系统产生，无操作员工）
    await conn.query(
      `INSERT INTO factory_operation_log (factory_id, factory_user_id, username, action, detail)
       VALUES (?,?,?,?,?)`,
      [order.factory_id, null, null, 'refund_apply',
        `订单 ${order.order_no} 用户申请退款${reason ? '：' + String(reason).slice(0, 200) : ''}`]
    );
    await conn.commit();
    return { orderId, orderNo: order.order_no, payStatus: 'refunding' };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * F-56：确认退款完成（refunding → refunded），管理端与工厂端共用
 * wechat+已配置先走微信原路退款；线下/mock 直接标记（退款人工执行）
 * 成功后站内信通知用户；factoryId 传入时校验订单归属（工厂端）
 */
async function confirmRefund({ orderId, reason, factoryId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id, order_no, user_id, factory_id, pay_method, pay_status,
              total_price, shipping_fee, sample_fee FROM order_main WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (!rows.length) throw new Error('订单不存在');
    const order = rows[0];
    if (factoryId !== undefined && order.factory_id !== factoryId) {
      throw new Error('无权操作其他工厂的订单');
    }
    if (order.pay_status !== 'refunding') throw new Error('该订单不在待退款状态');
    if (order.pay_method === 'wechat' && wxpay.isConfigured()) {
      const totalFen = Math.round(
        (Number(order.total_price || 0) + Number(order.shipping_fee || 0) + Number(order.sample_fee || 0)) * 100
      );
      await wxpay.refund({
        refundNo: 'RF' + order.order_no,
        orderNo: order.order_no,
        refundFen: totalFen,
        totalFen,
        reason,
      });
    }
    // 退款完成即关闭订单（未发货/未完成的兜底保护），避免出现 refunded+producing 的幽灵单
    await conn.query(
      "UPDATE order_main SET pay_status = 'refunded', status = 'cancelled' WHERE id = ? AND status NOT IN ('shipped', 'completed')",
      [orderId]
    );
    if (order.user_id) {
      await conn.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'order_status', ?, ?, 'order', ?)`,
        [order.user_id, '退款已完成',
          `订单 ${order.order_no} 的退款已确认，款项将按原支付渠道退回，请留意到账。`, orderId]
      );
    }
    await conn.commit();
    return { orderId, orderNo: order.order_no, payStatus: 'refunded', channel: order.pay_method };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** 地址快照 → 可读文本（发货时写入 order_logistics.receiver_address） */
function snapshotToText(snap, fallback) {
  if (!snap) return fallback || '';
  if (typeof snap === 'string') {
    try { snap = JSON.parse(snap); } catch { return snap; }
  }
  if (typeof snap !== 'object') return fallback || '';
  const parts = [snap.province, snap.city, snap.district, snap.detail_address].filter(Boolean);
  return parts.join(' ') || fallback || '';
}

module.exports = {
  STATUS_ACTIONS,
  listUserOrders,
  listFactoryOrders,
  listAllOrders,
  getOrder,
  updateStatus,
  payOrder,
  markOfflinePay,
  markPaidByTradeNo,
  markOfflinePaid,
  applyRefund,
  confirmRefund,
};
