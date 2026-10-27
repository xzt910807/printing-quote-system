const api = require('../../utils/api');

const TYPE_LABEL = { quality: '质量投诉', delay: '延期预警', reprint: '补印申请', other: '其他' };
const STATUS_LABEL = { open: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    id: 0,
    ticket: null,
    typeLabel: '',
    statusLabel: '',
    loading: false,
    closing: false,
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
      const res = await api.request('/api/c/issue/' + this.data.id);
      const t = res.data || null;
      this.setData({
        ticket: t,
        typeLabel: t ? (TYPE_LABEL[t.type] || t.type) : '',
        statusLabel: t ? (STATUS_LABEL[t.status] || t.status) : '',
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.ticket && this.data.ticket.images) || [];
    wx.previewImage({ current: url, urls });
  },

  async close() {
    if (this.data.closing) return;
    const r = await wx.showModal({ title: '确认关闭', content: '关闭后工单不可再变更，确定？' });
    if (!r.confirm) return;
    this.setData({ closing: true });
    try {
      await api.request('/api/c/issue/' + this.data.id + '/close', { method: 'PUT' });
      wx.showToast({ title: '工单已关闭', icon: 'success' });
      this.loadDetail();
    } catch (e) {
      wx.showToast({ title: e.message || '关闭失败', icon: 'none' });
    } finally { this.setData({ closing: false }); }
  },

  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/issue/issue' }) }); },
});
