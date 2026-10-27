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
    // 026 协同文件（当前 inquiry 会话的相关文件）
    files: [],
    filesExpanded: false,
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

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },
});
