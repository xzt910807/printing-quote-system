const api = require('../../utils/api');
const { PRODUCT_TEXT } = require('../../utils/productText');
const {
  ORDER_STATUS_TEXT, PAY_STATUS_TEXT, ORDER_STEPS, ORDER_STEP_INDEX,
  badgeClass, formatTime, formatRelTime,
} = require('../../utils/orderText');

// 询价状态用户化文案：生命周期一条线——已报价(平台估价) → 已推送工厂 → 工厂已报价/工厂已接单 → 已下单
// 原「已转化」是内部黑话; 「已确认下单」与它语义重叠, 统一说人话
const STATUS_TEXT = {
  quoted: '已报价',
  matched: '已推送工厂',
  factory_quoted: '工厂已报价',
  user_confirmed: '已下单',
  accepted: '工厂已接单',
  converted: '已下单',
};

// 消息分类徽章：彩色实底块 + 白色单字（线性小图标缩到 36rpx 发糊难辨, 单字徽章小尺寸最清晰）
const MSG_STYLE = {
  quote_accepted: { char: '报', tone: 'orange' },
  factory_quoted: { char: '报', tone: 'orange' },
  note_accepted: { char: '报', tone: 'orange' },
  quote_rematch: { char: '报', tone: 'orange' },
  order_created: { char: '订', tone: 'blue' },
  order_status: { char: '订', tone: 'blue' },
  issue_new: { char: '工', tone: 'purple' },
  issue_reply: { char: '工', tone: 'purple' },
  chat_message: { char: '聊', tone: 'green' },
  escrow_arbitrate: { char: '仲', tone: 'red' },
  security: { char: '安', tone: 'red' },
};
// type 笼统（system 等查不到映射）时按标题关键词推断语义，避免一排全灰兜底
function msgStyle(type, title) {
  if (MSG_STYLE[type]) return MSG_STYLE[type];
  const t = String(title || '');
  if (t.indexOf('工单') >= 0) return { char: '工', tone: 'purple' };
  if (t.indexOf('发货') >= 0 || t.indexOf('物流') >= 0) return { char: '物', tone: 'green' };
  if (t.indexOf('报价') >= 0) return { char: '报', tone: 'orange' };
  if (t.indexOf('订单') >= 0) return { char: '订', tone: 'blue' };
  return { char: '知', tone: 'gray' };
}

// 每页条数（与后端 pageSize 上限内取值一致；下拉刷新/切 tab 重拉第一页）
const PAGE_SIZE = 20;

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
    // 分页状态（服务端 LIMIT/OFFSET, page=已加载到的页码）; hasMore 驱动无限滚动与「没有更多」
    inq: { page: 1, hasMore: true },
    ord: { page: 1, hasMore: true },
    msg: { page: 1, hasMore: true },
    sup: { page: 1, hasMore: true },
    loadingMore: false,
    // 026 供应商管理：历史合作工厂聚合（完成订单自动沉淀）
    // suppliers 是合并后的完整列表（分页/搜索态都靠它）, 渲染时按关注态拆成两组
    suppliers: [],
    supFollowed: [],   // 已关注：自己圈的, 可改标签/置顶/取关
    supHistory: [],    // 合作过：订单完成后自动沉淀, 未关注
    supplierLoading: false,
    // 自定义输入弹窗（供应商标签；替代原生 editable showModal 丑输入框）
    inputModal: { show: false, mode: 'tag', title: '', placeholder: '', value: '', factoryId: 0, pinned: false },
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

  // 026 我的供应商（合作次数 / 累计金额 / 最近订单 / 平均评分）；分页 + 服务端 keyword
  async loadSuppliers(reset = true) {
    const page = reset ? 1 : this.data.sup.page + 1;
    this.setData({ supplierLoading: reset });
    try {
      const res = await api.request('/api/c/user/suppliers', {
        data: { page, pageSize: PAGE_SIZE, keyword: (this.data.searchKeyword || '').trim() },
      });
      const list = (res.data && res.data.list) || [];
      const mapped = list.map((s) => ({
        ...s,
        total_amount: Number(s.total_amount || 0).toFixed(2),
        avg_rating: s.avg_rating ? Number(s.avg_rating).toFixed(1) : '',
        lastOrderText: formatRelTime(s.last_order_at),
        followed: !!s.followed,
        pinned: !!s.pinned,
        tags: s.tags || '',
        // 标签拆数组：渲染成多个紫色 chip，比逗号长串精致
        tagsArr: String(s.tags || '').split(/[,，、\s]+/).filter(Boolean).slice(0, 6),
        note: s.note || '',
      }));
      // 全局排序（置顶 → 合作次数 → 金额）由服务端给出, 这里只按关注态切两组, 组内相对顺序不变
      const merged = reset ? mapped : this.data.suppliers.concat(mapped);
      this.setData({
        suppliers: merged,
        supFollowed: merged.filter((x) => x.followed),
        supHistory: merged.filter((x) => !x.followed),
        sup: { page, hasMore: !!res.data.hasMore },
      });
    } catch (err) {
      // 接口未就绪时静默降级（仅重置态清空, 翻页失败保留已加载数据）
      if (reset) this.setData({ suppliers: [], supFollowed: [], supHistory: [], sup: { page: 1, hasMore: false } });
    } finally {
      this.setData({ supplierLoading: false });
    }
  },

  // 033 供应商关注：手动关注 / 打标签 / 置顶 / 取消关注（标签输入统一用自定义弹窗）
  onSupplierFollow(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ inputModal: {
      show: true, mode: 'follow', factoryId: id, pinned: false, value: '',
      title: '关注标签（可选）', placeholder: '如：主力 / 备用 / 待评估，逗号分隔',
    } });
  },

  onSupplierTagEdit(e) {
    const { id, tags, pinned } = e.currentTarget.dataset;
    this.setData({ inputModal: {
      show: true, mode: 'tag', factoryId: id, pinned: !!pinned, value: tags || '',
      title: pinned ? '置顶中 · 修改标签' : '修改标签', placeholder: '标签，逗号分隔',
    } });
  },

  onTagInput(e) { this.setData({ 'inputModal.value': e.detail.value }); },

  // 询价/订单单号一键复制（卡片头部加粗单号）
  copyNo(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  closeTagModal() { this.setData({ 'inputModal.show': false }); },
  noop() {}, // 弹窗面板 catchtap 占位：点内部不冒泡到遮罩关闭

  async confirmTagModal() {
    const m = this.data.inputModal;
    if (!m.show) return;
    const tags = (m.value || '').trim();
    this.setData({ 'inputModal.show': false });
    try {
      await api.request('/api/c/user/suppliers/follow', {
        method: 'POST',
        data: m.mode === 'follow'
          ? { factoryId: m.factoryId, tags }
          : { factoryId: m.factoryId, tags, pinned: !!m.pinned },
      });
      wx.showToast({ title: m.mode === 'follow' ? '已关注' : '已更新', icon: 'success' });
      this.loadSuppliers();
    } catch (err) {
      wx.showToast({ title: err.message || (m.mode === 'follow' ? '关注失败' : '更新失败'), icon: 'none' });
    }
  },

  async onSupplierTogglePin(e) {
    const { id, tags, note, pinned } = e.currentTarget.dataset;
    try {
      await api.request('/api/c/user/suppliers/follow', {
        method: 'POST',
        data: { factoryId: id, tags: tags || '', note: note || '', pinned: pinned ? 0 : 1 },
      });
      wx.showToast({ title: pinned ? '已取消置顶' : '已置顶', icon: 'success' });
      this.loadSuppliers();
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  onSupplierUnfollow(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '取消关注',
      content: '不再关注「' + (name || '该工厂') + '」？历史合作数据仍会保留。',
      confirmColor: '#e64340',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.request('/api/c/user/suppliers/follow/' + id, { method: 'DELETE' });
          wx.showToast({ title: '已取消关注', icon: 'success' });
          this.loadSuppliers();
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        }
      },
    });
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

  // 已下单的询价卡：直达订单 tab 并定位到由它生成的那单
  // 本地命中用订单号；翻页外未命中时用询价单号（服务端订单搜索支持 ci.inquiry_no）同样能定位
  goOrderTab(e) {
    const { inquiryId, inquiryNo } = e.currentTarget.dataset;
    const order = inquiryId
      ? (this.data.orders || []).find((o) => Number(o.inquiry_id) === Number(inquiryId))
      : null;
    this.setData({ tab: 'order', searchKeyword: order ? order.order_no : (inquiryNo || '') });
    this.reloadTab('order');
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // 手动切 tab 一律清空搜索词：搜索框四 tab 共享且搜索态为服务端过滤，
  // 残留关键词会把其他 tab 过滤成空；旧词非空时目标 tab 数据已属过滤态, 需重拉全量首页
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    const hadKw = !!this.data.searchKeyword;
    this.setData({ tab, searchKeyword: '' });
    if (hadKw) this.reloadTab(tab);
  },

  // 搜索：分页后本地过滤不可信, 改服务端 LIKE（防抖 400ms 避免逐字发请求）
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.reloadTab(this.data.tab), 400);
  },

  clearSearch() {
    if (!this.data.searchKeyword) return;
    this.setData({ searchKeyword: '' });
    this.reloadTab(this.data.tab);
  },

  // 按当前 searchKeyword 重拉某 tab 第一页
  reloadTab(tab) {
    const fn = { inquiry: 'loadInquiries', order: 'loadOrders', message: 'loadMessages', supplier: 'loadSuppliers' }[tab];
    if (fn) this[fn](true);
  },

  // 无限滚动：触底加载当前 tab 下一页（loadingMore 防并发重复拉）
  onReachBottom() {
    const conf = {
      inquiry: { flag: 'inq', fn: 'loadInquiries' },
      order: { flag: 'ord', fn: 'loadOrders' },
      message: { flag: 'msg', fn: 'loadMessages' },
      supplier: { flag: 'sup', fn: 'loadSuppliers' },
    }[this.data.tab];
    if (!conf || this.data.loadingMore || !this.data[conf.flag].hasMore) return;
    this.setData({ loadingMore: true });
    Promise.resolve(this[conf.fn](false)).finally(() => this.setData({ loadingMore: false }));
  },

  // 跳工厂详情（询价 matched_factory_id / 订单 factory_id）
  goFactoryDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/factory-detail/factory-detail?id=' + id });
  },

  async loadInquiries(reset = true) {
    const page = reset ? 1 : this.data.inq.page + 1;
    this.setData({ loading: reset });
    try {
      const res = await api.request('/api/c/my-inquiries', {
        data: { page, pageSize: PAGE_SIZE, keyword: (this.data.searchKeyword || '').trim() },
      });
      const mapped = (res.data.list || []).map((x) => ({
        ...x,
        statusText: STATUS_TEXT[x.status] || x.status,
        badgeClass: badgeClass(x.status),
        productText: PRODUCT_TEXT[x.product_type] || x.product_type || '-',
        // 生产参数摘要标签（印刷方式/尺寸/材质/色数）, 后端已解析中文, 空项过滤
        specTags: [x.printModeText, x.sizeText, x.materialText, x.colorText].filter(Boolean),
        timeText: formatRelTime(x.created_at),
        // 017 工厂正式报价：价格/说明/有效期，未过期可确认下单
        factoryQuotedPrice: x.factory_quoted_price != null ? Number(x.factory_quoted_price) : null,
        factoryQuoteRemark: x.factory_quote_remark || '',
        factoryQuoteExpiresText: x.factory_quote_expires_at ? formatTime(x.factory_quote_expires_at) : '',
        factoryQuoteExpired: !!x.factory_quote_expired,
        canConfirmQuote: x.status === 'factory_quoted' && !x.factory_quote_expired,
      }));
      this.setData({
        list: reset ? mapped : this.data.list.concat(mapped),
        inq: { page, hasMore: !!res.data.hasMore },
        // 顶部统计改服务端全量口径（分页后不能再拿当页计数）
        stats: res.data.stats || this.data.stats,
      });
    } catch (err) {
      if (!this.handleAuthError(err)) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadOrders(reset = true) {
    const page = reset ? 1 : this.data.ord.page + 1;
    this.setData({ ordersLoading: reset });
    try {
      const res = await api.request('/api/c/my-orders', {
        data: { page, pageSize: PAGE_SIZE, keyword: (this.data.searchKeyword || '').trim() },
      });
      const mapped = (res.data.list || []).map((o) => ({
        ...o,
        statusText: ORDER_STATUS_TEXT[o.status] || o.status,
        badgeClass: badgeClass(o.status),
        stepIndex: ORDER_STEP_INDEX[o.status] || 0,
        payText: PAY_STATUS_TEXT[o.pay_status] || '未支付',
        productText: PRODUCT_TEXT[o.product_type] || o.product_type || '-',
        // 生产参数标签（印刷方式/尺寸/材质/色数）, 后端已解析中文, 空项过滤
        specTags: [o.printModeText, o.sizeText, o.materialText, o.colorText].filter(Boolean),
        timeText: formatRelTime(o.created_at),
        // F-70：评分展示（已评显示星级，未评显示评价入口）
        rated: !!o.rating,
        ratingText: o.rating ? '★'.repeat(Math.max(1, Math.round(Number(o.rating)))) : '',
        canRate: o.status === 'completed' && !o.rating,
        // F-56：已支付且工厂未开始生产可申请退款（producing 需联系客服与工厂协商）
        canRefund: o.pay_status === 'paid' && ['pending', 'confirmed'].includes(o.status),
      }));
      this.setData({
        orders: reset ? mapped : this.data.orders.concat(mapped),
        ord: { page, hasMore: !!res.data.hasMore },
      });
    } catch (err) {
      // 静默失败：与询价/消息共用 onShow 加载
    } finally {
      this.setData({ ordersLoading: false });
    }
  },

  // 订单卡点击进详情页（支付/取消/收货/退款/评价/物流等全部操作在详情页承载）
  goOrderDetail(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  // 收货地址簿
  goAddress() {
    wx.navigateTo({ url: '/pages/address/address' });
  },

  async loadMessages(reset = true) {
    const page = reset ? 1 : this.data.msg.page + 1;
    this.setData({ msgLoading: reset });
    try {
      const res = await api.request('/api/c/my-messages', {
        data: { page, pageSize: PAGE_SIZE, keyword: (this.data.searchKeyword || '').trim() },
      });
      const mapped = (res.data.list || []).map((m) => {
        const st = msgStyle(m.type, m.title);
        return {
          ...m,
          char: st.char,
          tone: st.tone,
          // 旧消息内容可能带 ::ffff: 前缀（IPv4 映射地址，服务端已修源头），这里兜底剥掉
          content: typeof m.content === 'string' ? m.content.replace(/::ffff:/gi, '') : m.content,
          timeText: formatRelTime(m.created_at),
        };
      });
      this.setData({
        messages: reset ? mapped : this.data.messages.concat(mapped),
        msg: { page, hasMore: !!res.data.hasMore },
        unread: res.data.unread || 0,
      });
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
      // 未读数以服务端全量计数为准（分页后本地 messages 只是部分）, 失败则保守 -1
      const unread = Math.max((this.data.unread || 0) - 1, 0);
      this.setData({ messages, unread });
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
});
