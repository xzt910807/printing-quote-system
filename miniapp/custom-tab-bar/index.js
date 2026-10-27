const app = getApp();

// stage14 身份分流：按角色过滤 tab（customer 隐藏「接单」；factory 保留 4 项方便老板试算）
// 图标走全局 app.wxss 的 .ic 线性图标体系（iconClass），不再用 emoji
const ALL_TABS = [
  { pagePath: '/pages/quote/quote', text: '报价', iconClass: 'ic-quote' },
  { pagePath: '/pages/factory/factory', text: '接单', iconClass: 'ic-factory', factoryOnly: true },
  { pagePath: '/pages/factories/factories', text: '找厂', iconClass: 'ic-search' },
  { pagePath: '/pages/mine/mine', text: '我的', iconClass: 'ic-mine' },
];

Component({
  // 图标体系（.ic-*）定义在全局 app.wxss；默认样式隔离会挡住全局类，必须开放全局类注入
  options: { addGlobalClass: true },

  data: {
    selected: 0,
    badgeInquiry: 0,   // 工厂端待接单数量
    badgeMine: 0,      // C端未读消息数
    list: [],
  },

  attached() {
    this.syncRole();
    this.updateBadge();
  },

  methods: {
    switchTab(e) {
      const i = e.currentTarget.dataset.index;
      const item = this.data.list[i];
      // 重复点击当前 tab 时不跳转（避免闪烁）
      if (i === this.data.selected) return;
      wx.switchTab({ url: item.pagePath });
      this.setData({ selected: i });
    },

    // 从 globalData 读取徽标（各页面 onShow 写入）
    updateBadge() {
      const b = (app && app.globalData && app.globalData.tabBadge) || {};
      this.setData({
        badgeInquiry: b.inquiry || 0,
        badgeMine: b.mine || 0,
      });
    },

    // stage14：按 storage role 过滤列表；角色变化才 setData 防闪烁
    syncRole() {
      const role = wx.getStorageSync('role') || 'customer';
      const list = ALL_TABS.filter((x) => !x.factoryOnly || role === 'factory');
      const changed = list.length !== this.data.list.length
        || list.some((x, i) => !this.data.list[i] || x.pagePath !== this.data.list[i].pagePath);
      if (changed) this.setData({ list });
      // 当前选中项被过滤掉时回落到第一项
      if (this.data.selected >= list.length) this.setData({ selected: 0 });
    },

    // stage14：页面 onShow 按路径选中（过滤后索引不固定，替代硬编码 selected=N）
    selectByPath(pagePath) {
      const i = this.data.list.findIndex((x) => x.pagePath === pagePath);
      if (i >= 0 && i !== this.data.selected) this.setData({ selected: i });
    },
  },
});
