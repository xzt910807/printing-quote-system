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
    // 031/032 精选 banner + 分类订阅
    featured: [],
    subscribed: [],
    subscribedMap: {},
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) { this.setData({ statusBarHeight: 20, navBarHeight: 44 }); }
    this.loadList(true);
    this.loadFeatured();
    this.loadSubscriptions();
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

  // 031 精选资讯 banner
  async loadFeatured() {
    try {
      const res = await api.request('/api/c/news/featured');
      this.setData({ featured: (res.data && res.data.list) || [] });
    } catch (e) { /* 静默 */ }
  },

  // 032 我的订阅分类（未登录/失败静默）
  async loadSubscriptions() {
    try {
      const res = await api.request('/api/c/news/subscriptions');
      const list = (res.data && res.data.subscribed) || [];
      const map = {};
      for (const c of list) map[c] = true;
      this.setData({ subscribed: list, subscribedMap: map });
    } catch (e) { /* 未登录 401 忽略 */ }
  },

  async onToggleSubscribe(e) {
    const cat = e.currentTarget.dataset.cat;
    if (!cat) return;
    const isSub = !!this.data.subscribedMap[cat];
    try {
      if (isSub) {
        await api.request('/api/c/news/subscribe/' + cat, { method: 'DELETE' });
        wx.showToast({ title: '已取消订阅', icon: 'none' });
      } else {
        await api.request('/api/c/news/subscribe', { method: 'POST', data: { category: cat } });
        wx.showToast({ title: '已订阅 ' + this._catLabel(cat), icon: 'success' });
      }
      await this.loadSubscriptions();
    } catch (err) {
      if (/登录|令牌|过期|401/.test(err.message || '')) {
        wx.showToast({ title: '请先登录后订阅', icon: 'none' });
      } else {
        wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      }
    }
  },

  _catLabel(cat) {
    const found = CATEGORIES.find((c) => c.key === cat);
    return found ? found.label : cat;
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/factories/factories' }) }); },
});
