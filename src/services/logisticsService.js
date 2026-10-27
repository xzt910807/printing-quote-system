const axios = require('axios');
const md5 = require('md5');
const { pool } = require('../config/db');
const { parseJsonField } = require('../utils/helpers');

/**
 * 物流查询服务（stage13）
 * - 轨迹实时查询走快递100 聚合接口（poll.kuaidi100.com），一次接入支持主流快递
 * - KUAIDI100_KEY / KUAIDI100_CUSTOMER 未配置时降级：返回 configured:false，
 *   发货信息照常录入与展示，不影响签收流程
 * - 查询结果缓存到 order_logistics.track_detail，接口失败时回落缓存
 */

/** 快递公司常量（编码对齐快递100） */
const EXPRESS_COMPANIES = [
  { code: 'SF', name: '顺丰速运' },
  { code: 'ZTO', name: '中通快递' },
  { code: 'YTO', name: '圆通速递' },
  { code: 'STO', name: '申通快递' },
  { code: 'YD', name: '韵达快递' },
  { code: 'EMS', name: '邮政EMS' },
  { code: 'JD', name: '京东物流' },
  { code: 'JTSD', name: '极兔速递' },
  { code: 'DBWL', name: '德邦物流' },
  { code: 'OTHER', name: '其他快递' },
];

function expressCompanyName(code) {
  const hit = EXPRESS_COMPANIES.find((c) => c.code === code);
  return hit ? hit.name : (code || '');
}

function isKuaidi100Configured() {
  return !!(process.env.KUAIDI100_KEY && process.env.KUAIDI100_CUSTOMER);
}

/** 快递100 state → 本系统物流状态（0在途 1揽收 5派件 3签收，其余归 pending） */
const KUAIDI100_STATE_MAP = {
  0: 'delivering', 1: 'shipped', 5: 'delivering', 3: 'signed',
};

/**
 * 实时查询物流轨迹
 * @returns {Promise<{configured:boolean, traces:Array, logisticsStatus:?string}>}
 */
async function queryTrack(expressNo, companyCode) {
  if (!isKuaidi100Configured()) {
    return { configured: false, traces: [], logisticsStatus: null };
  }
  const param = JSON.stringify({ com: companyCode, num: String(expressNo) });
  const sign = md5(param + process.env.KUAIDI100_KEY + process.env.KUAIDI100_CUSTOMER).toUpperCase();
  const { data } = await axios.post('https://poll.kuaidi100.com/poll/query.do', null, {
    params: { customer: process.env.KUAIDI100_CUSTOMER, sign, param },
    timeout: 8000,
  });
  if (String(data.status) !== '200') {
    throw new Error(data.message || '物流查询失败');
  }
  const traces = (data.data || []).map((item) => ({
    time: item.ftime || item.time || '',
    context: item.context || '',
  }));
  return {
    configured: true,
    traces,
    logisticsStatus: KUAIDI100_STATE_MAP[data.state] || 'pending',
  };
}

/**
 * 查询订单物流（C端用户 / 工厂端 / 管理端共用，各自做归属校验）
 * viewer: { type: 'user'|'factory'|'admin', id }
 * 策略：已配置快递100 且已录入单号 → 实时查询并回写缓存；失败或查询中无数据 → 回落缓存
 */
async function getOrderLogistics(orderId, viewer) {
  const [orders] = await pool.query(
    'SELECT id, order_no, user_id, factory_id FROM order_main WHERE id = ?',
    [orderId]
  );
  if (!orders.length) throw new Error('订单不存在');
  const order = orders[0];
  if (viewer && viewer.type === 'user' && order.user_id !== viewer.id) {
    throw new Error('无权查看该订单的物流');
  }
  if (viewer && viewer.type === 'factory' && order.factory_id !== viewer.id) {
    throw new Error('无权查看该订单的物流');
  }

  const [rows] = await pool.query(
    'SELECT * FROM order_logistics WHERE order_id = ? ORDER BY id DESC LIMIT 1',
    [orderId]
  );
  const configured = isKuaidi100Configured();
  if (!rows.length) {
    return { orderId, orderNo: order.order_no, logistics: null, traces: [], configured };
  }
  const logistics = rows[0];

  let traces = parseJsonField(logistics.track_detail, []) || [];
  let liveStatus = null;
  if (configured && logistics.express_no && logistics.express_company && logistics.express_company !== 'OTHER') {
    try {
      const ret = await queryTrack(logistics.express_no, logistics.express_company);
      if (ret.traces && ret.traces.length) traces = ret.traces;
      liveStatus = ret.logisticsStatus || null;
      await pool.query(
        'UPDATE order_logistics SET track_detail = ?, last_track_time = NOW() WHERE id = ?',
        [JSON.stringify(traces), logistics.id]
      );
    } catch (e) {
      console.warn('[logistics] 轨迹实时查询失败，回落缓存:', e.message);
    }
  }

  // 物流状态同步（幂等）：签收后 order_main.logistics_status 同步为 signed
  if (liveStatus && liveStatus !== logistics.status) {
    await pool.query('UPDATE order_logistics SET status = ? WHERE id = ?', [liveStatus, logistics.id]);
    logistics.status = liveStatus;
  }
  if (liveStatus) {
    await pool.query('UPDATE order_main SET logistics_status = ? WHERE id = ?', [liveStatus, orderId]);
  }

  return {
    orderId,
    orderNo: order.order_no,
    logistics: {
      ...logistics,
      expressCompanyName: logistics.express_company_name || expressCompanyName(logistics.express_company),
    },
    traces,
    configured,
  };
}

module.exports = { EXPRESS_COMPANIES, expressCompanyName, isKuaidi100Configured, queryTrack, getOrderLogistics };
