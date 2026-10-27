const api = require('../../utils/api');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    id: 0,
    news: null,
    loading: false,
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) { this.setData({ statusBarHeight: 20, navBarHeight: 44 }); }
    const id = parseInt((options && options.id) || '0', 10);
    this.setData({ id });
    this.loadDetail();
  },

  async loadDetail() {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      const res = await api.request('/api/c/news/' + this.data.id);
      this.setData({ news: res.data || null });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  openSource() {
    const url = this.data.news && this.data.news.source_url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '原文链接已复制', icon: 'success' }),
    });
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/factories/factories' }) }); },
});
