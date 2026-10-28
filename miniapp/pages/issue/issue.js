const api = require('../../utils/api');

const TYPES = [
  { key: 'quality', label: '质量投诉' },
  { key: 'delay', label: '延期预警' },
  { key: 'reprint', label: '补印申请' },
  { key: 'other', label: '其他' },
];
const STATUS_LABEL = { open: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };
// 状态筛选 chips（key 空 = 全部）
const STATUS_CHIPS = [
  { key: '', label: '全部' },
  { key: 'open', label: '待处理' },
  { key: 'processing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'closed', label: '已关闭' },
];
const PAGE_SIZE = 20;

// 后端返回 UTC ISO 串，new Date 自动转本地时区
function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t).slice(0, 16).replace('T', ' ');
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    list: [],
    loading: false,
    // 服务端分页/搜索/状态筛（与我的页、会话列表同契约）
    statusChips: STATUS_CHIPS,
    status: '',
    searchKeyword: '',
    page: 1,
    hasMore: true,
    loadingMore: false,
    // 新建表单
    showForm: false,
    formTypes: TYPES,
    formType: 'quality',
    formOrderId: '',
    formTitle: '',
    formDesc: '',
    formImages: [],
    submitting: false,
    // 允许从订单页带参进来直接开单
    presetOrderId: 0,
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) { this.setData({ statusBarHeight: 20, navBarHeight: 44 }); }
    const preset = parseInt((options && options.orderId) || '0', 10);
    if (preset) {
      this.setData({ presetOrderId: preset, showForm: true, formOrderId: String(preset) });
    }
    this.loadList();
  },

  onShow() { this.loadList(); },
  onPullDownRefresh() { this.loadList().finally(() => wx.stopPullDownRefresh()); },

  async loadList(reset = true) {
    const page = reset ? 1 : this.data.page + 1;
    if (reset) this.setData({ loading: true });
    try {
      const res = await api.request('/api/c/issue', {
        data: {
          page,
          pageSize: PAGE_SIZE,
          keyword: (this.data.searchKeyword || '').trim(),
          status: this.data.status,
        },
      });
      const d = res.data || {};
      const mapped = (d.list || []).map((r) => ({
        ...r,
        statusLabel: STATUS_LABEL[r.status] || r.status,
        typeLabel: (TYPES.find((t) => t.key === r.type) || {}).label || r.type,
        timeText: formatTime(r.created_at),
      }));
      this.setData({
        list: reset ? mapped : this.data.list.concat(mapped),
        page,
        hasMore: !!d.hasMore,
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  // 触底加载下一页
  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    Promise.resolve(this.loadList(false)).finally(() => this.setData({ loadingMore: false }));
  },

  // 搜索 400ms 防抖走服务端（分页后本地过滤不可信）
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.loadList(true), 400);
  },
  clearSearch() {
    clearTimeout(this._searchTimer);
    this.setData({ searchKeyword: '' });
    this.loadList(true);
  },
  setStatus(e) {
    const st = e.currentTarget.dataset.k || '';
    if (st === this.data.status) return;
    this.setData({ status: st });
    this.loadList(true);
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/issue-detail/issue-detail?id=' + id });
  },

  // 工单号一键复制（与我的页询价/订单单号同交互）
  copyTicketNo(e) {
    const no = e.currentTarget.dataset.no;
    if (!no) return;
    wx.setClipboardData({
      data: String(no),
      success: () => wx.showToast({ title: '单号已复制', icon: 'success' }),
    });
  },

  toggleForm() { this.setData({ showForm: !this.data.showForm }); },
  noop() {}, // 弹层 catchtap 占位：点面板内部不冒泡到遮罩关闭
  setFormType(e) { this.setData({ formType: e.currentTarget.dataset.k }); },
  onInputOrderId(e) { this.setData({ formOrderId: e.detail.value }); },
  onInputTitle(e) { this.setData({ formTitle: e.detail.value }); },
  onInputDesc(e) { this.setData({ formDesc: e.detail.value }); },

  chooseImages() {
    wx.chooseMedia({
      count: 6 - this.data.formImages.length,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (r) => {
        const add = (r.tempFiles || []).map((f) => f.tempFilePath);
        this.setData({ formImages: this.data.formImages.concat(add).slice(0, 6) });
      },
    });
  },
  removeImage(e) {
    const idx = e.currentTarget.dataset.i;
    const arr = this.data.formImages.slice();
    arr.splice(idx, 1);
    this.setData({ formImages: arr });
  },

  // 简单上传：图片走 /uploads 静态（现有 image upload endpoint 复用即可；此处按最简实现，
  // 若后端未提供图片上传接口，则前端不真正上传，只把本地占位提交，实际图片需通过 wx.uploadFile 到统一图床接口）
  async submit() {
    const d = this.data;
    if (!d.formOrderId || !d.formTitle) {
      wx.showToast({ title: '请填写订单号和标题', icon: 'none' }); return;
    }
    this.setData({ submitting: true });
    try {
      let imgUrls = [];
      // 尝试上传（占位：实际部署需替换为真实图片上传接口）
      for (const tmp of d.formImages) {
        try {
          const res = await new Promise((resolve, reject) => {
            const auth = wx.getStorageSync('userAuth') || {};
            wx.uploadFile({
              url: api.BASE_URL + '/api/c/upload-image',
              filePath: tmp, name: 'file',
              header: { 'X-User-Id': String(auth.userId || ''), 'X-User-Token': auth.token || '' },
              success: (r) => {
                try { const j = JSON.parse(r.data); j.success ? resolve(j.data) : reject(new Error(j.error)); }
                catch (e) { reject(e); }
              },
              fail: reject,
            });
          });
          if (res && res.url) imgUrls.push(res.url);
        } catch (e) { /* 上传接口不存在则跳过（不阻断工单创建） */ }
      }
      await api.request('/api/c/issue', {
        method: 'POST',
        data: {
          orderId: parseInt(d.formOrderId, 10),
          type: d.formType,
          title: d.formTitle,
          description: d.formDesc,
          images: imgUrls,
        },
      });
      wx.showToast({ title: '工单已提交', icon: 'success' });
      this.setData({ showForm: false, formOrderId: '', formTitle: '', formDesc: '', formImages: [] });
      this.loadList();
    } catch (e) {
      wx.showToast({ title: e.message || '提交失败', icon: 'none' });
    } finally { this.setData({ submitting: false }); }
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) }); },
});
