const api = require('../../utils/api');

// 询价进度节点
const STEPS = [
  { icon: '📋', label: '报价' },
  { icon: '🚀', label: '推送' },
  { icon: '🤝', label: '接单' },
];

// 平均响应时长格式化：<1h 显示「1小时内」，<24h 显示小时，否则显示天
function fmtAvgHours(h) {
  if (h === null || h === undefined || h === '') return '—';
  const v = Number(h);
  if (!isFinite(v) || v <= 0) return '1小时内';
  if (v < 24) return v.toFixed(1) + '小时';
  return (v / 24).toFixed(1) + '天';
}

// 成本构成对象 → 列表（兼容 detail 文本与 items 数组两种形态）
// 020：明细里的 [system]/[factory] 是价格来源标记（平台目录价/工厂自定义价），C端用户看不懂，展示前剥除
function fmtBreakdown(breakdown) {
  return Object.entries(breakdown || {}).map(([key, v]) => ({
    key,
    name: v.name,
    cost: v.cost,
    detail: (v.detail || (Array.isArray(v.items) ? v.items.map((i) => i.name).join('、') : ''))
      .replace(/\[(system|factory)\]/g, ''),
  }));
}

// F-10：报价有效期实时倒计时格式化（以 expiresAt 为基准每秒刷新）
function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const mi = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  if (d > 0) return d + ' 天 ' + pad(h) + ':' + pad(mi) + ':' + pad(sec);
  if (h > 0) return h + ':' + pad(mi) + ':' + pad(sec);
  return pad(mi) + ':' + pad(sec);
}

// 017：工厂报价有效期展示（YYYY-MM-DD HH:mm）
function fmtTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    // 自定义导航栏高度（与其他页面同一套算法）
    statusBarHeight: 20,
    navBarHeight: 44,
    apiBase: api.BASE_URL, // 021 设计参考图完整 URL 拼接用
    result: null,
    breakdownList: [],
    statusData: null,
    statusText: '',
    steps: STEPS,
    currentStep: 1,
    rejected: false,
    preferredRejected: false, // 指定工厂能力不满足被后端拒绝（stage12）
    canSelect: true,          // 是否可查看报价/选定（quoted/rejected 且未接单）
    // 报价弹窗（F-08）：loading=计算中，expired=410 过期态
    quoteModal: {
      visible: false, loading: false,
      factoryId: 0, factoryName: '',
      factoryQuote: null, systemQuote: null, contact: null,
      breakdownList: [], breakdownOpen: false,
      diffPercent: 0, diffLabel: '',
      remainDays: -1, expired: false, error: '',
      expiresAt: null, countdown: '',
    },
    // 手机号授权弹窗（F-11）：mode=bind（已登录换绑，可微信一键授权）| contact（匿名留联系方式）
    phoneModal: { visible: false, phone: '', factoryId: 0, mode: 'contact', submitting: false },
  },

  onLoad() {
    // 自定义导航栏高度（与其他页面同一套算法）
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }

    // F-101：开启分享菜单（右上角转发 + 朋友圈），分享落地到报价首页
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    const result = wx.getStorageSync('lastQuote');
    if (!result || !result.systemQuote) {
      wx.showToast({ title: '暂无报价数据', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const breakdownList = fmtBreakdown(result.systemQuote.breakdown);
    // F-07：matches 已无价格字段，按评分/接单率排序由后端保证，这里只补展示字段
    const matches = (result.matches || []).map((m) => ({
      ...m,
      ratingText: m.rating != null ? Number(m.rating).toFixed(1) : '5.0',
      acceptRateText: m.acceptRate != null ? m.acceptRate : 0,
      avgResponseText: fmtAvgHours(m.avgResponseHours),
      isPreferred: result.preferredFactoryId ? m.factoryId === result.preferredFactoryId : !!m.isPreferred,
    }));
    this.setData({
      result: { ...result, matches },
      breakdownList,
      preferredRejected: !!result.preferredRejected,
    });
    this.refreshStatus();
  },

  // F-10 倒计时清理：页面隐藏/卸载时停表，回前台且弹窗仍开着则续走
  onHide() {
    this.stopQuoteCountdown();
  },

  onUnload() {
    this.stopQuoteCountdown();
  },

  // F-101：转发分享（结果页数据在本地存储，好友打开走报价首页体验同款流程）
  onShareAppMessage() {
    return {
      title: '龙港印刷报价：一键询价，工厂实时接单',
      path: '/pages/quote/quote',
    };
  },

  // F-101：朋友圈分享
  onShareTimeline() {
    return {
      title: '龙港印刷报价：一键询价，工厂实时接单',
      query: '',
    };
  },

  onShow() {
    const m = this.data.quoteModal;
    if (m.visible && !m.loading && !m.expired && m.expiresAt) {
      this.startQuoteCountdown();
    }
  },

  async refreshStatus() {
    if (!this.data.result || !this.data.result.inquiryId) return;
    try {
      const res = await api.request(`/api/c/inquiry/${this.data.result.inquiryId}`);
      const s = res.data;
      const textMap = {
        quoted: '等待选择工厂推送',
        matched: '已推送，等待工厂报价',
        factory_quoted: '工厂已给出正式报价，请确认',
        user_confirmed: '已确认工厂报价，订单已生成',
        accepted: '工厂已接单，可联系对方',
        rejected: '工厂拒绝了该询价，可从下方重新选择其他工厂',
        converted: '已生成订单',
        expired: '询价已过期，请重新报价',
      };
      // 017：user_confirmed（新流程确认成交）与 accepted/converted（旧路径）同视为已成交
      const done = ['accepted', 'converted', 'user_confirmed'].includes(s.status);
      this.setData({
        statusData: {
          ...s,
          factoryQuoteExpiresAtText: s.factoryQuoteExpiresAt ? fmtTime(s.factoryQuoteExpiresAt) : '',
        },
        quoteCompare: this.buildCompare(s, this.data.result),
        statusText: textMap[s.status] || s.status,
        currentStep: done ? 3 : (['matched', 'factory_quoted'].includes(s.status) ? 2 : 1),
        rejected: s.status === 'rejected',
        // F-12：被拒后可重新选厂；已接单/未匹配完成则锁定
        canSelect: !s.factory && ['quoted', 'rejected'].includes(s.status),
      });
    } catch (err) {
      // 状态查询失败不阻塞页面
    }
  },

  noop() {},

  /**
   * 工厂报价 vs 平台估价（同口径取总价，与「查看报价」弹窗里的 diff 一致）。
   * 把「贵不贵」摆到主视觉而不是埋在弹窗里：客户真正焦虑的就是这个。
   * 刻意不做「其他几家报了多少」的比价——撮合卡片不带价是既有商业策略（F-01/05），
   * 一旦同屏展示各家报价，工厂之间就是纯价格内卷，平台也失去差异价值。
   */
  buildCompare(status, result) {
    const sys = result && result.systemQuote;
    if (!status || !status.factoryQuotedPrice || !sys) return null;
    const sysTotal = Number(sys.totalPrice);
    const facTotal = Number(status.factoryQuotedPrice);
    if (!(sysTotal > 0) || !(facTotal > 0)) return null;
    const qty = Number(sys.quantity) || 0;
    const diff = Math.round(((facTotal - sysTotal) / sysTotal) * 1000) / 10;
    const label = diff > 0 ? '高于平台估价 ' + diff + '%'
      : (diff < 0 ? '低于平台估价 ' + Math.abs(diff) + '%' : '与平台估价持平');
    return {
      unitText: qty ? '¥' + (facTotal / qty).toFixed(2) + '/个' : '',
      totalText: '¥' + facTotal.toFixed(2),
      diff,
      label,
      tone: diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat'),
    };
  },

  // 返回上一页（自定义导航栏无原生返回按钮）
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/quote/quote' }) });
  },

  // 021 查看设计参考图大图
  previewDesignImg(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  // F-08：查看某厂实时报价（写看价记录由后端落库）
  async viewQuote(e) {
    const factoryId = e.currentTarget.dataset.factory;
    const factoryName = e.currentTarget.dataset.name || '';
    const inquiryId = this.data.result.inquiryId;
    if (!inquiryId) { return wx.showToast({ title: '询价未创建成功，请重新报价', icon: 'none' }); }
    this.setData({
      quoteModal: {
        ...this.data.quoteModal,
        visible: true, loading: true,
        factoryId, factoryName,
        factoryQuote: null, systemQuote: null, contact: null,
        breakdownList: [], breakdownOpen: false,
        diffPercent: 0, diffLabel: '',
        remainDays: -1, expired: false, error: '',
        expiresAt: null, countdown: '',
      },
    });
    try {
      const res = await api.request(`/api/c/factory/${factoryId}/quote/${inquiryId}`);
      const d = res.data || {};
      const fq = d.factoryQuote || {};
      const sys = d.systemQuote || {};
      const sysTotal = Number(sys.totalPrice) || 0;
      const facTotal = Number(fq.totalPrice) || 0;
      let diffPercent = 0;
      let diffLabel = '与参考价持平';
      if (sysTotal > 0 && facTotal > 0) {
        diffPercent = Math.round(((facTotal - sysTotal) / sysTotal) * 1000) / 10;
        if (diffPercent > 0) diffLabel = '高于参考价 ' + diffPercent + '%';
        else if (diffPercent < 0) diffLabel = '低于参考价 ' + Math.abs(diffPercent) + '%';
      }
      this.setData({
        quoteModal: {
          ...this.data.quoteModal,
          loading: false,
          factoryQuote: fq, systemQuote: sys, contact: d.contact || null,
          breakdownList: fmtBreakdown(fq.breakdown),
          diffPercent, diffLabel,
          remainDays: fq.remainDays != null ? fq.remainDays : -1,
          expiresAt: fq.expiresAt || null,
          // 首次渲染直接给出当前剩余，随后由每秒定时器接力刷新（避免首帧空白）
          countdown: fq.expiresAt ? fmtCountdown(new Date(fq.expiresAt).getTime() - Date.now()) : '',
        },
      });
      this.startQuoteCountdown();
    } catch (err) {
      // F-10：410 过期态单独展示，引导重新询价
      this.stopQuoteCountdown();
      this.setData({
        quoteModal: {
          ...this.data.quoteModal,
          loading: false,
          expired: err.statusCode === 410,
          error: err.message || '报价获取失败',
        },
      });
    }
  },

  closeQuoteModal() {
    if (this.data.quoteModal.loading) return;
    this.stopQuoteCountdown();
    this.setData({ quoteModal: { ...this.data.quoteModal, visible: false } });
  },

  // ---- F-10 报价有效期实时倒计时（expiresAt 为截止时间，每秒刷新；归零转过期态） ----
  startQuoteCountdown() {
    this.stopQuoteCountdown();
    const m = this.data.quoteModal;
    if (!m.visible || m.loading || m.expired || !m.expiresAt) return;
    this._cdTimer = setInterval(() => this.tickQuoteCountdown(), 1000);
  },

  stopQuoteCountdown() {
    if (this._cdTimer) {
      clearInterval(this._cdTimer);
      this._cdTimer = null;
    }
  },

  tickQuoteCountdown() {
    const m = this.data.quoteModal;
    if (!m.visible || m.expired || !m.expiresAt) { this.stopQuoteCountdown(); return; }
    const ms = new Date(m.expiresAt).getTime() - Date.now();
    if (!isFinite(ms) || ms <= 0) {
      // 倒计时归零：转 410 同款过期态，提示重新询价
      this.stopQuoteCountdown();
      this.setData({ quoteModal: { ...this.data.quoteModal, expired: true, countdown: '', remainDays: 0 } });
      return;
    }
    this.setData({ quoteModal: { ...this.data.quoteModal, countdown: fmtCountdown(ms) } });
  },

  toggleQuoteBreakdown() {
    this.setData({ 'quoteModal.breakdownOpen': !this.data.quoteModal.breakdownOpen });
  },

  // 弹窗内「确认选此工厂」
  confirmSelect() {
    const factoryId = this.data.quoteModal.factoryId;
    this.closeQuoteModal();
    if (factoryId) this.doSelectFactory(factoryId);
  },

  // 选定工厂：已登录且已绑手机号直接推送；否则先弹手机号授权
  async doSelectFactory(factoryId) {
    const inquiryId = this.data.result.inquiryId;
    if (!inquiryId) { return wx.showToast({ title: '询价未创建成功，请重新报价', icon: 'none' }); }
    let nickname = ''; let phone = ''; let loggedIn = false;
    try {
      const me = await api.request('/api/c/user/me');
      loggedIn = true;
      nickname = (me.data && me.data.nickname) || '';
      phone = (me.data && me.data.phone) || '';
    } catch (err) { /* 未登录：按匿名留联系方式处理 */ }
    if (phone) return this.pushToFactory(inquiryId, factoryId, nickname, phone);
    this.setData({
      phoneModal: { visible: true, phone: '', factoryId, mode: loggedIn ? 'bind' : 'contact', submitting: false },
    });
  },

  onPhoneInput(e) {
    this.setData({ 'phoneModal.phone': e.detail.value });
  },

  closePhoneModal() {
    if (this.data.phoneModal.submitting) return;
    this.setData({ phoneModal: { ...this.data.phoneModal, visible: false } });
  },

  // F-11：微信手机号一键授权（button open-type=getPhoneNumber）
  // 服务端未配置 WX_APPID/WX_SECRET 时兑换失败，自动降级为手动输入
  async onGetPhoneNumber(e) {
    const detail = e.detail || {};
    if (!detail.code) {
      wx.showToast({ title: '微信授权未成功，请手动输入', icon: 'none' });
      return;
    }
    this.setData({ 'phoneModal.submitting': true });
    try {
      await api.request('/api/c/user/phone', { method: 'PUT', data: { code: detail.code } });
      const factoryId = this.data.phoneModal.factoryId;
      this.setData({ phoneModal: { ...this.data.phoneModal, visible: false, submitting: false } });
      wx.showToast({ title: '授权成功', icon: 'success' });
      this.pushToFactory(this.data.result.inquiryId, factoryId, '', '');
    } catch (err) {
      this.setData({ 'phoneModal.submitting': false });
      wx.showToast({ title: (err.message || '授权失败') + '，请手动输入', icon: 'none' });
    }
  },

  // 手动输入手机号并确认
  async submitPhoneModal() {
    const { phone, factoryId, mode } = this.data.phoneModal;
    const trimmed = (phone || '').trim();
    if (!/^1[3-9]\d{9}$/.test(trimmed)) {
      return wx.showToast({ title: '手机号格式不正确', icon: 'none' });
    }
    this.setData({ 'phoneModal.submitting': true });
    try {
      if (mode === 'bind') {
        // 已登录：先绑定到账号（F-11 要求），随后推送无需再带 contactPhone
        await api.request('/api/c/user/phone', { method: 'PUT', data: { phone: trimmed } });
        try {
          const ua = wx.getStorageSync('userAuth');
          if (ua && ua.userId) wx.setStorageSync('userAuth', { ...ua, phone: trimmed });
        } catch (err) { /* 缓存同步失败不影响主流程 */ }
        this.setData({ phoneModal: { ...this.data.phoneModal, visible: false, submitting: false } });
        this.pushToFactory(this.data.result.inquiryId, factoryId, '', '');
      } else {
        // 匿名：仅作为联系方式随推送带给工厂
        this.setData({ phoneModal: { ...this.data.phoneModal, visible: false, submitting: false } });
        this.pushToFactory(this.data.result.inquiryId, factoryId, '', trimmed);
      }
    } catch (err) {
      this.setData({ 'phoneModal.submitting': false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 017：确认工厂正式报价并生成订单（金额以工厂报价为准，非系统参考价）
  async confirmFactoryQuote() {
    const s = this.data.statusData || {};
    if (s.status !== 'factory_quoted') return;
    const price = Number(s.factoryQuotedPrice) || 0;
    const content = '工厂正式报价 ¥' + price.toFixed(2)
      + (s.factoryQuoteRemark ? '\n工厂说明：' + s.factoryQuoteRemark : '')
      + '\n\n确认后将生成订单，可前往「我的 → 订单」支付。';
    const r = await new Promise((resolve) => wx.showModal({
      title: '确认工厂报价',
      content,
      confirmText: '确认下单',
      success: resolve,
    }));
    if (!r.confirm) return;
    try {
      await api.request(`/api/c/inquiry/${this.data.result.inquiryId}/confirm-quote`, { method: 'POST' });
      wx.showToast({ title: '已确认，订单已生成', icon: 'success' });
      this.refreshStatus();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.refreshStatus();
    }
  },

  // 推送需求给工厂（F-13 防重/410 等错误由后端返回，原样提示）
  async pushToFactory(inquiryId, factoryId, contactName, contactPhone) {
    wx.showLoading({ title: '推送中...', mask: true });
    try {
      await api.request(`/api/c/inquiry/${inquiryId}/select-factory`, {
        method: 'POST',
        data: {
          factoryId,
          contactName: contactName || undefined,
          contactPhone: contactPhone || undefined,
        },
      });
      wx.showToast({ title: '已推送，等待工厂报价', icon: 'success' });
      this.requestSubscribe();
      this.refreshStatus();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.refreshStatus(); // 409 等并发态下同步页面状态
    } finally {
      wx.hideLoading();
    }
  },

  // 拨打工厂电话
  callFactory(e) {
    const phone = e.currentTarget.dataset.phone;
    if (phone) wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  // 请求微信订阅消息授权（推送成功后触发；模板未配置时静默跳过）
  requestSubscribe() {
    const tmplIds = (getApp().globalData.subscribeTmplIds || []).filter(Boolean);
    if (!tmplIds.length) return;
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        const accepted = tmplIds.filter((t) => res[t] === 'accept');
        if (accepted.length) wx.showToast({ title: '已开启进度通知', icon: 'none' });
      },
      fail: () => { /* 用户拒绝或微信不支持时静默 */ },
    });
  },
});
