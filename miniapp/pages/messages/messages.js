const api = require('../../utils/api');

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  if (d.toDateString() === now.toDateString()) return hm;
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    isFactory: false,   // 工厂视角（from=factory 且有接单登录态）
    list: [],
    unread: 0,
    loading: true,
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
    const factoryAuth = wx.getStorageSync('factoryAuth');
    this.setData({ isFactory: options.from === 'factory' && !!(factoryAuth && factoryAuth.token) });
  },

  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  authHeaders() {
    if (!this.data.isFactory) return {};
    const a = wx.getStorageSync('factoryAuth') || {};
    return { 'X-Factory-Id': String(a.factoryId), 'X-Factory-Token': a.token };
  },

  async load() {
    try {
      const res = await api.request('/api/messages/threads', { headers: this.authHeaders() });
      const d = res.data || {};
      // 会话进入即清零角标（tabBar 徽标同步）
      const app = getApp();
      app.globalData.tabBadge = { ...(app.globalData.tabBadge || {}), chat: d.unread || 0 };
      const list = (d.list || []).map((x) => ({
        ...x,
        // 客户视角对家是厂名，工厂视角对家是客户名
        showName: x.factoryName || x.customerName || '会话',
        lastTimeText: formatTime(x.lastTime),
      }));
      this.setData({ list, unread: d.unread || 0, loading: false });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  // 打开会话：客户带对家工厂ID；工厂侧服务端按令牌识别本厂
  openThread(e) {
    const { inquiryId, factoryId, name, no } = e.currentTarget.dataset;
    let url = '/pages/chat/chat?inquiryId=' + inquiryId
      + '&title=' + encodeURIComponent(name || '')
      + '&no=' + encodeURIComponent(no || '');
    if (this.data.isFactory) url += '&from=factory';
    else url += '&factoryId=' + factoryId;
    wx.navigateTo({ url });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },
});
