const api = require('../../utils/api');

// 轮询间隔（无长连接依赖，页面在显示时定时拉取新消息）
const POLL_MS = 15000;
const MAX_LEN = 500;

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
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
    messages: [],
    lastId: 0,         // scroll-into-view 锚点（末尾消息 id）
    inputText: '',
    sending: false,
    loading: true,
    keyboardHeight: 0,
    inputBarH: 56,     // 底部输入栏固定高度（px，与 wxss 同步）
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
    this.setData({
      inquiryId,
      factoryId: isFactory ? (factoryAuth.factoryId || 0) : factoryId,
      isFactory,
      title: decodeURIComponent(options.title || '') || (isFactory ? '客户' : '工厂'),
      subTip: decodeURIComponent(options.no || ''),
      loading: true,
    });
    wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: this.data.title });
    this.refresh(true);
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
      const list = (res.data.list || []).map((m) => ({
        id: m.id,
        mine: m.sender_type === viewerType,
        content: m.content,
        timeText: formatTime(m.created_at),
      }));
      const lastId = list.length ? list[list.length - 1].id : 0;
      this._tailId = lastId;
      // scroll-into-view 同值不重滚：先清 0 再回到末尾消息锚点
      this.setData({ messages: list, loading: false, lastId: 0 }, () => {
        if (scrollToBottom) this.setData({ lastId: this._tailId });
      });
      this.startPoll();
    } catch (err) {
      this.setData({ loading: false });
      if (!this.pollErrorShown) {
        this.pollErrorShown = true;
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      }
    }
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

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },
});
