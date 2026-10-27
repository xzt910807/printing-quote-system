const api = require('../../utils/api');

const STATUS_TEXT = {
  quoted: '已报价',
  matched: '已推送工厂',
  factory_quoted: '工厂已报价',
  user_confirmed: '已确认下单',
  accepted: '工厂已接单',
  converted: '已转化',
};

const PRODUCT_TEXT = {
  carton: '纸箱', cardBox: '彩盒', card: '卡片', paperBag: '纸袋', sticker: '不干胶',
  flexiblePackaging: '软包装', nonWovenBag: '无纺布袋', antiCounterfeitLabel: '防伪标签', heatTransfer: '热转印',
  paperContainer: '纸容器',
};

const ORDER_STATUS_TEXT = {
  pending: '待确认',
  confirmed: '已确认',
  sampling: '打样中',
  sample_confirmed: '样品已确认',
  producing: '生产中',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
};

// 支付状态补充文案（refunding 需管理端确认后变 refunded）
const PAY_STATUS_TEXT = {
  unpaid: '未支付',
  paid: '已支付',
  refunding: '退款中',
  refunded: '已退款',
};

// 状态徽标配色
function badgeClass(status) {
  if (['accepted', 'converted', 'completed', 'sample_confirmed', 'user_confirmed'].includes(status)) return 'badge-green';
  if (['rejected', 'cancelled'].includes(status)) return 'badge-red';
  if (['pending', 'shipped', 'sampling', 'factory_quoted'].includes(status)) return 'badge-orange';
  return 'badge-blue';
}

// 订单进度节点（状态 → 进度索引；打样插入确认与生产之间）
const ORDER_STEPS = ['下单', '确认', '生产', '发货', '完成'];
const ORDER_STEP_INDEX = { pending: 1, confirmed: 2, sampling: 2, sample_confirmed: 2, producing: 3, shipped: 4, completed: 5 };

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    // Stage11 自定义导航栏高度（onLoad 计算）
    statusBarHeight: 20,
    navBarHeight: 44,
    auth: null,
    profile: null,
    loading: false,
    ordersLoading: false,
    msgLoading: false,
    tab: 'inquiry',
    orderSteps: ORDER_STEPS,
    list: [],
    // 搜索过滤后的展示列表（本地过滤，搜索词匹配单号/名称/内容）
    displayList: [],
    displayOrders: [],
    displayMessages: [],
    displaySuppliers: [],
    // 026 供应商管理：历史合作工厂聚合（完成订单自动沉淀）
    suppliers: [],
    supplierLoading: false,
    searchKeyword: '',
    stats: { total: 0, active: 0, accepted: 0 },
    messages: [],
    unread: 0,
    chatUnread: 0,     // IM 会话未读（/api/messages/unread，沟通消息入口徽标）
    orders: [],
    role: 'customer',   // stage14 身份分流：customer/factory（storage role 同步）
    factoryName: '',    // 已绑定工厂名（role=factory 时展示）
    factoryAuth: null,  // 工厂接单登录态（与用户身份相互独立，storage factoryAuth 同步）
    // 统一工厂身份卡文案（refreshFacCard 计算）：三态 = 未入驻 / 已绑定未登录 / 已登录
    facCardTitle: '我是工厂',
    facCardSub: '入驻或绑定 · 开始接单',
    facLoggedIn: false,
  },

  // 计算工厂身份卡三态文案：优先展示接单会话（已登录），其次 C 端绑定（未登录），最后是入驻入口
  refreshFacCard() {
    const f = this.data.factoryAuth;
    if (f) {
      this.setData({
        facCardTitle: '工厂接单 · ' + (f.factoryName || f.name || ''),
        facCardSub: '已登录 · 点按前往接单',
        facLoggedIn: true,
      });
    } else if (this.data.role === 'factory') {
      this.setData({
        facCardTitle: '工厂接单 · ' + (this.data.factoryName || '已绑定工厂'),
        facCardSub: '未登录 · 点按登录接单',
        facLoggedIn: false,
      });
    } else {
      this.setData({
        facCardTitle: '我是工厂',
        facCardSub: '入驻或绑定 · 开始接单',
        facLoggedIn: false,
      });
    }
  },

  // 统一工厂身份卡点击分发：已登录/已绑定 → 接单 tab；未入驻 → 入驻双通道
  onFacCardTap() {
    if (this.data.factoryAuth || this.data.role === 'factory') this.goFactoryTab();
    else this.onFactoryEntry();
  },

  onLoad() {
    // Stage11 自定义导航栏：状态栏高度 + 与右上角胶囊对齐的导航栏高度
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
  },

  onShow() {
    const auth = wx.getStorageSync('userAuth') || null;
    // stage14 身份分流：同步角色与绑定工厂（绑定成功后返回 mine 页即刷新）
    const role = wx.getStorageSync('role') || 'customer';
    const factoryName = wx.getStorageSync('factoryName') || '';
    // 工厂接单身份与客户身份相互独立：分别同步，退出任一端不影响另一端
    const factoryAuth = wx.getStorageSync('factoryAuth') || null;
    this.setData({ auth, role, factoryName, factoryAuth });
    this.refreshFacCard();
    if (auth) {
      this.loadProfile();
      this.loadAll();
    } else {
      this.setData({ profile: null });
    }
    this.syncTabBar();
  },

  // Stage12 下拉刷新：json 已开 enablePullDownRefresh，此前缺处理会导致手势悬停
  onPullDownRefresh() {
    const task = this.data.auth ? this.loadAll() : Promise.resolve();
    Promise.resolve(task).finally(() => wx.stopPullDownRefresh());
  },

  // 自定义 tabBar：同步选中项与未读消息徽标
  syncTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncRole();
      this.getTabBar().selectByPath('/pages/mine/mine');
      this.getTabBar().updateBadge();
    }
  },

  // stage14 我是工厂：双通道入驻——①已有邀请码直接绑定；②没有邀请码 → 申请入驻新工厂（管理员审核）
  onFactoryEntry() {
    if (this.data.role === 'factory') return; // 已绑定：灰态不可点
    wx.showActionSheet({
      itemList: ['输入邀请码绑定工厂', '申请入驻新工厂'],
      success: (r) => {
        if (r.tapIndex === 0) this.showInviteCodeDialog();
        else if (r.tapIndex === 1) wx.navigateTo({ url: '/pages/factory-register/factory-register' });
      },
    });
  },

  // 邀请码绑定：弹窗输邀请码 → 绑定工厂身份（tabBar 出现「接单」入口）
  showInviteCodeDialog() {
    wx.showModal({
      title: '绑定工厂身份',
      placeholderText: '请输入 8 位邀请码',
      editable: true,
      success: async (r) => {
        if (!r.confirm) return;
        const code = (r.content || '').trim();
        if (!code) return;
        wx.showLoading({ title: '绑定中', mask: true });
        try {
          const res = await api.request('/api/c/bind-factory', { method: 'POST', data: { code } });
          wx.hideLoading();
          const d = res.data || {};
          wx.setStorageSync('role', d.role);
          wx.setStorageSync('factoryId', d.factoryId);
          wx.setStorageSync('factoryName', d.factoryName || '');
          getApp().globalData.role = d.role;
          this.setData({ role: d.role, factoryName: d.factoryName || '' });
          // 同步 userAuth 缓存（ensureLogin 缓存分支直接读到 role/factoryId）
          this.syncAuthStorage({ role: d.role, factoryId: d.factoryId });
          this.syncTabBar(); // 刷新 tabBar（factory 角色出现「接单」tab）
          this.refreshFacCard();
          wx.showToast({ title: '绑定成功', icon: 'success' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '绑定失败', icon: 'none' });
        }
      },
    });
  },

  /** 登录后用户资料失效时清除本地登录态 */
  handleAuthError(err) {
    if (err && /登录|令牌|过期/.test(err.message || '')) {
      wx.removeStorageSync('userAuth');
      this.setData({ auth: null, profile: null });
      return true;
    }
    return false;
  },

  // ===== 用户资料（头像 / 昵称 / 手机号） =====

  async loadProfile() {
    try {
      const res = await api.request('/api/c/user/me');
      this.setProfile(res.data);
      // 绑定关系以服务端现值为准同步本地（storage 的 factoryName 仅入驻/绑定时写入，
      // 不随登录刷新；绑定变化后未登录态会残留旧厂名，导致与已登录态厂名不一致）
      const d = res.data || {};
      const role = d.role || 'customer';
      const factoryName = d.factoryName || '';
      wx.setStorageSync('role', role);
      wx.setStorageSync('factoryName', factoryName);
      if (d.factoryId) wx.setStorageSync('factoryId', d.factoryId);
      getApp().globalData.role = role;
      this.setData({ role, factoryName });
      this.refreshFacCard();
    } catch (err) {
      this.handleAuthError(err);
    }
  },

  setProfile(u) {
    this.setData({
      profile: {
        id: u.id,
        nickname: u.nickname || '',
        avatarFull: u.avatarUrl ? api.BASE_URL + u.avatarUrl : '',
        phone: u.phone || '',
        phoneMasked: u.phone ? u.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '',
        isBound: !!u.phone,
        devMode: !!u.devMode,
        companyName: u.companyName || '',
      },
    });
  },

  // F-103：编辑公司名称（个人中心补全企业资料，工厂接单时可见）
  onEditCompany() {
    const p = this.data.profile;
    if (!p) return;
    wx.showModal({
      title: '公司名称',
      editable: true,
      placeholderText: '填写营业执照上的公司全称',
      content: p.companyName || '',
      success: async (r) => {
        if (!r.confirm) return;
        const company = (r.content || '').trim();
        if (company === (p.companyName || '')) return;
        if (company.length > 50) {
          wx.showToast({ title: '公司名称最长 50 个字', icon: 'none' });
          return;
        }
        try {
          await api.request('/api/c/user/profile', { method: 'POST', data: { companyName: company } });
          wx.showToast({ title: '已保存', icon: 'success' });
          this.setData({ 'profile.companyName': company });
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  // 资料变更后同步本地登录态（供推送询价等页面直接带入昵称/手机号）
  syncAuthStorage(patch) {
    const auth = wx.getStorageSync('userAuth');
    if (!auth || !auth.token) return;
    const next = { ...auth, ...patch };
    wx.setStorageSync('userAuth', next);
    getApp().globalData.userAuth = next;
  },

  // 头像：微信头像选择（chooseAvatar）→ 读为 base64 上传
  async onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl;
    if (!tempPath) return;
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const base64 = await new Promise((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: tempPath,
          encoding: 'base64',
          success: (r) => resolve(r.data),
          fail: reject,
        });
      });
      const m = /\.(png|jpe?g|gif|webp)$/i.exec(tempPath);
      const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
      await api.request('/api/c/user/avatar', {
        method: 'POST',
        data: { dataUrl: 'data:image/' + ext + ';base64,' + base64 },
      });
      wx.hideLoading();
      wx.showToast({ title: '头像已更新', icon: 'success' });
      this.loadProfile();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    }
  },

  // 昵称：失焦时发生变化才保存（type=nickname 输入）
  async onNicknameBlur(e) {
    const p = this.data.profile;
    if (!p) return;
    const value = (e.detail.value || '').trim();
    if (value === (p.nickname || '')) return;
    if (value.length > 30) {
      wx.showToast({ title: '昵称最长 30 个字', icon: 'none' });
      return;
    }
    try {
      await api.request('/api/c/user/profile', { method: 'POST', data: { nickname: value } });
      wx.showToast({ title: '昵称已保存', icon: 'success' });
      this.setData({ 'profile.nickname': value });
      this.syncAuthStorage({ nickname: value });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.setProfile({ ...p, avatarUrl: p.avatarFull ? p.avatarFull.replace(api.BASE_URL, '') : null, phone: p.phone });
    }
  },

  // 手机号绑定：开发模式手动输入；正式环境走 getPhoneNumber 按钮
  bindPhone() {
    const p = this.data.profile;
    if (!p) return;
    if (p.isBound) {
      wx.showToast({ title: '已绑定：' + p.phoneMasked, icon: 'none' });
      return;
    }
    if (!p.devMode) return; // 正式环境该按钮为 open-type=getPhoneNumber
    wx.showModal({
      title: '绑定手机号',
      editable: true,
      placeholderText: '请输入 11 位手机号',
      success: (r) => {
        if (!r.confirm) return;
        const phone = (r.content || '').trim();
        if (!/^1[3-9]\d{9}$/.test(phone)) {
          wx.showToast({ title: '手机号格式不正确', icon: 'none' });
          return;
        }
        this.doBindPhone({ phone });
      },
    });
  },

  // 正式环境：微信一键获取手机号回调
  getPhoneNumber(e) {
    const code = e.detail && e.detail.code;
    if (!code) {
      wx.showToast({ title: '未获取到手机号授权', icon: 'none' });
      return;
    }
    this.doBindPhone({ code });
  },

  async doBindPhone(payload) {
    wx.showLoading({ title: '绑定中', mask: true });
    try {
      const res = await api.request('/api/c/user/bind-phone', { method: 'POST', data: payload });
      wx.hideLoading();
      wx.showToast({ title: '绑定成功', icon: 'success' });
      this.syncAuthStorage({ phone: res.data.phone });
      this.loadProfile();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 登录 / 退出 =====

  // 工厂接单身份卡：前往接单 tab
  goFactoryTab() {
    wx.switchTab({ url: '/pages/factory/factory' });
  },

  async login() {
    wx.showLoading({ title: '登录中', mask: true });
    const auth = await getApp().ensureLogin();
    wx.hideLoading();
    if (auth) {
      this.setData({ auth });
      this.loadProfile();
      this.loadAll();
      wx.showToast({ title: '登录成功', icon: 'success' });
    } else {
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
    }
  },

  // 退出登录：客户与工厂是两个相互独立的身份。双身份在线时给分级选择，单身份走确认流程
  async logout() {
    const hasUser = !!this.data.auth;
    const hasFactory = !!this.data.factoryAuth;
    if (hasUser && hasFactory) {
      const idx = await new Promise((resolve) => wx.showActionSheet({
        itemList: ['退出客户账号', '退出工厂账号', '退出全部登录'],
        success: (r) => resolve(r.tapIndex),
        fail: () => resolve(-1),
      }));
      if (idx === 0) return this.userLogout();
      if (idx === 1) return this.factoryLogout();
      if (idx === 2) return this.logoutAll();
      return;
    }
    // 仅工厂身份在线（客户身份已退出）：等价于工厂页退出
    if (hasFactory) return this.factoryLogout();
    return this.userLogout();
  },

  // 退出客户账号：作废服务端会话 + 清本地
  async userLogout() {
    const r = await new Promise((resolve) => wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？退出后仍可匿名报价，登录后可继续查看询价与订单。',
      success: resolve,
    }));
    if (!r.confirm) return;
    // 退出时清理找厂「指定工厂」残留，避免重登录后报价页仍显示旧横幅
    wx.removeStorageSync('preferFactoryId');
    wx.removeStorageSync('preferFactoryName');
    // 绑定关系随账号走：退出即清，防同设备换号后 mine 页显示上一账号的厂名
    wx.removeStorageSync('role');
    wx.removeStorageSync('factoryId');
    wx.removeStorageSync('factoryName');
    getApp().globalData.role = 'customer';
    await getApp().logout();
    this.setData({
      auth: null,
      profile: null,
      list: [],
      orders: [],
      messages: [],
      unread: 0,
      chatUnread: 0,
      stats: { total: 0, active: 0, accepted: 0 },
    });
    wx.showToast({ title: '已退出登录', icon: 'success' });
  },

  // 退出工厂账号：先作废服务端会话再清本地（与工厂页退出同口径）
  async factoryLogout() {
    const f = this.data.factoryAuth;
    const r = await new Promise((resolve) => wx.showModal({
      title: '退出工厂账号',
      content: '确认退出「' + ((f && (f.factoryName || f.name)) || '工厂') + '」？退出后接单页需重新登录。',
      success: resolve,
    }));
    if (!r.confirm) return;
    if (f && f.token) {
      try {
        await api.request('/api/auth/factory-logout', {
          method: 'POST',
          data: {},
          headers: { 'X-Factory-Id': String(f.factoryId), 'X-Factory-Token': f.token },
        });
      } catch (e) { /* 服务端登出失败不影响本地退出 */ }
    }
    wx.removeStorageSync('factoryAuth');
    this.setData({ factoryAuth: null });
    this.refreshFacCard();
    wx.showToast({ title: '已退出工厂账号', icon: 'success' });
  },

  // 退出全部登录：按两种身份分别调 logout-all（后端按请求头识别身份），
  // 踢掉这两个账号在所有设备上的会话，再清本机本地登录态
  async logoutAll() {
    const r = await new Promise((resolve) => wx.showModal({
      title: '退出全部登录',
      content: '将退出本机的客户与工厂身份，并使这两个账号在所有设备上的登录同时失效。',
      confirmText: '全部退出',
      confirmColor: '#e64340',
      success: resolve,
    }));
    if (!r.confirm) return;
    wx.showLoading({ title: '退出中', mask: true });
    try {
      // 客户全部会话（api.request 自动携带 X-User-Token）
      try { await api.request('/api/auth/logout-all', { method: 'POST', data: {} }); } catch (e) { /* 失败也继续本地清理 */ }
      // 工厂全部会话
      const f = this.data.factoryAuth;
      if (f && f.token) {
        try {
          await api.request('/api/auth/logout-all', {
            method: 'POST',
            data: {},
            headers: { 'X-Factory-Id': String(f.factoryId), 'X-Factory-Token': f.token },
          });
        } catch (e) { /* 失败也继续本地清理 */ }
      }
    } finally {
      wx.hideLoading();
      // 本地清理（与单端退出同口径）
      wx.removeStorageSync('preferFactoryId');
      wx.removeStorageSync('preferFactoryName');
      wx.removeStorageSync('factoryAuth');
      wx.removeStorageSync('userAuth');
      wx.removeStorageSync('role');
      wx.removeStorageSync('factoryId');
      wx.removeStorageSync('factoryName');
      getApp().globalData.userAuth = null;
      getApp().globalData.role = 'customer';
      this.setData({
        auth: null,
        factoryAuth: null,
        profile: null,
        list: [],
        orders: [],
        messages: [],
        unread: 0,
        chatUnread: 0,
        stats: { total: 0, active: 0, accepted: 0 },
      });
      this.refreshFacCard();
      wx.showToast({ title: '已全部退出', icon: 'success' });
    }
  },

  async loadAll() {
    await Promise.all([this.loadInquiries(), this.loadMessages(), this.loadOrders(), this.loadChatUnread(), this.loadSuppliers()]);
  },

  // 026 我的供应商（合作次数 / 累计金额 / 最近订单 / 平均评分）
  async loadSuppliers() {
    this.setData({ supplierLoading: true });
    try {
      const res = await api.request('/api/c/user/suppliers');
      const list = (res.data && res.data.list) || res.data || [];
      const enriched = list.map((s) => ({
        ...s,
        total_amount: Number(s.total_amount || 0).toFixed(2),
        avg_rating: s.avg_rating ? Number(s.avg_rating).toFixed(1) : '',
        lastOrderText: formatTime(s.last_order_at),
      }));
      this.setData({ suppliers: enriched });
      this.applyFilter();
    } catch (err) {
      // 接口未就绪时静默降级
      this.setData({ suppliers: [] });
    } finally {
      this.setData({ supplierLoading: false });
    }
  },

  // 027 售后工单入口
  goIssue() {
    wx.navigateTo({ url: '/pages/issue/issue' });
  },

  // 028 行业资讯入口
  goNews() {
    wx.navigateTo({ url: '/pages/news/news' });
  },

  // IM 会话未读数（轻量接口，失败静默：不影响询价/订单/站内信主链路）
  async loadChatUnread() {
    try {
      const res = await api.request('/api/messages/unread');
      this.setData({ chatUnread: (res.data && res.data.unread) || 0 });
    } catch (err) { /* 静默 */ }
  },

  // 沟通会话列表（我的 → 沟通消息）
  goChatThreads() {
    wx.navigateTo({ url: '/pages/messages/messages' });
  },

  // 发起/进入某条询价的在线沟通（会话键：询价 × 对家工厂）
  goChat(e) {
    const { inquiryId, factoryId, name, no } = e.currentTarget.dataset;
    if (!inquiryId || !factoryId) return;
    wx.navigateTo({
      url: '/pages/chat/chat?inquiryId=' + inquiryId + '&factoryId=' + factoryId
        + '&title=' + encodeURIComponent(name || '工厂') + '&no=' + encodeURIComponent(no || ''),
    });
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  // 搜索输入：本地过滤三个 tab 的列表（询价单号/产品、订单单号/工厂名、消息标题/内容）
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
    this.applyFilter();
  },

  clearSearch() {
    this.setData({ searchKeyword: '' });
    this.applyFilter();
  },

  // 按 searchKeyword 生成展示列表（空关键词 = 全量）
  applyFilter() {
    const kw = (this.data.searchKeyword || '').trim().toLowerCase();
    const match = (s) => !kw || String(s || '').toLowerCase().indexOf(kw) >= 0;
    this.setData({
      displayList: this.data.list.filter((x) => match(x.inquiry_no) || match(x.productText) || match(x.statusText)),
      displayOrders: this.data.orders.filter((x) => match(x.order_no) || match(x.factory_name) || match(x.productText)),
      displayMessages: this.data.messages.filter((x) => match(x.title) || match(x.content)),
      displaySuppliers: (this.data.suppliers || []).filter((x) => match(x.name) || match(x.address)),
    });
  },

  // 跳工厂详情（询价 matched_factory_id / 订单 factory_id）
  goFactoryDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/factory-detail/factory-detail?id=' + id });
  },

  async loadInquiries() {
    this.setData({ loading: true });
    try {
      const res = await api.request('/api/c/my-inquiries');
      const list = (res.data.list || []).map((x) => ({
        ...x,
        statusText: STATUS_TEXT[x.status] || x.status,
        badgeClass: badgeClass(x.status),
        productText: PRODUCT_TEXT[x.product_type] || x.product_type || '-',
        timeText: formatTime(x.created_at),
        // 017 工厂正式报价：价格/说明/有效期，未过期可确认下单
        factoryQuotedPrice: x.factory_quoted_price != null ? Number(x.factory_quoted_price) : null,
        factoryQuoteRemark: x.factory_quote_remark || '',
        factoryQuoteExpiresText: x.factory_quote_expires_at ? formatTime(x.factory_quote_expires_at) : '',
        factoryQuoteExpired: !!x.factory_quote_expired,
        canConfirmQuote: x.status === 'factory_quoted' && !x.factory_quote_expired,
      }));
      this.setData({
        list,
        stats: {
          total: list.length,
          active: list.filter((x) => ['quoted', 'matched', 'factory_quoted'].includes(x.status)).length,
          accepted: list.filter((x) => ['accepted', 'converted', 'user_confirmed'].includes(x.status)).length,
        },
      });
      this.applyFilter();
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadOrders() {
    this.setData({ ordersLoading: true });
    try {
      const res = await api.request('/api/c/my-orders');
      const orders = (res.data.list || []).map((o) => ({
        ...o,
        statusText: ORDER_STATUS_TEXT[o.status] || o.status,
        badgeClass: badgeClass(o.status),
        stepIndex: ORDER_STEP_INDEX[o.status] || 0,
        payText: PAY_STATUS_TEXT[o.pay_status] || '未支付',
        productText: PRODUCT_TEXT[o.product_type] || o.product_type || '-',
        timeText: formatTime(o.created_at),
        // F-70：评分展示（已评显示星级，未评显示评价入口）
        rated: !!o.rating,
        ratingText: o.rating ? '★'.repeat(Math.max(1, Math.round(Number(o.rating)))) : '',
        canRate: o.status === 'completed' && !o.rating,
        // F-56：已支付且工厂未开始生产可申请退款（producing 需联系客服与工厂协商）
        canRefund: o.pay_status === 'paid' && ['pending', 'confirmed'].includes(o.status),
      }));
      this.setData({ orders });
      this.applyFilter();
    } catch (err) {
      // 静默失败：与询价/消息共用 onShow 加载
    } finally {
      this.setData({ ordersLoading: false });
    }
  },

  // F-70：订单评分（1-5 星）
  async onRateOrder(e) {
    const { id } = e.currentTarget.dataset;
    const idx = await new Promise((resolve) => wx.showActionSheet({
      itemList: ['1 星（很不满意）', '2 星（不满意）', '3 星（一般）', '4 星（满意）', '5 星（非常满意）'],
      success: (r) => resolve(r.tapIndex),
      fail: () => resolve(-1),
    }));
    if (idx < 0) return;
    try {
      await api.request(`/api/c/order/${id}/rate`, { method: 'POST', data: { rating: idx + 1 } });
      wx.showToast({ title: '评价成功', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // F-56：申请退款（已支付未发货订单；工厂/平台确认后原路退回）
  async onApplyRefund(e) {
    const { id } = e.currentTarget.dataset;
    const r = await new Promise((resolve) => wx.showModal({
      title: '申请退款',
      content: '确认申请退款？提交后需工厂确认，款项将原路退回。',
      confirmText: '申请退款',
      confirmColor: '#e64340',
      success: resolve,
    }));
    if (!r.confirm) return;
    try {
      await api.request(`/api/c/order/${id}/refund`, { method: 'POST', data: {} });
      wx.showToast({ title: '已提交退款申请', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 订单操作：确认收货 / 取消订单 / 确认样品
  async orderAction(e) {
    const { id, action } = e.currentTarget.dataset;
    const titleMap = { cancel: '取消订单', complete: '确认收货', confirmSample: '确认样品' };
    const contentMap = {
      cancel: '确认取消该订单？',
      complete: '确认已收到货物并完成订单？',
      confirmSample: '确认样品符合要求？确认后工厂将安排生产。',
    };
    const res = await new Promise((resolve) => wx.showModal({
      title: titleMap[action] || '操作确认',
      content: contentMap[action] || '确认执行该操作？',
      success: resolve,
    }));
    if (!res.confirm) return;
    try {
      await api.request(`/api/c/order/${id}/status`, { method: 'POST', data: { action } });
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 支付：确认地址与金额明细（含打样费）→ 选支付方式（微信 JSAPI / 线下转账 / 模拟）
  async payOrder(e) {
    const { id } = e.currentTarget.dataset;
    let addresses = [];
    try {
      const res = await api.request('/api/c/my-addresses');
      addresses = res.data.list || [];
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      return;
    }
    if (!addresses.length) {
      const r = await new Promise((resolve) => wx.showModal({
        title: '请先添加收货地址',
        content: '支付前需要确认收货地址，现在去添加？',
        confirmText: '去添加',
        success: resolve,
      }));
      if (r.confirm) wx.navigateTo({ url: '/pages/address/address' });
      return;
    }
    const order = (this.data.orders || []).find((o) => o.id === id) || {};
    const totalPrice = Number(order.total_price) || 0;
    const shippingFee = Number(order.shipping_fee) || 0;
    const sampleFee = Number(order.sample_fee) || 0;
    const addr = addresses.find((a) => a.is_default) || addresses[0];
    const addrText = (addr.province || '') + (addr.city || '') + (addr.district || '') + (addr.detail_address || '');
    let content = '货款：¥' + totalPrice.toFixed(2) + '\n运费：¥' + shippingFee.toFixed(2);
    if (sampleFee > 0) content += '\n打样费：¥' + sampleFee.toFixed(2);
    content += '\n合计：¥' + (totalPrice + shippingFee + sampleFee).toFixed(2)
      + '\n\n收货：' + addr.contact_name + ' ' + addr.contact_phone + '\n' + addrText;
    // 工厂尚未确认订单（未计算运费）时提示运费规则
    if (shippingFee <= 0 && order.status === 'pending') {
      content += '\n\n注：运费将在工厂确认订单后计算，如产生额外运费需另行支付';
    }
    const res = await new Promise((resolve) => wx.showModal({ title: '确认订单与金额', content, success: resolve }));
    if (!res.confirm) return;
    // 选择支付方式
    const sheet = await new Promise((resolve) => wx.showActionSheet({
      itemList: ['微信支付', '线下转账', '模拟支付（测试）'],
      success: (r) => resolve(r.tapIndex),
      fail: () => resolve(-1),
    }));
    if (sheet < 0) return;
    try {
      if (sheet === 0) {
        const payRes = await api.request(`/api/c/order/${id}/pay`, {
          method: 'POST', data: { payMethod: 'wechat', addressId: addr.id },
        });
        const wp = payRes.data.wxPay;
        await new Promise((resolve, reject) => wx.requestPayment({ ...wp, success: resolve, fail: reject }));
        wx.showToast({ title: '支付成功', icon: 'success' });
      } else if (sheet === 1) {
        await api.request(`/api/c/order/${id}/pay`, {
          method: 'POST', data: { payMethod: 'offline', addressId: addr.id },
        });
        wx.showModal({
          title: '已选择线下转账',
          content: '请与工厂沟通付款方式，工厂确认收款后订单正式生效。',
          showCancel: false,
        });
      } else {
        await api.request(`/api/c/order/${id}/pay`, {
          method: 'POST', data: { payMethod: 'mock', addressId: addr.id },
        });
        wx.showToast({ title: '支付成功（模拟）', icon: 'success' });
      }
      this.loadOrders();
    } catch (err) {
      // requestPayment 用户取消也走 fail，提示已取消
      wx.showToast({ title: (err && err.message) || '已取消支付', icon: 'none' });
    }
  },

  // 收货地址簿
  goAddress() {
    wx.navigateTo({ url: '/pages/address/address' });
  },

  // 订单物流详情（stage13）
  goLogistics(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/logistics/logistics?orderId=' + id });
  },

  async loadMessages() {
    this.setData({ msgLoading: true });
    try {
      const res = await api.request('/api/c/my-messages');
      const messages = (res.data.list || []).map((m) => ({
        ...m,
        // 旧消息内容可能带 ::ffff: 前缀（IPv4 映射地址，服务端已修源头），这里兜底剥掉
        content: typeof m.content === 'string' ? m.content.replace(/::ffff:/gi, '') : m.content,
        timeText: formatTime(m.created_at),
      }));
      this.setData({ messages, unread: res.data.unread || 0 });
      this.applyFilter();
      // 写入 tabBar 徽标（我的 tab 显示未读消息数）
      this.syncMessageBadge(res.data.unread || 0);
    } catch (err) {
      // 静默失败：与询价加载共用一个 onShow，避免重复弹提示
    } finally {
      this.setData({ msgLoading: false });
    }
  },

  // 点击消息：未读则标记已读
  async tapMessage(e) {
    const { id, read } = e.currentTarget.dataset;
    if (read) return;
    try {
      await api.request('/api/c/my-messages/read', { method: 'POST', data: { id } });
      const messages = this.data.messages.map((m) => (m.id === id ? { ...m, is_read: true } : m));
      const unread = messages.filter((m) => !m.is_read).length;
      this.setData({ messages, unread });
      // 原缺陷：未 applyFilter + 未同步 tabBar 徽标，列表红点与「我的」红点都残留
      this.applyFilter();
      this.syncMessageBadge(unread);
    } catch (err) {
      // 忽略单条已读失败
    }
  },

  async readAll() {
    if (!this.data.unread) return;
    try {
      await api.request('/api/c/my-messages/read', { method: 'POST', data: { all: true } });
      const messages = this.data.messages.map((m) => ({ ...m, is_read: true }));
      this.setData({ messages, unread: 0 });
      // 原缺陷：未 applyFilter + 未同步 tabBar 徽标，列表红点与「我的」红点都残留
      this.applyFilter();
      this.syncMessageBadge(0);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 已读动作后同步 tabBar「我的」徽标（与 loadMessages 同一条链路）
  syncMessageBadge(unread) {
    const app = getApp();
    app.globalData.tabBadge = { ...(app.globalData.tabBadge || {}), mine: unread };
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().updateBadge();
    }
  },

  // 017：确认工厂正式报价 → 生成订单（金额以工厂报价为准）
  async confirmFactoryQuote(e) {
    const { id, price, remark } = e.currentTarget.dataset;
    const content = '工厂正式报价 ¥' + (Number(price) || 0).toFixed(2)
      + (remark ? '\n工厂说明：' + remark : '')
      + '\n\n确认后将生成订单，可前往「订单」页支付。';
    // 真机坑：confirmText 超 4 字符微信真机会静默不弹弹窗（开发者工具却正常）
    let r;
    try {
      r = await new Promise((resolve) => wx.showModal({
        title: '确认工厂报价',
        content,
        confirmText: '确认下单',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      }));
    } catch (e) {
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      return;
    }
    if (!r || !r.confirm) return;
    try {
      await api.request(`/api/c/inquiry/${id}/confirm-quote`, { method: 'POST' });
      wx.showToast({ title: '已确认，订单已生成', icon: 'success' });
      this.loadInquiries();
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.loadInquiries();
    }
  },

  // 一键复购：历史询价参数带回报价页重新询价
  repurchase(e) {
    const item = e.currentTarget.dataset.item;
    if (!item) return;
    wx.setStorageSync('repurchaseParams', {
      productType: item.product_type,
      printMode: item.print_mode,
      length_m: item.length_m,
      width_m: item.width_m,
      height_m: item.height_m,
      quantity: item.quantity,
      materialType: item.material_type,
      materialCode: item.material_code,
      colorCount: item.color_count,
      processes: item.processes || [],
    });
    wx.switchTab({ url: '/pages/quote/quote' });
  },

  // F-97：空状态引导——跳到报价 tab
  goQuote() {
    wx.switchTab({ url: '/pages/quote/quote' });
  },

  callFactory(e) {
    const phone = e.currentTarget.dataset.phone;
    if (phone) wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },
});
