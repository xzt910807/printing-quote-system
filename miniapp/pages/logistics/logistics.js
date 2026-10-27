const api = require('../../utils/api');

const STATUS_TEXT = {
  pending: '待发货',
  shipped: '已发货',
  delivering: '运输中',
  signed: '已签收',
};

function formatTime(t) {
  if (!t) return '-';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 物流详情（stage13）：C端用户 / 工厂端共用（from=factory 走工厂接口）
Page({
  data: {
    // 自定义导航栏高度（与其他页面同一套算法）
    statusBarHeight: 20,
    navBarHeight: 44,
    orderId: 0,
    fromFactory: false,
    loading: false,
    orderNo: '',
    logistics: null,
    traces: [],
    configured: false,
    statusText: '',
    shipTimeText: '',
  },

  onLoad(options) {
    // 自定义导航栏高度（与其他页面同一套算法）
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }

    const orderId = parseInt((options && options.orderId) || '0', 10) || 0;
    const fromFactory = (options && options.from) === 'factory';
    this.setData({ orderId, fromFactory });
    this.loadLogistics();
  },

  onPullDownRefresh() {
    this.loadLogistics().finally(() => wx.stopPullDownRefresh());
  },

  factoryHeaders() {
    const auth = wx.getStorageSync('factoryAuth') || {};
    return {
      'X-Factory-Id': String(auth.factoryId || ''),
      'X-Factory-Token': auth.token || '',
    };
  },

  async loadLogistics() {
    if (!this.data.orderId) return;
    this.setData({ loading: true });
    try {
      const path = `/api/${this.data.fromFactory ? 'factory' : 'c'}/order/${this.data.orderId}/logistics`;
      const res = await api.request(path, {
        headers: this.data.fromFactory ? this.factoryHeaders() : {},
      });
      const d = res.data || {};
      const logistics = d.logistics || null;
      this.setData({
        orderNo: d.orderNo || '',
        logistics,
        traces: d.traces || [],
        configured: !!d.configured,
        statusText: logistics ? (STATUS_TEXT[logistics.status] || logistics.status) : '',
        shipTimeText: logistics ? formatTime(logistics.ship_time) : '',
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  copyExpressNo() {
    const no = this.data.logistics && this.data.logistics.express_no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  // 返回上一页（自定义导航栏无原生返回按钮）；工厂端进入回接单台，C 端回我的
  goBack() {
    const fallback = this.data.fromFactory ? '/pages/factory/factory' : '/pages/mine/mine';
    wx.navigateBack({ fail: () => wx.switchTab({ url: fallback }) });
  },
});
