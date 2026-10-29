const api = require('../../utils/api');
const { getAvatarConfig } = require('../../utils/avatar');
const { PRODUCT_TEXT } = require('../../utils/productText');
const { ORDER_STATUS_TEXT } = require('../../utils/orderText');

// 轮询间隔（无长连接依赖，页面在显示时定时拉取新消息）
const POLL_MS = 15000;
const MAX_LEN = 500;
// 顶部单据胶囊高度与上下留白（px, 与 wxss 同步）：消息区 top 需避开胶囊 + 两段间隙
const CTX_BAR_H = 36;
const CTX_GAP = 8;

// 询价状态文案（与 mine.js 的 STATUS_TEXT 同口径, 展开面板里用全称）
const INQ_STATUS_TEXT = {
  quoted: '已报价待选厂',
  matched: '已推送待工厂报价',
  factory_quoted: '工厂已报价待确认',
  user_confirmed: '已下单待支付',
  accepted: '工厂已接单',
  converted: '已下单',
  cancelled: '已取消',
  expired: '已过期',
};

/**
 * 胶囊上的短状态：全称（如「工厂已报价待确认」）在 36px 条里会顶到价格,
 * 且两端口吻不同——工厂关心「等谁」, 客户关心「我该干什么」
 */
function shortStatus(c, isFactory) {
  if (c.status === 'factory_quoted' && c.quoteExpired) return '报价已过期';
  const map = isFactory
    ? {
      quoted: '待客户选厂', matched: '待你报价', factory_quoted: '等客户确认',
      user_confirmed: '客户已下单', accepted: '已接单', converted: '已下单',
      cancelled: '已取消', expired: '已过期',
    }
    : {
      quoted: '待选定工厂', matched: '等工厂报价', factory_quoted: '待你确认下单',
      user_confirmed: '已下单待支付', accepted: '工厂已接单', converted: '已下单',
      cancelled: '已取消', expired: '已过期',
    };
  return map[c.status] || '';
}

/** 状态圆点配色：待办橙、在途蓝、终态灰绿, 让「该行动」一眼跳出来 */
function statusDot(c) {
  if (['cancelled', 'expired'].includes(c.status) || (c.status === 'factory_quoted' && c.quoteExpired)) return 'off';
  if (c.status === 'factory_quoted') return 'hot';
  if (c.status === 'quoted' || c.status === 'matched') return 'wait';
  return 'done';
}

// 微信式时间分级：今天 HH:mm / 昨天 HH:mm / 本年 M月D日 HH:mm / 跨年带年份
function formatChatTime(d) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  const now = new Date();
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  const dayDiff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (dayDiff === 0) return hm;
  if (dayDiff === 1) return '昨天 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    inquiryId: 0,
    factoryId: 0,      // 会话对家工厂（客户侧必填；工厂侧服务端按令牌强制为本厂）
    isFactory: false,  // 工厂视角（from=factory 且有接单登录态）
    title: '',         // 对家名称（客户看厂名，工厂看客户名）
    subTip: '',        // 副标题（询价单号等）
    // 会话双方头像：对方按名称 hash 取首字底色, 我方优先真实头像（C 端）/首字（工厂端、无头像）
    peerAvatarText: '对',
    peerAvatarColor: '#64748b',
    myAvatarText: '我',
    myAvatarColor: '#334155',   // 固定中性底（不与右侧蓝气泡同色）, 仅无真实头像时用于首字底
    myAvatarFull: '',
    messages: [],
    lastId: 0,         // scroll-into-view 锚点（末尾消息 id）
    inputText: '',
    sending: false,
    loading: true,
    keyboardHeight: 0,
    inputBarH: 56,     // 底部输入栏固定高度（px，与 wxss 同步）
    // 026 协同文件（当前 inquiry 会话的相关文件）
    files: [],
    filesExpanded: false,
    // 会话顶部实时单据卡（服务端每次现取, 价格/状态永远是当前的）
    ctx: null,
    ctxOpen: false,
    ctxBarH: CTX_BAR_H,
    ctxGap: CTX_GAP,
    // 工厂就地改价弹层（仅 ctx.canRequote 时可开）
    rq: { show: false, price: '', validDays: '7', remark: '', submitting: false },
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }

    const inquiryId = parseInt(options.inquiryId, 10) || 0;
    const factoryId = parseInt(options.factoryId, 10) || 0;
    const factoryAuth = wx.getStorageSync('factoryAuth');
    const isFactory = options.from === 'factory' && !!(factoryAuth && factoryAuth.token);
    if (!inquiryId || (!isFactory && !factoryId)) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    const peerTitle = decodeURIComponent(options.title || '') || (isFactory ? '客户' : '工厂');
    const inqNo = decodeURIComponent(options.no || '');
    this.setData({
      inquiryId,
      factoryId: isFactory ? (factoryAuth.factoryId || 0) : factoryId,
      isFactory,
      title: peerTitle,
      // 入口页拿不到对家名时会退化成传单号, 此时副标题再挂一遍就是重复
      subTip: inqNo === peerTitle ? '' : inqNo,
      loading: true,
    });
    wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: this.data.title });
    this.syncAvatars();
    this.refresh(true);
  },

  // 会话双方头像：对家名与全站工厂首字头像同源（utils/avatar）, 我方优先真实头像
  // peerName 用于 ctx 回填对家真名后重算头像（此时 this.data.title 尚未刷到回调里）
  syncAvatars(peerName) {
    const peer = getAvatarConfig(peerName || this.data.title || '');
    const out = { peerAvatarText: peer.text, peerAvatarColor: peer.color, myAvatarFull: '' };
    const src = (this.data.isFactory ? wx.getStorageSync('factoryAuth') : wx.getStorageSync('userAuth')) || {};
    // C 端有真实头像就直接用图
    if (!this.data.isFactory && src.avatarUrl) {
      out.myAvatarFull = api.BASE_URL + src.avatarUrl;
      return this.setData(out);
    }
    const name = this.data.isFactory ? (src.factoryName || src.name || '') : (src.nickname || '');
    if (name) out.myAvatarText = getAvatarConfig(name).text;
    // 我方底色固定中性深灰蓝：hash 调色板含 #2563eb/#4f46e5, 与右侧蓝色气泡同侧会糊成一片
    this.setData(out);
  },

  onShow() {
    if (this.data.inquiryId && !this.data.loading) this.startPoll();
  },

  onHide() { this.stopPoll(); },
  onUnload() { this.stopPoll(); },

  startPoll() {
    this.stopPoll();
    this.pollTimer = setInterval(() => this.refresh(), POLL_MS);
  },
  stopPoll() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  },

  authHeaders() {
    if (!this.data.isFactory) return {};
    const a = wx.getStorageSync('factoryAuth') || {};
    return { 'X-Factory-Id': String(a.factoryId), 'X-Factory-Token': a.token };
  },

  // 拉取会话消息（进入即把对方消息标已读，返回 readNow 供上层刷新徽标）
  async refresh(scrollToBottom) {
    if (!this.data.inquiryId) return;
    try {
      const res = await api.request('/api/messages/thread/' + this.data.inquiryId
        + '?factoryId=' + this.data.factoryId, { headers: this.authHeaders() });
      const viewerType = this.data.isFactory ? 'factory' : 'user';
      // 微信式时间分隔：与上一条间隔超 5 分钟才在气泡上方插入居中时间，连续消息不挂时间
      const list = [];
      let prevTs = 0;
      for (const m of (res.data.list || [])) {
        const d = new Date(m.created_at);
        const ts = isNaN(d.getTime()) ? 0 : d.getTime();
        const showTime = !prevTs || ts - prevTs > 5 * 60 * 1000;
        if (ts) prevTs = ts;
        list.push({
          id: m.id,
          mine: m.sender_type === viewerType,
          // 系统留痕（如工厂改价）：居中灰条, 不走头像与左右气泡
          system: m.sender_type === 'system',
          content: m.content,
          showTime,
          timeText: showTime && ts ? formatChatTime(d) : '',
        });
      }
      const lastId = list.length ? list[list.length - 1].id : 0;
      this._tailId = lastId;
      const c = res.data.context || null;
      const ctx = c ? {
        ...c,
        statusText: INQ_STATUS_TEXT[c.status] || c.status,
        shortText: shortStatus(c, this.data.isFactory),
        dotClass: statusDot(c),
        productText: PRODUCT_TEXT[c.productType] || c.productType || '',
        orderStatusText: c.orderStatus ? (ORDER_STATUS_TEXT[c.orderStatus] || c.orderStatus) : '',
        revisionText: c.revision > 1 ? `已调价 ${c.revision - 1} 次` : '',
      } : null;
      // 标题回填对家真名：入口页常拿不到联系人名而退化成单号, 单据条就不再重复显单号
      const peer = ctx ? (this.data.isFactory ? ctx.customerName : ctx.factoryName) : '';
      const patch = { messages: list, loading: false, lastId: 0, ctx };
      if (peer && peer !== this.data.title) {
        patch.title = peer;
        this.syncAvatars(peer);
      }
      if (ctx && ctx.inquiryNo) patch.subTip = ctx.inquiryNo;
      // scroll-into-view 同值不重滚：先清 0 再回到末尾消息锚点
      this.setData(patch, () => {
        if (scrollToBottom) this.setData({ lastId: this._tailId });
      });
      this.startPoll();
      this.loadFiles();
    } catch (err) {
      this.setData({ loading: false });
      if (!this.pollErrorShown) {
        this.pollErrorShown = true;
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      }
    }
  },

  // 026 拉取当前询价会话的文件列表
  async loadFiles() {
    try {
      const path = this.data.isFactory ? '/api/factory/file/list' : '/api/c/file/list';
      const res = await api.request(path + '?refType=inquiry&refId=' + this.data.inquiryId,
        { headers: this.authHeaders() });
      const viewerType = this.data.isFactory ? 'factory' : 'user';
      const list = ((res.data && res.data.list) || []).map((f) => ({
        ...f,
        fullUrl: api.BASE_URL + f.file_url,
        senderText: f.sender_type === viewerType ? '我' : (f.sender_type === 'factory' ? '工厂' : '客户'),
        sizeText: f.file_size > 1048576 ? (f.file_size / 1048576).toFixed(1) + 'MB' : Math.ceil(f.file_size / 1024) + 'KB',
      }));
      this.setData({ files: list });
    } catch (e) { /* 静默 */ }
  },

  toggleFiles() {
    this.setData({ filesExpanded: !this.data.filesExpanded });
  },

  // 弹层内 catchtap 占位：阻止点击面板时冒泡到遮罩关闭
  noop() {},

  openFile(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.downloadFile({
      url,
      success: (r) => {
        wx.openDocument({
          filePath: r.tempFilePath,
          showMenu: true,
          fail: () => wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '链接已复制', icon: 'none' }) }),
        });
      },
      fail: () => wx.showToast({ title: '下载失败', icon: 'none' }),
    });
  },

  // 026 选择并上传文件（微信聊天文件选取）
  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (r) => {
        const file = r.tempFiles[0];
        if (!file) return;
        const extMatch = /\.(\w+)$/.exec(file.name || '');
        const ext = extMatch ? extMatch[1].toLowerCase() : '';
        const ALLOWED = ['pdf','ai','cdr','psd','eps','zip','rar','7z','jpg','jpeg','png','tif','tiff','svg','dwg'];
        if (!ALLOWED.includes(ext)) {
          return wx.showToast({ title: '不支持的文件类型', icon: 'none' });
        }
        if (file.size > 20 * 1024 * 1024) {
          return wx.showToast({ title: '文件最大 20MB', icon: 'none' });
        }
        this.uploadFile(file);
      },
    });
  },

  uploadFile(file) {
    const token = this.data.isFactory
      ? (wx.getStorageSync('factoryAuth') || {}).token
      : (wx.getStorageSync('userAuth') || {}).token;
    const header = {};
    if (this.data.isFactory) {
      header['X-Factory-Id'] = String((wx.getStorageSync('factoryAuth') || {}).factoryId || '');
      header['X-Factory-Token'] = token || '';
    } else {
      header['X-User-Token'] = token || '';
    }
    const url = api.BASE_URL + (this.data.isFactory ? '/api/factory/file/upload' : '/api/c/file/upload');
    wx.showLoading({ title: '上传中', mask: true });
    wx.uploadFile({
      url,
      filePath: file.path,
      name: 'file',
      formData: { refType: 'inquiry', refId: String(this.data.inquiryId) },
      header,
      success: (res) => {
        wx.hideLoading();
        let data = {};
        try { data = JSON.parse(res.data); } catch (e) {}
        if (data && data.code === 0) {
          wx.showToast({ title: '文件已发送', icon: 'success' });
          this.loadFiles();
          this.setData({ filesExpanded: true });
        } else {
          wx.showToast({ title: (data && data.msg) || '上传失败', icon: 'none' });
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '上传失败', icon: 'none' }); },
    });
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  // 键盘弹出时抬底栏，避免输入框被挡
  onFocus(e) {
    if (e.detail && e.detail.height) this.setData({ keyboardHeight: e.detail.height });
  },
  onBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  async send() {
    const content = (this.data.inputText || '').trim();
    if (!content) return;
    if (content.length > MAX_LEN) {
      return wx.showToast({ title: '单条消息最长 ' + MAX_LEN + ' 字', icon: 'none' });
    }
    if (this.data.sending) return;
    this.setData({ sending: true });
    try {
      await api.request('/api/messages/send', {
        method: 'POST',
        data: { inquiryId: this.data.inquiryId, factoryId: this.data.factoryId, content },
        headers: this.authHeaders(),
      });
      this.setData({ inputText: '', sending: false });
      await this.refresh(true);
    } catch (err) {
      this.setData({ sending: false });
      wx.showToast({ title: err.message || '发送失败', icon: 'none' });
    }
  },

  // ===== 顶部单据卡：展开收起 / 工厂就地改价 =====

  toggleCtx() {
    this.setData({ ctxOpen: !this.data.ctxOpen });
  },

  // 单号已从胶囊收进面板, 给一个直接可复制的落点（报修/对单时要手写这串）
  copyInquiryNo(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  // 客户视角：本页面不承载下单, 报价待确认时直达「我的-询价」点确认
  goConfirmQuote() {
    wx.switchTab({ url: '/pages/mine/mine' });
  },

  // 预填当前价与说明：议价后降价是在原数上改, 不是从零重填
  openRequote() {
    const c = this.data.ctx || {};
    this.setData({
      ctxOpen: false,
      rq: {
        show: true,
        price: c.factoryPrice != null ? String(c.factoryPrice) : '',
        validDays: '7',
        remark: c.quoteRemark || '',
        submitting: false,
      },
    });
  },

  closeRequote() {
    if (this.data.rq.submitting) return;
    this.setData({ 'rq.show': false });
  },

  onRqPriceInput(e) { this.setData({ 'rq.price': e.detail.value }); },
  onRqDaysInput(e) { this.setData({ 'rq.validDays': e.detail.value }); },
  onRqRemarkInput(e) { this.setData({ 'rq.remark': e.detail.value }); },

  // 提交改价：走与首次报价同一接口（后端按状态识别改价）, 成功后会话里会多出一条系统留痕
  async submitRequote() {
    const m = this.data.rq;
    const c = this.data.ctx || {};
    const price = Number((m.price || '').trim());
    if (!isFinite(price) || price <= 0) {
      return wx.showToast({ title: '请输入大于 0 的报价金额', icon: 'none' });
    }
    const days = parseInt(m.validDays, 10);
    if (!isFinite(days) || days < 1 || days > 30) {
      return wx.showToast({ title: '有效期需为 1-30 天', icon: 'none' });
    }
    if (!c.pushId) return wx.showToast({ title: '缺少推送记录, 请回接单页操作', icon: 'none' });
    this.setData({ 'rq.submitting': true });
    try {
      await api.request('/api/factory/inquiry/' + c.pushId + '/quote', {
        method: 'POST',
        data: { price, remark: (m.remark || '').trim() || undefined, validDays: days },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '已改价并通知客户', icon: 'success' });
      this.setData({ 'rq.show': false, 'rq.submitting': false });
      await this.refresh(true);
    } catch (err) {
      this.setData({ 'rq.submitting': false });
      wx.showToast({ title: err.message, icon: 'none' });
      this.refresh(true); // 并发下可能已被客户确认/报价过期, 拉一次让单据卡回到真相
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },
});
