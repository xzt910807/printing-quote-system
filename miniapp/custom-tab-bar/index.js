const app = getApp();

// stage14 身份分流：按角色过滤 tab（customer 隐藏「接单」；factory 保留全部方便老板试算）
// 图标走全局 app.wxss 的 .ic 线性图标体系（iconClass），不再用 emoji
// D4 加了第 5 项「社区」（微信上限就是 5）：客户视角 4 项、工厂视角 5 项
// badgeKey 取代旧的硬编码 index===1/index===3：插一项后索引全变, 徽标会贴到隔壁 tab 上
const ALL_TABS = [
  { pagePath: '/pages/quote/quote', text: '报价', iconClass: 'ic-quote' },
  { pagePath: '/pages/community/community', text: '社区', iconClass: 'ic-community' },
  { pagePath: '/pages/factory/factory', text: '接单', iconClass: 'ic-factory', factoryOnly: true, badgeKey: 'inquiry' },
  { pagePath: '/pages/factories/factories', text: '找厂', iconClass: 'ic-search' },
  { pagePath: '/pages/mine/mine', text: '我的', iconClass: 'ic-mine', badgeKey: 'mine' },
];

Component({
  // 图标体系（.ic-*）定义在全局 app.wxss；默认样式隔离会挡住全局类，必须开放全局类注入
  options: { addGlobalClass: true },

  data: {
    selected: 0,
    list: [],
  },

  attached() {
    this.applyList();
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

    // 角色 + 徽标一起重算：syncRole/updateBadge 两个入口保留是给各页面 onShow 调的，
    // 拆成两份就会漏一侧（以前徽标刷新不动列表就是这原因）
    applyList() {
      const role = wx.getStorageSync('role') || 'customer';
      const b = (app && app.globalData && app.globalData.tabBadge) || {};
      const list = ALL_TABS
        .filter((x) => !x.factoryOnly || role === 'factory')
        .map((x) => Object.assign({}, x, { badge: x.badgeKey ? (Number(b[x.badgeKey]) || 0) : 0 }));
      const cur = this.data.list || [];
      const changed = list.length !== cur.length
        || list.some((x, i) => !cur[i] || x.pagePath !== cur[i].pagePath || x.badge !== cur[i].badge);
      if (changed) this.setData({ list });
      // 当前选中项被过滤掉时回落到第一项
      if (this.data.selected >= list.length) this.setData({ selected: 0 });
    },

    // 从 globalData 读取徽标（各页面 onShow 写入）
    updateBadge() {
      this.applyList();
    },

    // stage14：按 storage role 过滤列表；角色变化才 setData 防闪烁
    syncRole() {
      this.applyList();
    },

    // stage14：页面 onShow 按路径选中（过滤后索引不固定，替代硬编码 selected=N）
    selectByPath(pagePath) {
      const i = this.data.list.findIndex((x) => x.pagePath === pagePath);
      if (i >= 0 && i !== this.data.selected) this.setData({ selected: i });
    },
  },
});
