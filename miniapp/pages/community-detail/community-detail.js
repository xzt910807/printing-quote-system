const api = require('../../utils/api');
const community = require('../../utils/community');

// 举报理由必须与后端 communityService.REASONS 同集合, 写错了后端直接 400
const REPORT_REASONS = [
  { code: 'porn', name: '色情低俗' },
  { code: 'ad', name: '广告导流' },
  { code: 'abuse', name: '辱骂攻击' },
  { code: 'fake', name: '虚假信息' },
  { code: 'other', name: '其他' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    id: 0,
    post: null,
    comments: [],
    liked: false,
    favorited: false,
    isAuthor: false,
    loading: true,
    inputText: '',
    sending: false,
    replyTo: null,       // { id, name }：非空时输入框上方显示「回复 xxx」
    // 举报弹层
    reportVisible: false,
    reasons: REPORT_REASONS,
    reportTarget: null,  // { targetType, targetId }
    reportReason: '',
    reportDetail: '',
    reportSubmitting: false,
    // Batch E：成本拆解默认收起（占屏太大, 想知道的人自己展开）
    breakdownOpen: false,
    // Batch E：工厂身份才能「附报价」，客户打开开关也没意义（后端会静默忽略价格）
    isFactory: false,
    quoteOn: false,
    quotePrice: '',
    quoteDays: '7',
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      this.setData({
        statusBarHeight: info.statusBarHeight,
        navBarHeight: (menu.top - info.statusBarHeight) * 2 + menu.height,
      });
    } catch (e) { /* 拿不到就用 data 里的默认高度, 导航栏不至于塌 */ }
    const id = Number(options && options.id) || 0;
    this.setData({ id, isFactory: community.isFactory() });
    if (!id) {
      wx.showToast({ title: '缺少内容编号', icon: 'none' });
      this.setData({ loading: false });
      return;
    }
    this.load();
  },

  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    try {
      const res = await api.request('/api/c/community/post/' + this.data.id, {
        headers: community.identityHeaders(),
      });
      const d = res.data || {};
      this.setData({
        post: community.shapeItem(d.post),
        comments: (d.comments || []).map(community.shapeItem),
        liked: !!d.liked,
        favorited: !!d.favorited,
        isAuthor: !!d.isAuthor,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/community/community' }) }), 800);
    }
  },

  previewImage(e) {
    const { index } = e.currentTarget.dataset;
    const urls = (this.data.post && this.data.post.imageUrl) || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[index || 0], urls });
  },

  goAuthorPost(e) {
    // 一层回复：只做 parent_id 一级（后端也只认一级）, 不做盖楼嵌套
    const { id, name } = e.currentTarget.dataset;
    this.setData({ replyTo: { id, name } });
  },

  cancelReply() { this.setData({ replyTo: null }); },

  onInput(e) { this.setData({ inputText: e.detail.value }); },

  async sendComment() {
    const content = (this.data.inputText || '').trim();
    if (!content) return wx.showToast({ title: '请先写点内容', icon: 'none' });
    if (this.data.sending) return;
    // 附报价：只有工厂身份且开了开关才带 price；校验口径与后端一致，不把 400 留给用户去猜
    const withQuote = this.data.isFactory && this.data.quoteOn;
    let quotePrice;
    let quoteValidDays;
    if (withQuote) {
      quotePrice = Number(this.data.quotePrice);
      if (!(quotePrice > 0)) return wx.showToast({ title: '请填写报价（元/个）', icon: 'none' });
      quoteValidDays = Number(this.data.quoteDays) || 7;
    }
    this.setData({ sending: true });
    try {
      await api.request('/api/c/community/post/' + this.data.id + '/comment', {
        method: 'POST',
        data: {
          content,
          parentId: this.data.replyTo ? this.data.replyTo.id : undefined,
          quotePrice,
          quoteValidDays,
        },
        headers: community.identityHeaders(),
      });
      this.setData({ inputText: '', replyTo: null, quoteOn: false, quotePrice: '', quoteDays: '7' });
      wx.showToast({ title: '已发布', icon: 'success' });
      await this.load();
    } catch (e) {
      wx.showToast({ title: this.loginTip(e), icon: 'none' });
    } finally { this.setData({ sending: false }); }
  },

  // Batch E：成本拆解展开/收起
  toggleBreakdown() { this.setData({ breakdownOpen: !this.data.breakdownOpen }); },

  // Batch E：工厂「附报价」开关
  toggleQuoteOn() { this.setData({ quoteOn: !this.data.quoteOn }); },

  onQuotePrice(e) { this.setData({ quotePrice: e.detail.value }); },

  onQuoteDays(e) { this.setData({ quoteDays: e.detail.value }); },

  /**
   * Batch E：帖主采纳一条工厂答价。不自动建询价单（采纳只是信任信号，反哺撮合），
   * 真要下单走「按此参数算一算」→ 计算器 → 询价，链路本来就有。
   */
  acceptQuote(e) {
    const commentId = Number(e.currentTarget.dataset.id) || 0;
    if (!commentId) return;
    wx.showModal({
      title: '采纳这条报价',
      content: '采纳后会标记该报价已被你采用，同一帖只能采纳一条。',
      confirmText: '采纳',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.request('/api/c/community/post/' + this.data.id + '/accept-quote', {
            method: 'POST',
            data: { commentId },
            headers: community.identityHeaders(),
          });
          wx.showToast({ title: '已采纳', icon: 'success' });
          await this.load();
        } catch (err) { wx.showToast({ title: this.loginTip(err), icon: 'none' }); }
      },
    });
  },

  /**
   * Batch E：把帖子规格带回计算器。calculator 是 tabBar 页，wx.switchTab 带不了 query，
   * 只能走 storage（复用「再次询价」的 repurchaseParams 通道，p.tip 覆盖 toast 文案）。
   */
  calcFromSpec() {
    const spec = this.data.post && this.data.post.spec;
    if (!spec) return wx.showToast({ title: '这条帖没有填规格', icon: 'none' });
    wx.setStorageSync('repurchaseParams', {
      productType: spec.productType,
      length_m: spec.lengthMm / 1000,
      width_m: spec.widthMm / 1000,
      height_m: (spec.heightMm || 0) / 1000,
      quantity: spec.quantity,
      material_code: spec.materialCode,
      processes: spec.processes || [],
      box_type: spec.boxType || 'normal',
      n_up: spec.nUp || 1,
      film_layers: spec.filmLayers || 1,
      tip: '已带入帖子里的规格参数',
    });
    wx.switchTab({ url: '/pages/quote/quote' });
  },

  /** 401 的文案（后端「请先登录后再发布内容」）在端上换成可操作的指引 */
  loginTip(e) {
    const m = e.message || '';
    if (e.statusCode === 401 || /登录/.test(m)) return '请先登录后再操作';
    return m || '操作失败';
  },

  async toggleLike() {
    try {
      const res = await api.request('/api/c/community/like', {
        method: 'POST',
        data: { targetType: 'post', targetId: this.data.id },
        headers: community.identityHeaders(),
      });
      const liked = !!(res.data && res.data.liked);
      // 计数按返回值加减：后端是原子更新, 这里同步一次就够, 不必整表重拉
      const post = this.data.post;
      this.setData({
        liked,
        'post.likeCount': Math.max(0, (post.likeCount || 0) + (liked ? 1 : -1)),
      });
    } catch (e) { wx.showToast({ title: this.loginTip(e), icon: 'none' }); }
  },

  async toggleFavorite() {
    try {
      const res = await api.request('/api/c/community/favorite', {
        method: 'POST',
        data: { postId: this.data.id },
        headers: community.identityHeaders(),
      });
      const favorited = !!(res.data && res.data.favorited);
      const post = this.data.post;
      this.setData({
        favorited,
        'post.favoriteCount': Math.max(0, (post.favoriteCount || 0) + (favorited ? 1 : -1)),
      });
      wx.showToast({ title: favorited ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (e) { wx.showToast({ title: this.loginTip(e), icon: 'none' }); }
  },

  async likeComment(e) {
    const id = e.currentTarget.dataset.id;
    try {
      const res = await api.request('/api/c/community/like', {
        method: 'POST',
        data: { targetType: 'comment', targetId: id },
        headers: community.identityHeaders(),
      });
      const liked = !!(res.data && res.data.liked);
      const list = this.data.comments.map((c) => (String(c.id) === String(id)
        ? Object.assign({}, c, { likeCount: Math.max(0, (c.likeCount || 0) + (liked ? 1 : -1)) })
        : c));
      this.setData({ comments: list });
    } catch (err) { wx.showToast({ title: this.loginTip(err), icon: 'none' }); }
  },

  // 作者本人下架自己的内容（后端置 removed, 不是物理删）
  removeContent(e) {
    const { type, id } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除' + (type === 'post' ? '帖子' : '评论'),
      content: '删除后其他人都看不到了, 确定？',
      confirmColor: '#dc2626',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.request('/api/c/community/' + type + '/' + id, {
            method: 'DELETE',
            headers: community.identityHeaders(),
          });
          wx.showToast({ title: '已删除', icon: 'success' });
          if (type === 'post') setTimeout(() => wx.navigateBack(), 600);
          else await this.load();
        } catch (err) { wx.showToast({ title: this.loginTip(err), icon: 'none' }); }
      },
    });
  },

  openReport(e) {
    const { type, id } = e.currentTarget.dataset;
    this.setData({
      reportVisible: true,
      reportTarget: { targetType: type, targetId: Number(id) },
      reportReason: '',
      reportDetail: '',
    });
  },

  closeReport() { this.setData({ reportVisible: false }); },

  pickReason(e) { this.setData({ reportReason: e.currentTarget.dataset.code }); },

  onReportDetail(e) { this.setData({ reportDetail: e.detail.value }); },

  async submitReport() {
    if (!this.data.reportReason) return wx.showToast({ title: '请选择举报理由', icon: 'none' });
    if (this.data.reportSubmitting) return;
    this.setData({ reportSubmitting: true });
    try {
      await api.request('/api/c/community/report', {
        method: 'POST',
        data: {
          targetType: this.data.reportTarget.targetType,
          targetId: this.data.reportTarget.targetId,
          reason: this.data.reportReason,
          detail: (this.data.reportDetail || '').trim(),
        },
        headers: community.identityHeaders(),
      });
      this.setData({ reportVisible: false });
      wx.showToast({ title: '举报已提交', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: this.loginTip(err), icon: 'none' });
    } finally { this.setData({ reportSubmitting: false }); }
  },

  // 弹层内 catchtap 占位：阻止点面板时冒泡到遮罩把面板关了（与 chat 页同一写法）
  noop() {},

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/community/community' }) }); },
});
