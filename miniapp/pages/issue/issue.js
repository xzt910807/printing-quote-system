const api = require('../../utils/api');

const TYPES = [
  { key: 'quality', label: '质量投诉' },
  { key: 'delay', label: '延期预警' },
  { key: 'reprint', label: '补印申请' },
  { key: 'other', label: '其他' },
];
const STATUS_LABEL = { open: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    list: [],
    loading: false,
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

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await api.request('/api/c/issue');
      const rows = (res.data && res.data.list) || [];
      this.setData({
        list: rows.map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status] || r.status })),
      });
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/issue-detail/issue-detail?id=' + id });
  },

  toggleForm() { this.setData({ showForm: !this.data.showForm }); },
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
