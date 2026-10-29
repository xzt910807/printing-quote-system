// stage14：同源相对路径（admin 由后端静态托管），不再硬编码 localhost，
// 从局域网 IP / 域名访问时请求自动落在当前来源，避免打到访客本机
const API_BASE = '';
const TOKEN_KEY = 'adminToken';
// stage14 SaaS 工厂视图：登录身份与工厂会话（factory-login 返回的令牌）
const LOGIN_TYPE_KEY = 'adminLoginType';
const FACTORY_AUTH_KEY = 'factoryAuth';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function getLoginType() {
  return localStorage.getItem(LOGIN_TYPE_KEY) || 'admin';
}

function getFactoryAuth() {
  try { return JSON.parse(localStorage.getItem(FACTORY_AUTH_KEY) || 'null'); }
  catch (e) { return null; }
}

// 本厂列表查询串：订单/询价都是服务端分页, page/pageSize/status/keyword 一并透传（空值不入串）
// 注意：所有列表型 GET 必须走这里——new URLSearchParams({keyword: undefined}) 会把它
// 序列化成字符串 "keyword=undefined", 后端按字面值 LIKE 筛选, 列表直接空（报价单/订单都踩过）
function listQs(params) {
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    )
  ).toString();
  return qs ? '?' + qs : '';
}

const api = {
  async request(path, options = {}) {
    // 工厂模式下自动携带 X-Factory-Id / X-Factory-Token（requireFactory 校验）
    const isFactory = getLoginType() === 'factory';
    const factoryAuth = isFactory ? getFactoryAuth() : null;
    const factoryId = options.factoryId || (factoryAuth && factoryAuth.factoryId);
    const res = await fetch(API_BASE + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        // 026：工厂模式不再携带 X-Admin-Token，避免双头并存时服务端误判为管理员身份
        ...(isFactory ? {} : { 'X-Admin-Token': getToken() }),
        ...(factoryId ? { 'X-Factory-Id': String(factoryId) } : {}),
        ...(factoryAuth && factoryAuth.token ? { 'X-Factory-Token': factoryAuth.token } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401) {
      // 令牌缺失或失效：通知登录遮罩弹出
      window.dispatchEvent(new CustomEvent('admin-unauthorized'));
      const err = new Error('未授权，请重新登录');
      err.code = 401;
      throw err;
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '请求失败');
    // stage16：full 时返回整个响应体（部分列表接口把 total/page 放在 data 同级）
    return options.full ? data : data.data;
  },

  // 账户登录：换取会话令牌（成功返回 { id, username, nickname, role, token }）
  async adminLogin(username, password) {
    const res = await fetch(API_BASE + '/api/auth/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '登录失败');
    return data.data;
  },

  // 统一登录（F-154）：单表单入口，服务端按 admin_user → factory_user 顺序识别角色，
  // 返回 data.userType = 'admin' | 'factory'，字段与 adminLogin / factoryLogin 各自一致
  async unifiedLogin(username, password) {
    const res = await fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '登录失败');
    return data.data;
  },

  // 探测当前令牌是否有效，返回当前账户信息（无效则抛 401）
  adminMe() { return this.request('/api/auth/admin-me'); },
  adminLogout() { return this.request('/api/auth/admin-logout', { method: 'POST' }); },
  // 修改自己密码
  adminChangePassword(oldPassword, newPassword) {
    return this.request('/api/auth/admin-password', { method: 'POST', body: { oldPassword, newPassword } });
  },

  // 账户管理（仅超级管理员可增改/重置密码）
  users() { return this.request('/api/admin/users'); },
  userCreate(body) { return this.request('/api/admin/users', { method: 'POST', body }); },
  userUpdate(id, body) { return this.request('/api/admin/users/' + id, { method: 'PUT', body }); },
  userResetPassword(id, newPassword) {
    return this.request('/api/admin/users/' + id + '/reset-password', { method: 'POST', body: { newPassword } });
  },

  setToken(token) { localStorage.setItem(TOKEN_KEY, token); },
  clearToken() { localStorage.removeItem(TOKEN_KEY); },

  // ===== stage14 SaaS 工厂视图 =====
  factoryLogin(username, password) {
    return this.request('/api/auth/factory-login', { method: 'POST', body: { username, password } })
      .catch((err) => {
        // 登录接口本身不携带任何令牌，直接透传错误即可
        throw err;
      });
  },
  setLoginType(type) { localStorage.setItem(LOGIN_TYPE_KEY, type); },
  getLoginType,
  setFactoryAuth(data) { localStorage.setItem(FACTORY_AUTH_KEY, JSON.stringify(data)); },
  getFactoryAuth,
  clearFactoryAuth() { localStorage.removeItem(FACTORY_AUTH_KEY); },
  // 工厂订单 / 询价 / 状态推进 / 物流（数据天然按 requireFactory 隔离到本厂）
  // 两个列表都是服务端分页（后端默认 20/页）, 不接 page/pageSize 就只能看到最新一页
  factoryOrders(params = {}) {
    const auth = getFactoryAuth();
    return this.request('/api/factory/' + (auth ? auth.factoryId : 0) + '/orders' + listQs(params));
  },
  factoryInquiries(params = {}) {
    const auth = getFactoryAuth();
    return this.request('/api/factory/' + (auth ? auth.factoryId : 0) + '/inquiries' + listQs(params));
  },
  factoryOrderStatus(id, action, extra) {
    return this.request('/api/factory/order/' + id + '/status', { method: 'POST', body: { action, ...(extra || {}) } });
  },
  factoryOrderLogistics(id) {
    return this.request('/api/factory/order/' + id + '/logistics');
  },
  // P1 双轨支付：客户选择线下转账的订单，工厂确认到账（pay_status → paid）
  factoryOrderOfflinePaid(id) {
    return this.request('/api/factory/order/' + id + '/offline-paid', { method: 'POST', body: {} });
  },
  // F-56 退款闭环：客户申请退款（或取消已支付订单）后，工厂确认退款（refunding → refunded）
  factoryOrderRefundConfirm(id) {
    return this.request('/api/factory/order/' + id + '/refund-confirm', { method: 'POST', body: {} });
  },
  // 价格设置（定价比例 + 价格覆盖，与小程序 factory-me 页同接口）
  factoryPricing() { return this.request('/api/factory/me/pricing'); },
  factorySavePricing(body) { return this.request('/api/factory/me/pricing', { method: 'PUT', body }); },
  factoryCatalogOptions() { return this.request('/api/factory/me/catalog-options'); },
  factoryAddOverride(body) { return this.request('/api/factory/me/override', { method: 'POST', body }); },
  factoryDeleteOverride(body) { return this.request('/api/factory/me/override', { method: 'DELETE', body }); },
  // 工厂修改自己密码
  factoryPassword(oldPassword, newPassword) {
    return this.request('/api/factory/me/password', { method: 'POST', body: { oldPassword, newPassword } });
  },

  // 目录
  catalog() { return this.request('/api/catalog'); },
  catalogAll() { return this.request('/api/catalog?all=1'); },
  catalogByFactory(factoryId) { return this.request(`/api/catalog/factory/${factoryId}`); },
  factories(all) { return this.request('/api/catalog/factories' + (all ? '?all=1' : '')); },
  reloadCatalog() { return this.request('/api/catalog/reload', { method: 'POST' }); },
  addOverride(body) { return this.request('/api/catalog/override', { method: 'POST', body }); },
  deleteOverride(body) { return this.request('/api/catalog/override', { method: 'DELETE', body }); },
  overrides(factoryId) { return this.request(`/api/catalog/factory/${factoryId}/overrides`); },

  // 报价
  quote(body) { return this.request('/api/quote', { method: 'POST', body }); },
  saveQuote(body) { return this.request('/api/quote/save', { method: 'POST', body }); },
  quoteList(params) {
    return this.request('/api/quote/list' + listQs(params));
  },

  // C端
  // stage16 分页：params 支持 {page,pageSize,keyword}；返回 {list,total,page,pageSize}
  async cInquiryList(params = {}) {
    const body = await this.request('/api/c/inquiry/list' + listQs(params), { full: true });
    return { list: body.data || [], total: body.total || 0, page: body.page || 1, pageSize: body.pageSize || 20 };
  },

  // 工厂管理
  factoryCreate(body) { return this.request('/api/factory/create', { method: 'POST', body }); },
  factoryUpdate(id, body) { return this.request('/api/factory/' + id, { method: 'PUT', body }); },
  factoryAuditList(status) {
    return this.request('/api/factory/audit/list' + (status ? '?status=' + encodeURIComponent(status) : ''));
  },
  factoryAudit(id, action) { return this.request('/api/factory/' + id + '/audit', { method: 'POST', body: { action } }); },
  // 027 设备图文画像：查某厂全部图文（含待审/驳回）+ 审核（approve/reject，驳回连带删文件）
  factoryMedia(id) { return this.request('/api/factory/' + id + '/media'); },
  factoryMediaAudit(mediaId, action) { return this.request('/api/factory/media/' + mediaId + '/audit', { method: 'POST', body: { action } }); },
  // stage14 工厂邀请码（小程序「我的-我是工厂」输码绑定身份；工厂 token 访问 /api/admin 天然 401）
  factoryInviteCodes(id) { return this.request('/api/admin/factory/' + id + '/invite-codes'); },
  factoryCreateInviteCode(id) { return this.request('/api/admin/factory/' + id + '/invite-codes', { method: 'POST', body: {} }); },

  // 客户管理
  // stage16 分页：params 支持 {page,pageSize,keyword,factoryId}；返回 {list,total,page,pageSize}
  customers(params = {}) {
    return this.request('/api/customer' + listQs(params));
  },
  customerCreate(body) { return this.request('/api/customer', { method: 'POST', body }); },
  customerUpdate(id, body) { return this.request('/api/customer/' + id, { method: 'PUT', body }); },
  customerDelete(id) { return this.request('/api/customer/' + id, { method: 'DELETE' }); },

  // 删除业务数据
  deleteInquiry(id) { return this.request('/api/c/inquiry/' + id, { method: 'DELETE' }); },
  deleteQuote(id) { return this.request('/api/quote/' + id, { method: 'DELETE' }); },

  // 数据看板
  dashboardStats() { return this.request('/api/dashboard/stats'); },

  // ===== F-148/150 在线设备（管理员）：会话列表 / 强制下线 =====
  sessions(params) {
    return this.request('/api/auth/sessions' + listQs(params));
  },
  revokeSession(id) { return this.request('/api/auth/sessions/' + id, { method: 'DELETE' }); },

  // ===== F-57 服务费台账（管理员） =====
  feeLedger(params) {
    return this.request('/api/admin/fee-ledger' + listQs(params));
  },
  settleFeeLedger(id) { return this.request('/api/admin/fee-ledger/' + id + '/settle', { method: 'POST', body: {} }); },

  // ===== F-158 管理端查看工厂员工操作日志 =====
  factoryOpLogs(factoryId, params) {
    return this.request('/api/admin/factory/' + factoryId + '/op-logs' + listQs(params));
  },

  // 订单
  orderList(params) {
    return this.request('/api/c/order/list' + listQs(params));
  },
  // stage13：extra 支持 weightKg（确认订单）/ expressCompany+expressNo（发货）
  updateOrderStatus(id, action, extra) {
    return this.request('/api/c/admin/order/' + id + '/status', { method: 'POST', body: { action, ...(extra || {}) } });
  },
  // P1-10：确认退款（refunding → refunded；微信支付已配置时后端先发起原路退款）
  adminOrderRefund(id) {
    return this.request('/api/c/admin/order/' + id + '/refund', { method: 'POST', body: {} });
  },

  // 运费模板（stage13）
  shippingTemplates() { return this.request('/api/admin/shipping-templates'); },
  saveShippingTemplate(body) { return this.request('/api/admin/shipping-templates', { method: 'POST', body }); },
  toggleShippingTemplate(id, isActive) {
    return this.request('/api/admin/shipping-templates/' + id + '/toggle', { method: 'POST', body: { isActive } });
  },

  // CSV 导出（用 fetch 带头下载，绕过 window.open 无法带令牌的限制）
  async downloadCsv(path, fallbackName = 'export.csv') {
    // 026：与 request() 同口径——工厂模式只带工厂头，不带 X-Admin-Token
    const isFactory = getLoginType() === 'factory';
    const factoryAuth = isFactory ? getFactoryAuth() : null;
    const headers = isFactory
      ? { 'X-Factory-Id': String(factoryAuth ? factoryAuth.factoryId : ''), 'X-Factory-Token': factoryAuth ? factoryAuth.token : '' }
      : { 'X-Admin-Token': getToken() };
    const res = await fetch(API_BASE + path, { headers });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('admin-unauthorized'));
      const err = new Error('未授权，请重新登录');
      err.code = 401;
      throw err;
    }
    if (!res.ok) throw new Error('导出失败（' + res.status + '）');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dispo = res.headers.get('Content-Disposition') || '';
    const m = dispo.match(/filename="?([^";]+)"?/);
    a.download = m ? decodeURIComponent(m[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};