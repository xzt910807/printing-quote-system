const api = require('../../utils/api');

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

// stage13 快递公司选项（编码对齐快递100，与后端 order_logistics.express_company 一致）
const EXPRESS_COMPANIES = [
  { code: 'SF', name: '顺丰速运' },
  { code: 'ZTO', name: '中通快递' },
  { code: 'YTO', name: '圆通速递' },
  { code: 'STO', name: '申通快递' },
  { code: 'YD', name: '韵达快递' },
  { code: 'EMS', name: '邮政EMS' },
  { code: 'JD', name: '京东物流' },
  { code: 'JTSD', name: '极兔速递' },
  { code: 'DBWL', name: '德邦物流' },
  { code: 'OTHER', name: '其他快递' },
];

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t).slice(0, 16).replace('T', ' ');
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 服务端分页契约（与 C 端询价/订单/工单列表一致）：每页 20, 触底追加
const PAGE_SIZE = 20;

Page({
  data: {
    apiBase: api.BASE_URL, // 021 设计参考图完整 URL 拼接用
    // Stage11 自定义导航栏高度（onLoad 计算）
    statusBarHeight: 20,
    navBarHeight: 44,
    auth: null,          // { factoryId, code, name, token }
    usernameInput: '',
    passwordInput: '',
    loggingIn: false,
    wxLoggingIn: false,  // 021 微信一键登录中（防重复点击）
    wxBound: false,      // 当前微信已绑定工厂（我的 → 我是工厂），登录页引导一键登录
    showStaffLogin: false, // 021 员工账号密码区默认折叠，点「员工账号登录」展开
    needSetup: false,    // 生产能力未配置（接不到询价派单）时展示引导横幅
    chatUnread: 0,       // IM 会话未读数（沟通消息入口徽标）
    pendingCount: 0,     // 待处理询价数（用于新询价红点）
    newInquiry: false,   // 有待处理询价增加时点亮红点
    tab: 'inquiry',      // inquiry=询价单 orders=订单
    status: 'pending',
    inquiries: [],
    orders: [],
    // 服务端分页/搜索（询价与订单各一套游标, 切 tab 互不干扰）
    searchKeyword: '',
    inqPage: 1,
    inqHasMore: true,
    ordPage: 1,
    ordHasMore: true,
    loadingMore: false,
    // stage13 发货弹窗：选快递公司 + 填单号
    expressCompanies: EXPRESS_COMPANIES,
    shipModal: { show: false, orderId: 0, companyIndex: -1, expressNo: '' },
    // 快递公司页面内大字体选择弹层（原生 picker 字号不可控，弃用）
    companySheetVisible: false,
    companyTempIndex: -1,
    // 确认订单弹窗：填货物重量（原生 editable 弹窗说明区固定高度会裁剪文字，弃用）
    confirmModal: { show: false, orderId: 0, weight: '' },
    // 017 正式报价弹窗：报价金额 + 有效期 + 调价说明（新流程：报价 → 客户确认 → 订单）
    // 021 designFee：客户「需要设计」时可单列设计费，随报价一并展示给客户
    quoteModal: { show: false, pushId: 0, inquiryNo: '', systemPrice: '', price: '', remark: '', validDays: '7', needDesign: false, designFee: '', submitting: false },
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
    const auth = wx.getStorageSync('factoryAuth');
    if (auth && auth.token) {
      this.setData({ auth });
      this.loadInquiries();
      this.checkCapabilities();
    }
  },

  onShow() {
    // 与本地存储同步登录态：在「我的」页退出/切换工厂账号后，切回本页立即生效，
    // 避免页面保留着已被服务端作废的旧登录态（tab 页不销毁，只在 onShow 刷新）
    const stored = wx.getStorageSync('factoryAuth') || null;
    if (!stored) {
      if (this.data.auth) this.setData({ auth: null, inquiries: [], orders: [], needSetup: false });
    } else if (!this.data.auth || this.data.auth.token !== stored.token) {
      this.setData({ auth: stored });
    }
    if (!this.data.auth) {
      // 登录页提示：当前微信在「我的 → 我是工厂」绑定过工厂时，引导直接走微信一键登录
      const userAuth = wx.getStorageSync('userAuth') || {};
      const role = wx.getStorageSync('role') || userAuth.role || 'customer';
      this.setData({ wxBound: role === 'factory' });
      this.syncTabBar();
      return;
    }
    if (this.data.tab === 'orders') this.loadOrders();
    else this.loadInquiries();
    this.checkCapabilities();
    this.checkNewInquiries();
    this.loadChatUnread();
    this.syncTabBar();
  },

  // 自定义 tabBar：同步选中项与待接单徽标
  syncTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncRole();
      this.getTabBar().selectByPath('/pages/factory/factory');
      this.getTabBar().updateBadge();
    }
  },

  onPullDownRefresh() {
    if (!this.data.auth) return wx.stopPullDownRefresh();
    const task = this.data.tab === 'orders' ? this.loadOrders() : this.loadInquiries();
    Promise.resolve(task).finally(() => wx.stopPullDownRefresh());
  },

  onUsernameInput(e) {
    this.setData({ usernameInput: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ passwordInput: e.detail.value });
  },

  async login() {
    const username = (this.data.usernameInput || '').trim();
    const password = this.data.passwordInput || '';
    if (!username || !password) return wx.showToast({ title: '请输入账号和密码', icon: 'none' });
    this.setData({ loggingIn: true });
    try {
      const res = await api.request('/api/auth/factory-login', {
        method: 'POST',
        data: { username, password },
      });
      const auth = res.data;
      wx.setStorageSync('factoryAuth', auth);
      this.setData({ auth, passwordInput: '' });
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.loadInquiries();
      this.checkCapabilities();
      this.checkNewInquiries();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  goRegister() {
    wx.navigateTo({ url: '/pages/factory-register/factory-register' });
  },

  // 021 员工账号密码区展开/收起
  toggleStaffLogin() {
    this.setData({ showStaffLogin: !this.data.showStaffLogin });
  },

  // 021 微信一键进工厂端：老板微信绑定过工厂（我的 → 我是工厂）直接签发工厂会话；
  // 未绑定的微信由后端给出引导文案，员工仍走上方账号密码登录
  async wxLogin() {
    if (this.data.wxLoggingIn) return;
    this.setData({ wxLoggingIn: true });
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({ success: (r) => (r.code ? resolve(r.code) : reject(new Error(r.errMsg || '微信登录失败'))), fail: reject });
      });
      const res = await api.request('/api/auth/factory-wx-login', {
        method: 'POST',
        data: { code },
      });
      const auth = res.data;
      wx.setStorageSync('factoryAuth', auth);
      this.setData({ auth, passwordInput: '' });
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.loadInquiries();
      this.checkCapabilities();
      this.checkNewInquiries();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none', duration: 3500 });
    } finally {
      this.setData({ wxLoggingIn: false });
    }
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/factory-me/factory-me' });
  },

  // 沟通会话列表（工厂视角，携接单登录态）
  goChatThreads() {
    wx.navigateTo({ url: '/pages/messages/messages?from=factory' });
  },

  // 进入某条询价的客户会话（会话键：inquiry_id × 本厂，factoryId 由服务端按令牌强制为本厂）
  goChatInquiry(e) {
    const { inquiryId, no, name } = e.currentTarget.dataset;
    if (!inquiryId) return;
    wx.navigateTo({
      url: '/pages/chat/chat?inquiryId=' + inquiryId + '&from=factory'
        + '&title=' + encodeURIComponent(name || no || '客户') + '&no=' + encodeURIComponent(no || ''),
    });
  },

  // 未读会话数徽标（接单 tab 徽标的补充，失败静默）
  async loadChatUnread() {
    if (!this.data.auth) return;
    try {
      const res = await api.request('/api/messages/unread', { headers: this.authHeaders() });
      this.setData({ chatUnread: (res.data && res.data.unread) || 0 });
    } catch (err) { /* 静默 */ }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前工厂账号？',
      success: async (res) => {
        if (!res.confirm) return;
        // 先作废服务端会话（与 C 端退出同口径），失败（网络异常等）也继续本地退出
        try {
          await api.request('/api/auth/factory-logout', { method: 'POST', data: {}, headers: this.authHeaders() });
        } catch (e) { /* 服务端登出失败不影响本地退出 */ }
        wx.removeStorageSync('factoryAuth');
        this.setData({ auth: null, inquiries: [], orders: [], needSetup: false });
      },
    });
  },

  authHeaders() {
    const a = this.data.auth;
    return {
      'X-Factory-Id': String(a.factoryId),
      'X-Factory-Token': a.token,
    };
  },

  // 检查生产能力配置：四维全空则无法被任何询价匹配到，展示引导横幅
  async checkCapabilities() {
    if (!this.data.auth) return;
    try {
      const res = await api.request('/api/factory/me/capabilities', { headers: this.authHeaders() });
      const c = res.data || {};
      const empty = !(c.productType || []).length && !(c.printMode || []).length
        && !(c.process || []).length && !(c.material || []).length;
      this.setData({ needSetup: empty });
    } catch (err) { /* 查询失败不阻塞主流程 */ }
  },

  // 询价列表（服务端分页+搜索）：reset=回第一页替换, false=追加下一页
  async loadInquiries(reset = true) {
    if (!this.data.auth) return;
    const page = reset ? 1 : this.data.inqPage + 1;
    try {
      const res = await api.request(`/api/factory/${this.data.auth.factoryId}/inquiries`, {
        data: {
          status: this.data.status,
          page,
          pageSize: PAGE_SIZE,
          keyword: (this.data.searchKeyword || '').trim(),
        },
        headers: this.authHeaders(),
      });
      const d = res.data || {};
      const mapped = (d.list || []).map((r) => ({
        ...r,
        // 时间列后端直发 ISO 串, 前端统一格式化; 参考价缺失时给文字占位（不再 ¥null）
        timeText: formatTime(r.inquiry_time),
        priceText: r.factory_quote != null ? '¥' + Number(r.factory_quote).toFixed(2).replace(/\.00$/, '') : '待定价',
      }));
      this.setData({
        inquiries: reset ? mapped : this.data.inquiries.concat(mapped),
        inqPage: page,
        inqHasMore: !!d.hasMore,
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      // 令牌失效（被重置/停用）时回到登录态
      if (err.message.indexOf('验证失败') >= 0 || err.message.indexOf('未登录') >= 0) {
        wx.removeStorageSync('factoryAuth');
        this.setData({ auth: null, inquiries: [] });
      }
    }
  },

  switchStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ status, newInquiry: false }, () => this.loadInquiries(true));
  },

  // 拉取待处理数量：数量增加则点亮「新询价」红点（分页后总数取服务端 total, 不能再数当前页）
  async checkNewInquiries() {
    if (!this.data.auth) return;
    try {
      const res = await api.request(`/api/factory/${this.data.auth.factoryId}/inquiries`, {
        data: { status: 'pending', page: 1, pageSize: 1 },
        headers: this.authHeaders(),
      });
      const count = (res.data && res.data.total) || 0;
      const last = this.data.pendingCount || 0;
      this.setData({ pendingCount: count, newInquiry: count > last });
      // 写入 tabBar 徽标（接单 tab 显示待处理数）
      const app = getApp();
      app.globalData.tabBadge = { ...(app.globalData.tabBadge || {}), inquiry: count };
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().updateBadge();
      }
    } catch (err) { /* 静默失败，下次 onShow 重试 */ }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab }, () => {
      if (tab === 'orders') this.loadOrders(true);
      else this.loadInquiries(true);
    });
  },

  // 订单列表（服务端分页+搜索）：与询价同款双态
  async loadOrders(reset = true) {
    if (!this.data.auth) return;
    const page = reset ? 1 : this.data.ordPage + 1;
    try {
      const res = await api.request(`/api/factory/${this.data.auth.factoryId}/orders`, {
        data: {
          page,
          pageSize: PAGE_SIZE,
          keyword: (this.data.searchKeyword || '').trim(),
        },
        headers: this.authHeaders(),
      });
      const d = res.data || {};
      const mapped = (d.list || []).map((o) => ({
        ...o,
        statusText: ORDER_STATUS_TEXT[o.status] || o.status,
        timeText: formatTime(o.created_at),
      }));
      this.setData({
        orders: reset ? mapped : this.data.orders.concat(mapped),
        ordPage: page,
        ordHasMore: !!d.hasMore,
      });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      // 令牌失效（被重置/停用）时回到登录态，与 loadInquiries 同口径
      if (err.message.indexOf('验证失败') >= 0 || err.message.indexOf('未登录') >= 0) {
        wx.removeStorageSync('factoryAuth');
        this.setData({ auth: null, orders: [] });
      }
    }
  },

  // 触底加载下一页（按当前 tab 分流）
  onReachBottom() {
    if (this.data.loadingMore || !this.data.auth) return;
    const isOrders = this.data.tab === 'orders';
    const hasMore = isOrders ? this.data.ordHasMore : this.data.inqHasMore;
    if (!hasMore) return;
    this.setData({ loadingMore: true });
    const task = isOrders ? this.loadOrders(false) : this.loadInquiries(false);
    Promise.resolve(task).finally(() => this.setData({ loadingMore: false }));
  },

  // 搜索 400ms 防抖走服务端（分页后本地过滤不可信）, 询价/订单共用一个关键词
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      if (this.data.tab === 'orders') this.loadOrders(true);
      else this.loadInquiries(true);
    }, 400);
  },
  clearSearch() {
    clearTimeout(this._searchTimer);
    this.setData({ searchKeyword: '' });
    if (this.data.tab === 'orders') this.loadOrders(true);
    else this.loadInquiries(true);
  },

  // 询价单号/订单号一键复制（与 C 端单号统一交互）
  copyNo(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  // 订单状态推进：confirm=确认订单 produce=开始生产 ship=发货 cancel=取消
  // stage13：confirm 弹窗可填货物重量（按重计费模板必填，后端校验）；
  //          ship 改为打开发货弹窗（选快递公司 + 填单号）；produce 需用户已支付（后端校验）
  async orderAction(e) {
    const { id, action } = e.currentTarget.dataset;
    const labels = { confirm: '确认订单', produce: '开始生产', ship: '确认发货', cancel: '取消订单' };
    const label = labels[action] || action;

    if (action === 'confirm') {
      // 原生 editable 弹窗的说明区固定高度会裁剪文字（placeholder 与 content 均被截断），
      // 改为页面内自定义弹窗（与发货弹窗同款结构）
      this.setData({ confirmModal: { show: true, orderId: id, weight: '' } });
      return;
    }

    if (action === 'ship') {
      this.setData({ shipModal: { show: true, orderId: id, companyIndex: -1, expressNo: '' } });
      return;
    }

    const tips = { produce: '确认开始生产？（需客户已支付货款）', cancel: '确认取消该订单？已支付订单将标记为退款。' };
    const res = await new Promise((resolve) => wx.showModal({
      title: label,
      content: tips[action] || `确认执行「${label}」？`,
      success: resolve,
    }));
    if (!res.confirm) return;
    try {
      await api.request(`/api/factory/order/${id}/status`, {
        method: 'POST',
        data: { action },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: label + '成功', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.loadOrders();
    }
  },

  // F-56 确认退款：客户申请退款（或取消已支付订单）后，工厂确认完成退款
  // mock/线下支付直接标记已退款；微信支付且已配置时后端先发起原路退款
  async confirmRefund(e) {
    const { id } = e.currentTarget.dataset;
    const res = await new Promise((resolve) => wx.showModal({
      title: '确认退款',
      content: '确认该订单退款已完成？测试/线下支付将直接标记为已退款；微信支付将发起原路退款。',
      confirmText: '确认退款',
      success: resolve,
    }));
    if (!res.confirm) return;
    try {
      await api.request(`/api/factory/order/${id}/refund-confirm`, {
        method: 'POST',
        data: {},
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '已确认退款', icon: 'success' });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.loadOrders();
    }
  },

  // ===== 确认订单弹窗（填货物重量） =====

  onConfirmWeightInput(e) {
    this.setData({ 'confirmModal.weight': e.detail.value });
  },

  closeConfirmModal() {
    this.setData({ 'confirmModal.show': false });
  },

  async submitConfirm() {
    const m = this.data.confirmModal;
    const weight = (m.weight || '').trim();
    try {
      await api.request(`/api/factory/order/${m.orderId}/status`, {
        method: 'POST',
        data: weight ? { action: 'confirm', weightKg: weight } : { action: 'confirm' },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '已确认订单', icon: 'success' });
      this.setData({ 'confirmModal.show': false });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== stage13 发货弹窗 =====

  // 空点击处理器：仅用于 catchtap 阻止冒泡到遮罩（catchtap="" 空绑定在部分基础库不生效，会导致点弹窗内部误关闭）
  noop() {},

  // 打开快递公司选择弹层：临时索引从当前已选项开始，点「确定」才回填
  openCompanySheet() {
    this.setData({ companySheetVisible: true, companyTempIndex: this.data.shipModal.companyIndex });
  },

  closeCompanySheet() {
    this.setData({ companySheetVisible: false });
  },

  pickCompany(e) {
    this.setData({ companyTempIndex: Number(e.currentTarget.dataset.index) });
  },

  confirmCompany() {
    if (this.data.companyTempIndex < 0) return wx.showToast({ title: '请选择快递公司', icon: 'none' });
    this.setData({
      'shipModal.companyIndex': this.data.companyTempIndex,
      companySheetVisible: false,
    });
  },

  onExpressNoInput(e) {
    this.setData({ 'shipModal.expressNo': e.detail.value });
  },

  closeShipModal() {
    // 连快递公司弹层一起关，避免残留遮罩挡住页面
    this.setData({ 'shipModal.show': false, companySheetVisible: false });
  },

  async submitShip() {
    const m = this.data.shipModal;
    if (m.companyIndex < 0) return wx.showToast({ title: '请选择快递公司', icon: 'none' });
    const expressNo = (m.expressNo || '').trim();
    if (!expressNo) return wx.showToast({ title: '请填写快递单号', icon: 'none' });
    const company = EXPRESS_COMPANIES[m.companyIndex];
    try {
      await api.request(`/api/factory/order/${m.orderId}/status`, {
        method: 'POST',
        data: { action: 'ship', expressCompany: company.code, expressNo },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '发货成功', icon: 'success' });
      this.setData({ 'shipModal.show': false });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 订单物流详情（stage13）
  goOrderLogistics(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/logistics/logistics?orderId=' + id + '&from=factory' });
  },

  // ===== 017 正式报价弹窗（新流程主入口；旧路径「直接接单」保留兼容） =====

  openQuoteModal(e) {
    const { pushId, no, sysprice, needDesign } = e.currentTarget.dataset;
    this.setData({
      quoteModal: { show: true, pushId, inquiryNo: no || '', systemPrice: sysprice || '', price: '', remark: '', validDays: '7', needDesign: needDesign === 'true' || needDesign === true, designFee: '', submitting: false },
    });
  },

  onQuotePriceInput(e) {
    this.setData({ 'quoteModal.price': e.detail.value });
  },

  onQuoteDesignFeeInput(e) {
    this.setData({ 'quoteModal.designFee': e.detail.value });
  },

  // 021 查看客户设计参考图大图
  previewDesignImg(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  onQuoteRemarkInput(e) {
    this.setData({ 'quoteModal.remark': e.detail.value });
  },

  onQuoteDaysInput(e) {
    this.setData({ 'quoteModal.validDays': e.detail.value });
  },

  closeQuoteModal() {
    if (this.data.quoteModal.submitting) return;
    this.setData({ 'quoteModal.show': false });
  },

  // 提交正式报价：金额必填 >0，有效期 1-30 天（后端兜底）；客户确认后按此价生成订单
  async submitQuote() {
    const m = this.data.quoteModal;
    const price = Number((m.price || '').trim());
    if (!isFinite(price) || price <= 0) {
      return wx.showToast({ title: '请输入大于 0 的报价金额', icon: 'none' });
    }
    const days = parseInt(m.validDays, 10);
    if (!isFinite(days) || days < 1 || days > 30) {
      return wx.showToast({ title: '有效期需为 1-30 天', icon: 'none' });
    }
    // 021 设计费：客户需要设计时选填，填了必须是 0-999999 的数字（含在总报价中一并收款）
    let designFee;
    if (m.needDesign && (m.designFee || '').trim() !== '') {
      designFee = Number((m.designFee || '').trim());
      if (!isFinite(designFee) || designFee < 0 || designFee > 999999) {
        return wx.showToast({ title: '设计费需为 0-999999 的数字', icon: 'none' });
      }
    }
    this.setData({ 'quoteModal.submitting': true });
    try {
      await api.request(`/api/factory/inquiry/${m.pushId}/quote`, {
        method: 'POST',
        data: { price, remark: (m.remark || '').trim() || undefined, validDays: days, designFee },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '已报价，等待客户确认', icon: 'success' });
      this.setData({ 'quoteModal.show': false });
      this.loadInquiries();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.setData({ 'quoteModal.submitting': false });
      this.loadInquiries(); // 并发态下同步最新状态（如已被其他工厂处理）
    }
  },

  async respond(e) {
    const { pushId, response } = e.currentTarget.dataset;
    try {
      await api.request(`/api/factory/inquiry/${pushId}/respond`, {
        method: 'POST',
        data: { response },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: response === 'accept' ? '已接单' : '已拒绝', icon: 'success' });
      this.loadInquiries();
      this.checkNewInquiries();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.loadInquiries(); // 刷新以显示最新状态（如已被其他工厂接单）
    }
  },
});
