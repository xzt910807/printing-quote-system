const api = require('../../utils/api');
const { getAvatarConfig } = require('../../utils/avatar');

// 印刷方式编码 → 中文（与 factory-me CAP_OPTIONS 一致）
const PRINT_MODE_TEXT = {
  offset: '胶印', flexo: '柔印', gravure: '凹印', digital: '数码印', screen: '丝印',
};

// 图集类型文案（certificate=Batch D1 资质证书，video=Batch D3 视频）
const MEDIA_TYPE_TEXT = {
  equipment: '设备', workshop: '车间', product: '样品', certificate: '资质证书', video: '视频',
};
const IMAGE_TYPES = ['equipment', 'workshop', 'product', 'certificate'];

// 详情分四段（印查查式工厂页）：概况/能力/图集/视频，顶部吸顶 tab 跳转
const SEGMENTS = [
  { key: 'overview', label: '概况' },
  { key: 'ability', label: '能力' },
  { key: 'media', label: '图集' },
  { key: 'video', label: '视频' },
];

// DECIMAL 列 mysql2 以字符串下发（如 '3000.00'）, 去掉多余的零小数再给人看
function fmtNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

// 视频秒数 → m:ss（后端只存整数秒、不解析容器元数据，时长格式化统一放端上）
function fmtDuration(sec) {
  const n = Math.floor(Number(sec) || 0);
  if (!n) return '';
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}

// 当前 C 端登录用户 id；未登录或登录数据不完整一律返回空串
// （与 loadFollowState 同一判据：userId 与 token 都在才算登录，避免半截 storage 被当成已登录）
function currentUserId() {
  try {
    const u = wx.getStorageSync('userAuth');
    return (u && u.userId && u.token) ? String(u.userId) : '';
  } catch (e) { return ''; }
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: true,
    factoryId: 0,
    apiBase: api.BASE_URL,   // 图文相对路径拼完整地址用
    info: null,          // 工厂基本信息（name/address/intro/contact/phone/code）
    capabilities: { productType: [], printMode: [], process: [], material: [] },
    capTags: [],         // 产品类型中文 tags
    processTags: [],     // 后道工艺中文 tags
    modeTags: [],        // 印刷方式中文 tags
    verified: false,     // 已核验徽章（平台资质核验/审核通过）
    capacity: null,      // 闲置产能 { status, label, note }
    media: [],           // 设备/车间图文图集（大图预览需要完整序列）
    mediaGroups: [],     // 图集段：按类型分组展示
    videos: [],          // 视频段（Batch D3 上传通道，仅审核通过的对外）
    metricRows: [],      // 概况段：经营硬指标（Batch D1）
    ratingText: '',      // 评分文案（无评分人数时不展）
    viewText: '',        // 浏览量文案
    tabs: SEGMENTS,
    activeTab: 'overview',
    avatarText: '厂',
    avatarColor: '#94a3b8',
    // 033 供应商关注：头部卡右上角星标（底部只保留询价主操作）
    followed: false,
    followLoading: false,
    // 电话可见性由后端判定（登录且工厂接受直拨才下发明文），端上只按结论渲染
    phoneVisible: false,
    acceptDirectCall: true,
    // 有号码才给按钮：库里有 13 家填的是「待核实」这种占位文本，不能当成电话拨出去
    phoneUsable: false,
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

    const factoryId = parseInt(options.id, 10) || 0;
    this.setData({ factoryId });
    if (factoryId) {
      this.loadDetail(factoryId);
      this.loadFollowState(factoryId);
    } else {
      this.setData({ loading: false });
      wx.showToast({ title: '参数错误', icon: 'none' });
    }
  },

  onShow() {
    // 从「我的 → 供应商」里关注/取关后返回本页, 需要把状态同步回来（首屏 loading 中跳过）
    if (!this.data.factoryId || this.data.loading) return;
    this.loadFollowState(this.data.factoryId);
    // 登录态变了要重拉详情：号码可见性取决于登录状态，用户去「我的」登录后返回本页，
    // 不重拉就只能看到上次脱敏的号码（退出登录同理，得把明文换回脱敏）
    if (currentUserId() !== this._uidAtLoad) this.loadDetail(this.data.factoryId);
  },

  async loadDetail(id) {
    this.setData({ loading: true });
    // 记下这次请求带的登录身份：onShow 用它判断「期间是否登录/退出过」
    this._uidAtLoad = currentUserId();
    try {
      const res = await api.request('/api/factory/public/' + id);
      const d = res.data || {};
      const caps = d.capabilities || { productType: [], printMode: [], process: [], material: [] };
      const names = d.names || { productType: {}, process: {} };
      const avatar = getAvatarConfig(d.name);

      this.setData({
        loading: false,
        info: {
          code: d.code || '',
          name: d.name || '',
          address: d.address || '',
          intro: d.intro || '',
          contact: d.contact || '',
          phone: d.phone || '',
          province: d.province || '',
          city: d.city || '',
        },
        capabilities: caps,
        capTags: (caps.productType || []).map((c) => (names.productType && names.productType[c]) || c),
        processTags: (caps.process || []).map((c) => (names.process && names.process[c]) || c),
        modeTags: (caps.printMode || []).map((c) => PRINT_MODE_TEXT[c] || c),
        verified: !!d.verified,
        capacity: d.capacityStatus && d.capacityStatus !== 'unknown'
          ? { status: d.capacityStatus, label: d.capacityLabel, note: d.capacityNote || '' }
          : null,
        media: d.media || [],
        mediaGroups: this.buildMediaGroups(d.media || []),
        videos: (d.media || []).filter((m) => m.media_type === 'video')
          .map((m) => ({ ...m, durationText: fmtDuration(m.duration) })),
        metricRows: this.buildMetrics(d),
        ratingText: Number(d.rating) && Number(d.rating_count)
          ? Number(d.rating).toFixed(1) + ' 分（' + d.rating_count + '人）'
          : '',
        viewText: fmtNum(d.view_count) || '',
        phoneVisible: !!d.phoneVisible,
        acceptDirectCall: d.acceptDirectCall !== false,
        phoneUsable: /\d/.test(String(d.phone || '')),
        activeTab: 'overview',
        avatarText: avatar.text,
        avatarColor: avatar.color,
      });
      // 吸顶 tab 要跳到哪，得等分段真渲染上去量一次顶部偏移
      wx.nextTick(() => this.measureSegments());
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 经营硬指标：厂方没填的就是「—」，不能显示成 0（「0 台设备」与「未填报」是两回事）
  buildMetrics(d) {
    const rows = [
      { label: '厂房面积', value: fmtNum(d.factory_area), unit: '㎡' },
      { label: '年交易额', value: fmtNum(d.annual_volume), unit: '万元' },
      { label: '员工总数', value: fmtNum(d.employee_count), unit: '人' },
      { label: '主要设备', value: fmtNum(d.equipment_count), unit: '台' },
      { label: '流水线', value: fmtNum(d.assembly_lines), unit: '条' },
    ];
    const outer = (d.outer_processing === null || d.outer_processing === undefined)
      ? '—' : (Number(d.outer_processing) ? '是' : '否');
    return rows
      .map((r) => ({ label: r.label, value: r.value === null ? '—' : r.value + ' ' + r.unit }))
      .concat([{ label: '对外加工', value: outer }]);
  },

  // 图集按类型分组（资质证书和设备实拍混排时审核人/客户都分不清）
  buildMediaGroups(media) {
    const groups = [];
    for (const type of IMAGE_TYPES) {
      const items = media.filter((m) => m.media_type === type);
      if (items.length) groups.push({ type, label: MEDIA_TYPE_TEXT[type], items });
    }
    // 未知类型兜底：后端加了新类型而前端没跟上时，图仍要能看到，不能整组消失
    const known = IMAGE_TYPES.concat(['video']);
    const others = media.filter((m) => known.indexOf(m.media_type) < 0);
    if (others.length) groups.push({ type: 'other', label: '其它', items: others });
    return groups;
  },

  // ===== 四段吸顶 tab =====
  // 没用定高 scroll-view：本页面带自定义导航栏 + 底部操作条，再套一层滚动容器就要手算避让，
  // 而 sticky 在 scroll-view 内不生效；所以走页面滚动 + pageScrollTo 锚点（与 factory-me 同机制）。
  measureSegments(done) {
    const query = wx.createSelectorQuery();
    SEGMENTS.forEach((s) => query.select('#seg-' + s.key).boundingClientRect());
    query.select('#fd-tabs').boundingClientRect();
    query.select('#fd-page').boundingClientRect();
    query.selectViewport().scrollOffset();
    query.exec((res) => {
      const barRect = res[SEGMENTS.length];
      const pageRect = res[SEGMENTS.length + 1];
      const scroll = res[SEGMENTS.length + 2] || { scrollTop: 0 };
      const barH = barRect ? barRect.height : 0;
      const tops = {};
      SEGMENTS.forEach((s, i) => {
        const rect = res[i];
        if (rect) tops[s.key] = rect.top + scroll.scrollTop - barH - 6;
      });
      this._segTops = tops;
      // 末段不足一屏时，它自己的 top 永远滚不到（滚到底时还差一截），所以额外记一个「最大可滚距离」做兜底。
      // 量页面容器而不是最后一段：最后一段下面还有底部操作条 + page-tab 的留白，用段底会偏小
      try {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const pageH = pageRect ? pageRect.bottom + scroll.scrollTop : 0;
        this._maxScroll = Math.max(pageH - win.windowHeight, 0);
      } catch (e) {
        this._maxScroll = 0;
      }
      if (typeof done === 'function') done(tops);
    });
  },

  // 点击跳段途中要锁一会儿高亮：pageScrollTo 会依次经过前面几段，
  // 不锁的话 onPageScroll 会把 activeTab 反算回上一段，看起来就像「点了没切」
  lockActive(ms) {
    this._activeLockedUntil = Date.now() + ms;
  },

  onTabTap(e) {
    const key = e.currentTarget.dataset.key;
    // 点谁先切谁，视觉反馈不等滚动
    this.lockActive(600);
    this.setData({ activeTab: key });
    // 段顶偏移会随后续渲染抖动，点的时候现量一次再滚，比吃加载时那一版更准
    this.measureSegments((tops) => {
      const top = tops[key];
      if (top === undefined) return;
      wx.pageScrollTo({
        scrollTop: Math.max(top, 0),
        duration: 220,
        complete: () => {
          // 动画尾帧常被丢掉，这里以点击目标为准再确认一次，并刷新测量值供后续手动滚动使用
          this.lockActive(200);
          if (this.data.activeTab !== key) this.setData({ activeTab: key });
          setTimeout(() => this.measureSegments(), 120);
        },
      });
    });
  },

  onPageScroll(e) {
    const tops = this._segTops;
    if (!tops) return;
    if (Date.now() < (this._activeLockedUntil || 0)) return;
    // 不节流：这里只是一次 4 段的比较，只有结论变了才 setData；
    // 原来 120ms 节流会把滚动末帧丢掉，停在上一段（点了 tab 滚到位、高亮却没跟上的直接原因）
    let active = SEGMENTS[0].key;
    for (let i = SEGMENTS.length - 1; i >= 0; i -= 1) {
      const key = SEGMENTS[i].key;
      if (tops[key] !== undefined && e.scrollTop >= tops[key] - 4) { active = key; break; }
    }
    // 滚到底就认定最后一段：末段不够一屏时（只有一张视频卡）它自己的 top 到不了
    if (this._maxScroll > 100 && e.scrollTop >= this._maxScroll - 8) {
      active = SEGMENTS[SEGMENTS.length - 1].key;
    }
    if (active !== this.data.activeTab) this.setData({ activeTab: active });
  },

  // 拨打工厂电话：登录即可查看完整号码并一键拨打；工厂关掉「接受直拨」时退回询价流程
  // （旧逻辑是 F-30：找厂详情电话一律脱敏，必须先询价看价才给号码，非标品客户连问一句都要先走一遍报价）
  callFactory() {
    const phone = this.data.info && this.data.info.phone;
    // 「待核实」这类占位文本也走这里：不能交给拨号盘
    if (!phone || !/\d/.test(String(phone))) {
      wx.showToast({ title: '该工厂未留联系电话', icon: 'none' });
      return;
    }
    // 分支一：工厂不接受直拨 —— 号码对谁都不展开，只能发询价等报价单
    if (!this.data.acceptDirectCall) {
      wx.showModal({
        title: '该工厂暂不接受直接拨打',
        content: '可以发一条询价，工厂报价后会通过报价单联系你',
        confirmText: '去询价',
        cancelText: '知道了',
        success: (r) => { if (r.confirm) this.quoteToFactory(); },
      });
      return;
    }
    // 分支二：未登录 —— 登录后即下发明文号码（登录入口在「我的」）
    if (!currentUserId()) {
      wx.showModal({
        title: '登录后查看完整号码',
        content: '登录后可看到该工厂电话并一键拨打，也能关注工厂、保存报价记录',
        confirmText: '去登录',
        cancelText: '取消',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/mine/mine' }); },
      });
      return;
    }
    // 分支三：已登录且接受直拨 —— 接口给的就该是明文；若仍是脱敏串（后端未更新/缓存旧响应），
    // 重拉详情而不是把一串 **** 交给拨号盘
    if (String(phone).indexOf('*') >= 0) {
      wx.showToast({ title: '号码刷新中，请稍后再点', icon: 'none' });
      this.loadDetail(this.data.factoryId);
      return;
    }
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  // 复制地址
  copyAddress() {
    const address = this.data.info && this.data.info.address;
    if (!address) return;
    wx.setClipboardData({ data: address });
  },

  // 图集大图预览：按分组拼图片序列（分段展示后组内 index 不再等于 media 下标，
  // 改成按 url 定位；视频条目不能进 previewImage，所以取 mediaGroups 而不是 media）
  previewMedia(e) {
    const base = this.data.apiBase;
    const urls = [];
    for (const g of this.data.mediaGroups) {
      for (const m of g.items) urls.push(base + m.url);
    }
    if (!urls.length) return;
    wx.previewImage({ current: base + e.currentTarget.dataset.url, urls });
  },

  // 关注状态：复用单供应商详情接口的 follow 字段（未登录/接口异常一律按未关注渲染）
  async loadFollowState(id) {
    const u = wx.getStorageSync('userAuth');
    if (!u || !u.userId || !u.token) return;
    try {
      const res = await api.request('/api/c/user/suppliers/' + id);
      this.setData({ followed: !!(res.data && res.data.follow) });
    } catch (err) { /* 静默 */ }
  },

  // 关注/取关本厂：关注后进「我的 → 供应商」可打标签、置顶、直达复购
  async toggleFollow() {
    const u = wx.getStorageSync('userAuth');
    if (!u || !u.userId || !u.token) {
      wx.showModal({
        title: '请先登录',
        content: '关注后可在「我的 → 供应商」里集中管理这家工厂',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.switchTab({ url: '/pages/mine/mine' }); },
      });
      return;
    }
    if (this.data.followLoading) return;
    this.setData({ followLoading: true });
    const name = (this.data.info && this.data.info.name) || '该工厂';
    try {
      if (this.data.followed) {
        await api.request('/api/c/user/suppliers/follow/' + this.data.factoryId, { method: 'DELETE' });
        this.setData({ followed: false });
        wx.showToast({ title: '已取消关注「' + name + '」', icon: 'none' });
      } else {
        await api.request('/api/c/user/suppliers/follow', {
          method: 'POST',
          data: { factoryId: this.data.factoryId, tags: '' },
        });
        this.setData({ followed: true });
        wx.showToast({ title: '已关注，可在「我的 → 供应商」管理', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ followLoading: false });
    }
  },

  // 向该工厂询价：带目标工厂回到报价页
  quoteToFactory() {
    wx.setStorageSync('preferFactoryId', this.data.factoryId);
    wx.setStorageSync('preferFactoryName', this.data.info ? this.data.info.name : '');
    wx.switchTab({ url: '/pages/quote/quote' });
  },

  // 返回上一页（自定义导航栏无原生返回按钮）
  // 不能只依赖 navigateBack 的 fail 回调：单页编译/reLaunch 进本页时页面栈只有 1 层,
  // 部分基础库不回调 fail 而是静默返回, 表现就是"点左上角没反应"
  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/factories/factories' }) });
    } else {
      wx.switchTab({ url: '/pages/factories/factories' });
    }
  },
});
