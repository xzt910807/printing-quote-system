const api = require('../../utils/api');

const TYPE_LABEL = { quality: '质量投诉', delay: '延期预警', reprint: '补印申请', other: '其他' };
const STATUS_LABEL = { open: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };

const ALLOWED_EXT = ['pdf','ai','cdr','psd','eps','zip','rar','7z','jpg','jpeg','png','tif','tiff','svg','dwg'];
const MAX_MB = 20;

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    id: 0,
    ticket: null,
    typeLabel: '',
    statusLabel: '',
    loading: false,
    closing: false,
    files: [],
    uploading: false,
    role: 'customer',      // customer | factory，factory 走 /api/factory/issue 与 /api/factory/file
    factoryAuth: null,
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) { this.setData({ statusBarHeight: 20, navBarHeight: 44 }); }
    const id = parseInt((options && options.id) || '0', 10);
    const role = (options && options.role) === 'factory' ? 'factory' : 'customer';
    let factoryAuth = null;
    if (role === 'factory') {
      try { factoryAuth = wx.getStorageSync('factoryAuth') || null; } catch (e) { factoryAuth = null; }
      if (!factoryAuth) {
        wx.showToast({ title: '请先登录工厂账号', icon: 'none' });
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) }), 900);
        return;
      }
    }
    this.setData({ id, role, factoryAuth });
    this.loadDetail();
  },

  isFactory() { return this.data.role === 'factory'; },

  facHeaders() {
    const a = this.data.factoryAuth;
    if (!a) return {};
    return { 'X-Factory-Id': String(a.factoryId), 'X-Factory-Token': a.token };
  },

  async loadDetail() {
    if (!this.data.id) return;
    this.setData({ loading: true });
    try {
      const url = this.isFactory()
        ? '/api/factory/issue/' + this.data.id
        : '/api/c/issue/' + this.data.id;
      const res = await api.request(url, this.isFactory() ? { headers: this.facHeaders() } : {});
      const t = res.data || null;
      // 后端返回 UTC ISO 串，转本地时间展示
      if (t && t.created_at) {
        const d = new Date(t.created_at);
        if (!isNaN(d.getTime())) {
          const p = (n) => (n < 10 ? '0' + n : '' + n);
          t.timeText = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        }
      }
      this.setData({
        ticket: t,
        typeLabel: t ? (TYPE_LABEL[t.type] || t.type) : '',
        statusLabel: t ? (STATUS_LABEL[t.status] || t.status) : '',
      });
      this.loadFiles();
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  async loadFiles() {
    if (!this.data.id) return;
    try {
      const url = '/list?refType=issue&refId=' + this.data.id;
      const res = this.isFactory()
        ? await api.request('/api/factory/file' + url, { headers: this.facHeaders() })
        : await api.request('/api/c/file' + url);
      const list = (res.data && res.data.list) || [];
      this.setData({ files: list.map((f) => ({
        ...f,
        sizeText: formatSize(f.file_size),
        fullUrl: f.file_url && f.file_url.indexOf('http') === 0 ? f.file_url : api.BASE_URL + f.file_url,
      })) });
    } catch (e) { this.setData({ files: [] }); }
  },

  openFile(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.downloadFile({ url, success: (r) => {
      wx.openDocument({ filePath: r.tempFilePath, showMenu: true, fail: () => wx.previewImage({ urls: [url] }) });
    }, fail: () => wx.showToast({ title: '下载失败', icon: 'none' }) });
  },

  chooseFile() {
    if (this.data.uploading) return;
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ALLOWED_EXT, success: (r) => {
      const f = r.tempFiles && r.tempFiles[0];
      if (!f) return;
      if (f.size > MAX_MB * 1024 * 1024) return wx.showToast({ title: '文件超 ' + MAX_MB + 'MB', icon: 'none' });
      this.uploadFile(f);
    } });
  },

  uploadFile(f) {
    this.setData({ uploading: true });
    // 旧版 C 端 token 读的是 storage 里根本不存在的 user_token 键（恒为空串 → requireUser 401）,
    // 换成 api.upload 后身份头由公共层统一注入
    api.upload(this.isFactory() ? '/api/factory/file/upload' : '/api/c/file/upload',
      f.path, { refType: 'issue', refId: String(this.data.id) },
      { headers: this.facHeaders() })
      .then(() => {
        wx.showToast({ title: '上传成功', icon: 'success' });
        this.loadFiles();
      })
      .catch((err) => wx.showToast({ title: err.message || '上传失败', icon: 'none' }))
      .finally(() => this.setData({ uploading: false }));
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = (this.data.ticket && this.data.ticket.images) || [];
    wx.previewImage({ current: url, urls });
  },

  async close() {
    if (this.data.closing) return;
    if (this.isFactory()) {
      wx.showToast({ title: '工厂端无权关闭工单', icon: 'none' });
      return;
    }
    const r = await wx.showModal({ title: '确认关闭', content: '关闭后工单不可再变更，确定？' });
    if (!r.confirm) return;
    this.setData({ closing: true });
    try {
      await api.request('/api/c/issue/' + this.data.id + '/close', { method: 'PUT' });
      wx.showToast({ title: '工单已关闭', icon: 'success' });
      this.loadDetail();
    } catch (e) {
      wx.showToast({ title: e.message || '关闭失败', icon: 'none' });
    } finally { this.setData({ closing: false }); }
  },

  // 工单号一键复制（与列表/我的页单号同交互）
  copyTicketNo(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  goBack() { wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/issue/issue' }) }); },
});

function formatSize(b) {
  b = Number(b) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
