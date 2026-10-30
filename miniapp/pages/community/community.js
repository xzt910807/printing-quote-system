const api = require('../../utils/api');
const community = require('../../utils/community');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 顶部版块横滑：首项固定「全部」, 后面接后端下发的分类（含 code, 筛选直接用它）
    categories: [{ code: '', name: '全部' }],
    activeCat: '',
    sort: 'hot',
    sortOptions: [
      { code: 'hot', name: '热门' },
      { code: 'new', name: '最新' },
    ],
    list: [],
    page: 1,
    size: 10,
    total: 0,
    loading: false,
    hasMore: true,
    identityHint: '',
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) { this.setData({ statusBarHeight: 20, navBarHeight: 44 }); }
    this.setData({ identityHint: community.identityHint() });
    this.loadCategories();
    this.loadList(true);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncRole();
      this.getTabBar().selectByPath('/pages/community/community');
      this.getTabBar().updateBadge();
    }
    this.setData({ identityHint: community.identityHint() });
    // 发帖/删帖返回后只重刷第一页：整表重建会把滚动位置顶回顶部
    if (this._needRefresh) {
      this._needRefresh = false;
      this.loadList(true);
    }
  },

  onPullDownRefresh() { this.loadList(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.loadList(false); },

  async loadCategories() {
    try {
      const res = await api.request('/api/c/community/categories');
      const list = (res.data && res.data.list) || [];
      this.setData({ categories: [{ code: '', name: '全部' }].concat(list) });
    } catch (e) { /* 版块拉不到只影响筛选, 列表照样能看 */ }
  },

  switchCat(e) {
    const code = e.currentTarget.dataset.code || '';
    if (code === this.data.activeCat) return;
    this.setData({ activeCat: code, list: [], page: 1, total: 0, hasMore: true });
    this.loadList(true);
  },

  switchSort(e) {
    const code = e.currentTarget.dataset.code || 'hot';
    if (code === this.data.sort) return;
    this.setData({ sort: code, list: [], page: 1, total: 0, hasMore: true });
    this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    try {
      const qs = '?page=' + page + '&size=' + this.data.size
        + '&sort=' + this.data.sort
        + (this.data.activeCat ? '&category=' + this.data.activeCat : '');
      const res = await api.request('/api/c/community/posts' + qs);
      const d = res.data || {};
      const incoming = (d.list || []).map(community.shapeItem);
      const merged = reset ? incoming : this.data.list.concat(incoming);
      this.setData({
        list: merged,
        page: page + 1,
        total: d.total || 0,
        hasMore: merged.length < (d.total || 0),
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this._needRefresh = true;
    wx.navigateTo({ url: '/pages/community-detail/community-detail?id=' + id });
  },

  previewImage(e) {
    const { index, id } = e.currentTarget.dataset;
    const item = this.data.list.find((x) => String(x.id) === String(id));
    if (!item || !item.imageUrl.length) return;
    wx.previewImage({ current: item.imageUrl[index || 0], urls: item.imageUrl });
  },

  goCreate() {
    this._needRefresh = true;
    wx.navigateTo({ url: '/pages/post-create/post-create' });
  },

  goMine() {
    wx.navigateTo({ url: '/pages/community-mine/community-mine' });
  },
});
