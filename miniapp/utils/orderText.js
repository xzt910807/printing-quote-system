// 订单展示文案与格式化的单一权威源
// mine 列表页与 order-detail 详情页共用, 禁止各页各写一份状态/支付/步骤/时间映射
// （询价态 STATUS_TEXT、消息 MSG_STYLE 属各页专属, 不在此列）

// 订单状态文案
const ORDER_STATUS_TEXT = {
  pending: '待确认',
  confirmed: '已确认',
  sampling: '打样中',
  sample_confirmed: '样品已确认',
  producing: '生产中',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
};

// 支付状态文案（refunding 需管理端确认后变 refunded）
const PAY_STATUS_TEXT = {
  unpaid: '未支付',
  paid: '已支付',
  refunding: '退款中',
  refunded: '已退款',
};

// 状态徽标配色
function badgeClass(status) {
  if (['accepted', 'converted', 'completed', 'sample_confirmed', 'user_confirmed'].includes(status)) return 'badge-green';
  if (['rejected', 'cancelled'].includes(status)) return 'badge-red';
  if (['pending', 'shipped', 'sampling', 'factory_quoted'].includes(status)) return 'badge-orange';
  return 'badge-blue';
}

// 订单进度节点（状态 → 进度索引；打样插入确认与生产之间）
const ORDER_STEPS = ['下单', '确认', '生产', '发货', '完成'];
const ORDER_STEP_INDEX = { pending: 1, confirmed: 2, sampling: 2, sample_confirmed: 2, producing: 3, shipped: 4, completed: 5 };

// 精确时间（报价有效期等需要具体日期的场景）
function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 相对时间：1小时内“刚刚”/24小时内“N小时前”/7天内“N天前”/更早给日期
function formatRelTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t).slice(0, 16).replace('T', ' ');
  const diff = Date.now() - d.getTime();
  if (diff >= 0 && diff < 3600e3) return '刚刚';
  if (diff >= 0 && diff < 86400e3) return Math.floor(diff / 3600e3) + '小时前';
  if (diff >= 0 && diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + '天前';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  const md = p(d.getMonth() + 1) + '-' + p(d.getDate());
  return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '-' + md;
}

module.exports = {
  ORDER_STATUS_TEXT,
  PAY_STATUS_TEXT,
  badgeClass,
  ORDER_STEPS,
  ORDER_STEP_INDEX,
  formatTime,
  formatRelTime,
};
