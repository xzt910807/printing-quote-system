const api = require('../../utils/api');

const CATEGORIES = [
  { key: '', label: '全部' },
  { key: 'policy', label: '政策' },
  { key: 'market', label: '市场' },
  { key: 'tech', label: '技术' },
  { key: 'material', label: '材料' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    categories: CATEGORIES,
    activeCat: '',
    list: [],
    page: 1,
    size: 10,
    total: 0,
    loading: false,
    hasMore: true,
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) { this.setData({ statusBarHeight: 20, navBarHeight: 44 }); }
    this.loadList(true);
  },

  onPullDownRefresh() { this.loadList(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.loadList(false); },

  switchCat(e) {
    const cat = e.currentTarget.dataset.cat || '';
    if (cat === this.data.activeCat) return;
    this.setData({ activeCat: cat, list: [], page: 1, total: 0, hasMore: true });
    this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      const qs = `?page=${page}&size=${this.data.size}${this.data.activeCat ? '&category=' + this.data.activeCat : ''}`;
      const res = await api.request('/api/c/news' + qs);
      const d = res.data || {};
      const newList = d.list || [];
      this.setData({
        list: reset ? newList : this.data.list.concat(newList),
        page: page + 1,
        total: d.total || 0,
        hasMore: (reset ? newList.length : this.data.list.length + newList.length) < (d.total || 0),
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/news-detail/news-detail?id=' + id });
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/factories/factories' }) }); },
});
