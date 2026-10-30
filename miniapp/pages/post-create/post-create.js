const api = require('../../utils/api');
const community = require('../../utils/community');

// 与后端 src/middlewares/upload.js 同口径：图片 5MB、视频 20MB（MEDIA_VIDEO_MAX_MB 默认值）。
// 端上先拦一道只是省流量，真正的限制在服务层，改这里不会放开后台口的上限。
const MAX_IMAGE_MB = 5;
const MAX_VIDEO_MB = 20;
const MAX_IMAGES = 9;
// 标题/正文长度上限直接写在 wxml 的 maxlength 里（100 / 5000）, 与服务层 MAX_TITLE_LEN、
// MAX_CONTENT_LEN 同值——端上没有函数调用可用, 与其把常量塞进 data 再拼字符串, 不如让它明明白白在模板上

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    // 版块只列启用的（后端 /categories 已过滤 is_active）, 停用版块发帖会被服务层拒绝
    categories: [],
    catNames: [],
    catIndex: -1,
    categoryCode: '',
    title: '',
    content: '',
    // 先传后发：选完就上传, 数组里存的是后端返回的相对路径, showSrc 只用于本地预览
    images: [],
    video: null,        // { url, src, duration, sizeText }
    cover: null,        // { url, src }
    uploading: 0,       // 正在传的文件数, >0 时禁掉发布按钮
    submitting: false,
    identityHint: '',
  },

  onLoad() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      this.setData({
        statusBarHeight: info.statusBarHeight,
        navBarHeight: (menu.top - info.statusBarHeight) * 2 + menu.height,
      });
    } catch (e) { /* 拿不到就用默认高度 */ }
    this.setData({ identityHint: community.identityHint() });
    this.loadCategories();
  },

  async loadCategories() {
    try {
      const res = await api.request('/api/c/community/categories');
      const list = (res.data && res.data.list) || [];
      this.setData({ categories: list, catNames: list.map((x) => x.name) });
    } catch (e) {
      wx.showToast({ title: e.message || '版块加载失败', icon: 'none' });
    }
  },

  onCatChange(e) {
    const i = Number(e.detail.value);
    const c = this.data.categories[i];
    if (!c) return;
    this.setData({ catIndex: i, categoryCode: c.code });
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },
  onContentInput(e) { this.setData({ content: e.detail.value }); },

  /**
   * 逐个上传（不并发）：并发时 wx.uploadFile 会同时开好几条连接, 弱网下更容易整批失败,
   * 而且进度文案没法对齐到具体某一张
   */
  chooseImages() {
    const rest = MAX_IMAGES - this.data.images.length;
    if (rest <= 0) return wx.showToast({ title: '最多 ' + MAX_IMAGES + ' 张', icon: 'none' });
    wx.chooseMedia({
      count: rest,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (r) => {
        const files = r.tempFiles || [];
        // 体积端上先拦：超过 5MB 传上去也是 400, 白跑一趟流量
        const big = files.find((f) => (Number(f.size) || 0) > MAX_IMAGE_MB * 1024 * 1024);
        if (big) return wx.showToast({ title: '单张图片不超过 ' + MAX_IMAGE_MB + 'MB', icon: 'none' });
        this.uploadImages(files.map((f) => f.tempFilePath));
      },
    });
  },

  async uploadImages(paths) {
    if (!paths.length) return;
    this.setData({ uploading: this.data.uploading + paths.length });
    wx.showLoading({ title: '上传中…', mask: true });
    try {
      const added = [];
      for (const p of paths) {
        const url = await this.uploadOne('/api/c/community/media-image', p);
        added.push({ url, src: url });
      }
      this.setData({ images: this.data.images.concat(added).slice(0, MAX_IMAGES) });
    } catch (e) {
      wx.showToast({ title: e.message || '图片上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: Math.max(0, this.data.uploading - paths.length) });
      wx.hideLoading();
    }
  },

  /** 上传单张配图或封面：返回后端给的 /uploads/community/xxx 相对路径 */
  uploadOne(path, filePath, formData) {
    return api.upload(path, filePath, formData || {}, { headers: community.identityHeaders() });
  },

  removeImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const images = this.data.images.slice();
    images.splice(i, 1);
    this.setData({ images });
  },

  previewImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const urls = this.data.images.map((x) => community.mediaUrl(x.url));
    if (!urls.length) return;
    wx.previewImage({ current: urls[i] || urls[0], urls });
  },

  chooseVideo() {
    if (this.data.video) return wx.showToast({ title: '一条帖只能带一个视频', icon: 'none' });
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      compressed: true,
      maxDuration: 60,
      camera: 'back',
      success: (res) => {
        const sizeMb = Math.round((Number(res.size) || 0) / 1024 / 1024 * 10) / 10;
        if (sizeMb > MAX_VIDEO_MB) {
          return wx.showToast({ title: '视频 ' + sizeMb + 'MB 超过 ' + MAX_VIDEO_MB + 'MB 上限', icon: 'none' });
        }
        this.uploadVideo(res, sizeMb);
      },
    });
  },

  async uploadVideo(res, sizeMb) {
    this.setData({ uploading: 1 });
    wx.showLoading({ title: '视频上传中…', mask: true });
    try {
      const d = await this.uploadOne('/api/c/community/media-video', res.tempFilePath, {
        // 时长由端上给（wx.chooseVideo 返回秒数）, 服务端不解析容器元数据
        duration: Math.round(Number(res.duration) || 0),
      });
      this.setData({
        video: { url: d.url, src: res.tempFilePath, duration: d.duration || 0, sizeText: sizeMb + 'MB' },
      });
    } catch (e) {
      wx.showToast({ title: e.message || '视频上传失败', icon: 'none' });
    } finally {
      this.setData({ uploading: 0 });
      wx.hideLoading();
    }
  },

  removeVideo() {
    this.setData({ video: null, cover: null });
  },

  /** 视频封面走配图通道（后端没为社区单开封面接口）：传完只当 coverUrl 用, 不进九宫格 */
  chooseCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: async (r) => {
        const f = (r.tempFiles || [])[0];
        if (!f) return;
        this.setData({ uploading: 1 });
        wx.showLoading({ title: '上传中…', mask: true });
        try {
          const d = await this.uploadOne('/api/c/community/media-image', f.tempFilePath);
          this.setData({ cover: { url: d.url, src: f.tempFilePath } });
        } catch (e) {
          wx.showToast({ title: e.message || '封面上传失败', icon: 'none' });
        } finally {
          this.setData({ uploading: 0 });
          wx.hideLoading();
        }
      },
    });
  },

  removeCover() { this.setData({ cover: null }); },

  /** 本地校验的文案与服务层一致：让人在按发布前就知道差在哪, 而不是收到 400 再猜 */
  validate() {
    if (!this.data.categoryCode) return '请选择版块';
    if (!this.data.title.trim()) return '请填写标题';
    if (this.data.content.trim().length < 5) return '正文至少 5 个字';
    return '';
  },

  async submit() {
    if (this.data.uploading) return wx.showToast({ title: '文件上传中…', icon: 'none' });
    if (this.data.submitting) return;
    const msg = this.validate();
    if (msg) return wx.showToast({ title: msg, icon: 'none' });
    this.setData({ submitting: true });
    try {
      await api.request('/api/c/community/post', {
        method: 'POST',
        data: {
          categoryCode: this.data.categoryCode,
          title: this.data.title.trim(),
          content: this.data.content.trim(),
          images: this.data.images.map((x) => x.url),
          videoUrl: this.data.video ? this.data.video.url : undefined,
          coverUrl: this.data.cover ? this.data.cover.url : undefined,
        },
        headers: community.identityHeaders(),
      });
      wx.showToast({ title: '已发布', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/community/community' }) }), 700);
    } catch (e) {
      const m = e.message || '发布失败';
      wx.showModal({
        title: e.statusCode === 401 ? '需要先登录' : '发布失败',
        content: e.statusCode === 401 ? '登录后才能发布内容，社区里工厂与客户发的内容审核线不同。' : m,
        showCancel: false,
      });
    } finally { this.setData({ submitting: false }); }
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/community/community' }) }); },
});
