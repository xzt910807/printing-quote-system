const api = require('../../utils/api');
const community = require('../../utils/community');

// 状态文案：C 端口径与后台不同——后台要「已下架/已驳回」区分处置动作, 端上只关心
// 「别人看不看得到、为什么看不到」，所以 pending 说成「复核中」而不是「待审」
const STATUS_TEXT = { pending: '复核中', published: '已发布', rejected: '已驳回', removed: '已下架' };
const STATUS_CLASS = { pending: 'st-pending', published: 'st-ok', rejected: 'st-bad', removed: 'st-bad' };

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tab: 'posts',
    posts: [],
    favorites: [],
    loading: false,
    needLogin: false,
    identityHint: '',
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      this.setData({
        statusBarHeight: info.statusBarHeight,
        navBarHeight: (menu.top - info.statusBarHeight) * 2 + menu.height,
      });
    } catch (e) { /* 拿不到就用默认高度 */ }
    this.setData({ identityHint: community.identityHint() });
    this.load();
  },

  onShow() {
    // 从详情页删帖/发帖返回后重拉：这里的条数与状态都是判据, 不能沿用上一页的快照
    if (this._dirty) { this._dirty = false; this.load(); }
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await api.request('/api/c/community/mine', { headers: community.identityHeaders() });
      const d = res.data || {};
      this.setData({
        posts: (d.posts || []).map((p) => this.shapeMine(p)),
        favorites: (d.favorites || []).map(community.shapeItem),
        needLogin: false,
      });
    } catch (e) {
      // /mine 是 requireIdentity：没登录态时 401 属于正常, 给一个可操作的空态而不是一句「请求失败」
      if (e.statusCode === 401) this.setData({ needLogin: true });
      else wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  /** 本人视角：状态徽章 + 审核原因都要带上（后端 scope=mine 已下发 audit_note） */
  shapeMine(p) {
    const item = community.shapeItem(p);
    item.statusText = STATUS_TEXT[p.status] || p.status;
    item.statusClass = STATUS_CLASS[p.status] || 'st-pending';
    return item;
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this._dirty = true;
    wx.navigateTo({ url: '/pages/community-detail/community-detail?id=' + id });
  },

  goCreate() {
    this._dirty = true;
    wx.navigateTo({ url: '/pages/post-create/post-create' });
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/community/community' }) }); },
});
