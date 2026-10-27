const api = require('../../utils/api');

Page({
  data: {
    // 自定义导航栏高度（与其他页面同一套算法）
    statusBarHeight: 20,
    navBarHeight: 44,
    apiBase: api.BASE_URL,
    productType: '',
    templates: [],
    templateThumbs: [], // 选择条缩略图（含定位样式，选中态高亮用）
    templateIndex: 0,
    currentSlots: [],   // 当前模板的文字槽位定义（表单用）
    texts: {},          // { slotKey: value }
    previewSlots: [],   // 实时预览：槽位 + 缩放后的定位样式
    previewLines: [],   // 实时预览：装饰线（模板 canvas.lines，分隔标题区等）
    previewH: 800,      // 预览区高度（rpx，按画布比例换算）
    previewBg: '#ffffff',
    rendering: false,
    designTab: 'tpl',   // 顶部方式切换：tpl=模板排版（文字类）/ ai=AI 画参考图（图案类），互斥展示
    resultUrl: '',      // 生成成功的高清稿完整 URL
    resultThumb: '',    // 结果区预览用缩略图（base64 内联，真机大图加载慢/受域名校验会空白）
    resultRelative: '', // 相对 URL（回传报价页用）
    resultPdf: '',      // 024 印刷 PDF 相对 URL（矢量制版文件，随单给工厂）
    resultMm: '',       // 成品尺寸提示（如 300x400，mm）
    // AI 生成参考图（021-b）
    aiPrompt: '',
    aiGenerating: false,
    aiResultUrl: '',      // AI 稿完整 URL（展示）
    aiResultRelative: '', // AI 稿相对 URL（回传报价页用）
    // 语音描述设计（F-105 同款通道：原生录音 → 后端讯飞 ASR → 追加进 aiPrompt）
    voiceRecording: false,
  },

  onLoad(options) {
    // 自定义导航栏高度（与其他页面同一套算法）
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }

    const productType = (options && options.productType) || '';
    this.setData({ productType });
    this.loadTemplates(productType);
  },

  // 拉模板：优先当前品类；该品类没有则回落全量（用户可换个有模板的品类排版）
  async loadTemplates(productType) {
    try {
      let res = await api.request('/api/c/design/templates' + (productType ? '?productType=' + productType : ''));
      let list = (res.data && res.data.list) || [];
      if (!list.length && productType) {
        res = await api.request('/api/c/design/templates');
        list = (res.data && res.data.list) || [];
      }
      this.setData({
        templates: list,
        templateThumbs: list.map((t) => this.buildThumb(t)),
      });
      if (list.length) this.selectTemplate(0);
    } catch (err) {
      wx.showToast({ title: err.message || '模板加载失败', icon: 'none' });
    }
  },

  selectTemplate(index) {
    const tpl = this.data.templates[index];
    if (!tpl) return;
    // 切模板保留已填文字（同 key 槽位通用：店名/副标题/电话）
    const texts = { ...this.data.texts };
    (tpl.canvas.texts || []).forEach((s) => {
      if (texts[s.key] === undefined) texts[s.key] = '';
    });
    this.setData({
      templateIndex: index,
      currentSlots: tpl.canvas.texts || [],
      texts,
      resultUrl: '',
      resultThumb: '',
      resultRelative: '',
      resultPdf: '',
      resultMm: '',
    }, () => this.rebuildPreview());
  },

  // 字号自适应：文字按字号排满会超画布宽 88% 时缩字号（CJK 字宽≈1em，粗算保守），
  // 与后端 renderTemplate 的 SVG 缩字号公式保持一致，保证预览所见 = 生成所得
  fitFontSize(len, size, canvasW) {
    const n = parseInt(len, 10) || 0;
    if (!n) return size;
    return Math.min(size, Math.floor((canvasW * 0.88) / n));
  },

  // 画布装饰线 → 预览细条样式（横线：以线中心定位，宽度=线长，高度=线宽）
  buildLines(lines, scale) {
    return (lines || []).map((l, i) => {
      const x2 = l.x2 != null ? l.x2 : (l.x || 0) + 200;
      const cx = ((l.x || 0) + x2) / 2;
      const lw = Math.abs(x2 - (l.x || 0));
      const strokeW = l.width || 6;
      return {
        key: 'ln' + i,
        style: 'left:' + Math.round(cx * scale) + 'rpx;'
          + 'top:' + Math.round(((l.y || 0) - strokeW / 2) * scale) + 'rpx;'
          + 'width:' + Math.round(lw * scale) + 'rpx;'
          + 'height:' + Math.max(2, Math.round(strokeW * scale)) + 'rpx;'
          + 'background:' + (l.stroke || '#000000') + ';'
          + (l.opacity != null ? 'opacity:' + l.opacity + ';' : ''),
      };
    });
  },

  // 模板缩略图：画布等比缩到 150rpx 宽，槽位画占位文字（标签名），选模板用
  buildThumb(tpl) {
    const { w, h, bg, texts, lines } = tpl.canvas;
    const scale = 150 / w;
    return {
      id: tpl.id,
      name: tpl.name,
      w: 150,
      h: Math.round(h * scale),
      bg: bg || '#ffffff',
      lines: this.buildLines(lines, scale),
      slots: (texts || []).map((s) => {
        const size = Math.max(10, Math.round(this.fitFontSize((s.label || '').length, s.size, w) * scale));
        let style = 'left:' + Math.round(s.x * scale) + 'rpx;'
          + 'top:' + Math.round((s.y - s.size * 0.82) * scale) + 'rpx;'
          + 'font-size:' + size + 'rpx;';
        if (s.align === 'left') style += 'transform:translateX(0);';
        else if (s.align === 'right') style += 'transform:translateX(-100%);';
        else style += 'transform:translateX(-50%);';
        return { key: s.key, style, label: s.label };
      }),
    };
  },

  onTemplateTap(e) {
    this.selectTemplate(Number(e.currentTarget.dataset.index));
  },

  onTextInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ ['texts.' + key]: e.detail.value, resultUrl: '', resultThumb: '', resultRelative: '' }, () => this.rebuildPreview());
  },

  // 画布坐标 → 预览区 rpx 样式（scale = 预览宽 620rpx / 画布宽）
  rebuildPreview() {
    const tpl = this.data.templates[this.data.templateIndex];
    if (!tpl || !tpl.canvas) return;
    const { w, h, bg, texts, lines } = tpl.canvas;
    const scale = 620 / w;
    this.setData({
      previewH: Math.round(h * scale),
      previewBg: bg,
      previewLines: this.buildLines(lines, scale),
      previewSlots: (texts || []).map((s) => {
        const value = this.data.texts[s.key] || '';
        const size = Math.round(this.fitFontSize(value.length, s.size, w) * scale);
        let style = 'left:' + Math.round(s.x * scale) + 'rpx;'
          + 'top:' + Math.round((s.y - s.size * 0.82) * scale) + 'rpx;'
          + 'font-size:' + size + 'rpx;'
          + 'color:' + s.color + ';';
        if (s.align === 'left') style += 'transform:translateX(0);';
        else if (s.align === 'right') style += 'transform:translateX(-100%);';
        else style += 'transform:translateX(-50%);';
        return { key: s.key, label: s.label, style, value };
      }),
    });
  },

  // 生成高清稿：服务端按模板渲染 PNG（文字矢量光栅化，中文零错误）
  async render() {
    const tpl = this.data.templates[this.data.templateIndex];
    if (!tpl) return;
    const title = (this.data.texts.title || '').trim();
    if (!title) return wx.showToast({ title: '先填店名/主标题', icon: 'none' });
    this.setData({ rendering: true });
    try {
      const res = await api.request('/api/c/design/render', {
        method: 'POST',
        data: { templateId: tpl.id, texts: this.data.texts },
      });
      const d = res.data || {};
      this.setData({
        rendering: false,
        resultUrl: d.url ? api.BASE_URL + d.url : '',
        resultThumb: d.thumb || '',
        resultRelative: d.url || '',
        // 024 印刷 PDF（矢量制版文件）：配置了成品尺寸的模板会同步产出
        resultPdf: d.pdfUrl || '',
        resultMm: d.mm ? d.mm.w + 'x' + d.mm.h : '',
      });
    } catch (err) {
      this.setData({ rendering: false });
      wx.showToast({ title: err.message || '生成失败，请重试', icon: 'none' });
    }
  },

  // 使用此设计：回传报价页参考图列表（报价页 onShow 读取）；pdfUrl 一并透传随单给工厂
  useDesign() {
    if (!this.data.resultRelative) return;
    wx.setStorageSync('designResult', { url: this.data.resultRelative, pdfUrl: this.data.resultPdf });
    wx.showToast({ title: '已采用，返回报价页', icon: 'none' });
    setTimeout(() => wx.navigateBack(), 600);
  },

  // 返回上一页（自定义导航栏无原生返回按钮）
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/quote/quote' }) });
  },

  // 预览高清稿大图
  previewResult() {
    if (this.data.resultUrl) wx.previewImage({ urls: [this.data.resultUrl] });
  },

  // 重新编辑：清掉结果，滚回顶部改文字
  editAgain() {
    this.setData({ resultUrl: '', resultThumb: '', resultRelative: '', resultPdf: '', resultMm: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // 顶部「模板排版 / AI 画参考图」互斥切换：两种方式同屏并列会让用户误以为填文字就能 AI 出图
  switchDesignTab(e) {
    this.setData({ designTab: e.currentTarget.dataset.tab });
  },

  // 空态返回报价页
  editBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/quote/quote' }) });
  },

  // ===== 021-b AI 生成参考图：描述感觉 → 服务端调 new-api(agnes-image) 出图 =====
  onAiInput(e) {
    this.setData({ aiPrompt: e.detail.value });
  },

  async genAi() {
    const prompt = (this.data.aiPrompt || '').trim();
    if (!prompt) return wx.showToast({ title: '先描述你想要的图案', icon: 'none' });
    if (this.data.aiGenerating) return;
    this.setData({ aiGenerating: true });
    try {
      const res = await api.request('/api/c/design/ai-gen', {
        method: 'POST',
        data: { prompt },
      });
      const d = res.data || {};
      this.setData({
        aiGenerating: false,
        aiResultUrl: d.url ? api.BASE_URL + d.url : '',
        aiResultRelative: d.url || '',
      });
    } catch (err) {
      this.setData({ aiGenerating: false });
      wx.showToast({ title: (err.message || '生成失败').slice(0, 30), icon: 'none' });
    }
  },

  previewAi() {
    if (this.data.aiResultUrl) wx.previewImage({ urls: [this.data.aiResultUrl] });
  },

  // 使用 AI 稿：与模板稿同一回传通道（报价页 onShow 读 designResult 加入参考图）
  useAiDesign() {
    if (!this.data.aiResultRelative) return;
    wx.setStorageSync('designResult', { url: this.data.aiResultRelative });
    wx.showToast({ title: '已采用，返回报价页', icon: 'none' });
    setTimeout(() => wx.navigateBack(), 600);
  },

  aiAgain() {
    this.setData({ aiResultUrl: '', aiResultRelative: '' });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  // ===== 语音描述设计（复用 F-105 通道：按住说话 → 后端讯飞 ASR → 追加进 aiPrompt）=====
  initRecorder() {
    if (this._recorder) return this._recorder;
    const mgr = wx.getRecorderManager();
    mgr.onStop((res) => {
      this.setData({ voiceRecording: false });
      if (res && res.tempFilePath) this.uploadVoice(res.tempFilePath);
    });
    mgr.onError(() => {
      this.setData({ voiceRecording: false });
      wx.showToast({ title: '录音失败，请重试', icon: 'none' });
    });
    this._recorder = mgr;
    return mgr;
  },

  uploadVoice(tempFilePath) {
    wx.showLoading({ title: '识别中...' });
    const header = {};
    try {
      const userAuth = wx.getStorageSync('userAuth');
      if (userAuth && userAuth.userId) {
        header['X-User-Id'] = String(userAuth.userId);
        header['X-User-Token'] = userAuth.token;
      }
    } catch (e) { /* 匿名可用 */ }
    wx.uploadFile({
      url: api.BASE_URL + '/api/voice/recognize',
      filePath: tempFilePath,
      name: 'audio',
      header,
      success: (res) => {
        wx.hideLoading();
        let body = null;
        try { body = JSON.parse(res.data); } catch (e) { /* 非 JSON 响应 */ }
        if (res.statusCode === 200 && body && body.success && body.data && body.data.text) {
          const text = String(body.data.text).trim();
          const old = (this.data.aiPrompt || '').trim();
          const merged = old ? (old + '，' + text).slice(0, 200) : text.slice(0, 200);
          this.setData({ aiPrompt: merged });
          wx.showToast({ title: '识别成功', icon: 'success' });
        } else {
          wx.showToast({ title: (body && body.error) || '识别失败，请重试', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      },
    });
  },

  startVoice() {
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this.setData({ voiceRecording: true });
        this.initRecorder().start({
          duration: 60000,
          sampleRate: 16000,
          numberOfChannels: 1,
          encodeBitRate: 48000,
          format: 'PCM',
        });
      },
      fail: () => {
        wx.showModal({
          title: '需要麦克风权限',
          content: '请在设置中开启麦克风权限，以使用语音描述功能。',
          success: (r) => { if (r.confirm) wx.openSetting(); },
        });
      },
    });
  },

  stopVoice() {
    if (!this.data.voiceRecording) return;
    if (this._recorder) this._recorder.stop();
  },
});
