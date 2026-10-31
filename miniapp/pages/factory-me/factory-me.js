const api = require('../../utils/api');
// 产品类型中文名统一取共享模块（新品类接入只需改 productText 一处）
const { PRODUCT_TEXT, productName } = require('../../utils/productText');

// 可自助覆盖的字段（与后端白名单一致）
const OVERRIDE_TYPES = [
  { value: 'rawPaper',     name: '原纸',     fields: [{ value: 'price_per_ton', name: '吨价(元/吨)' }, { value: 'grammage', name: '克重(g/m²)' }] },
  { value: 'boardPaper',   name: '纸板',     fields: [{ value: 'price_per_sqm', name: '单价(元/㎡)' }, { value: 'layers', name: '层数' }] },
  { value: 'cardPaper',    name: '卡纸',     fields: [{ value: 'price_per_sqm', name: '单价(元/㎡)' }, { value: 'grammage', name: '克重(g/m²)' }] },
  { value: 'plasticFilm',  name: '塑料薄膜', fields: [{ value: 'price_per_kg', name: '公斤价(元/kg)' }, { value: 'thickness_um', name: '厚度(μm)' }] },
  { value: 'plateType',    name: '版材',     fields: [{ value: 'unit_price', name: '单价(元)' }] },
  // 020：图案覆盖率三档系数走印工费率覆盖；油墨类型系数独立成组（与后端 OVERRIDE_FIELDS 白名单一致）
  { value: 'printingRate', name: '印工费率', fields: [{ value: 'start_fee', name: '开机费(元)' }, { value: 'extra_per_1000', name: '每千印加价(元)' }, { value: 'color_rate', name: '每色每㎡费率(元)' }, { value: 'min_charge', name: '最低收费(元)' }, { value: 'ink_factor_low', name: '图案·低覆盖系数' }, { value: 'ink_factor_mid', name: '图案·中覆盖系数' }, { value: 'ink_factor_high', name: '图案·高覆盖系数' }] },
  { value: 'inkType',      name: '油墨类型', fields: [{ value: 'price_factor', name: '加价系数' }] },
  { value: 'finishing',    name: '后道工艺', fields: [{ value: 'rate', name: '费率' }, { value: 'plate_fee', name: '版费(元)' }, { value: 'waste_rate', name: '损耗率' }] },
];

// 生产能力候选清单（与平台一致）
const CAP_OPTIONS = {
  // 产品类型直接由共享映射生成（顺序即 productText 中的声明顺序, 与平台品类一致）
  productType: Object.keys(PRODUCT_TEXT).map((code) => ({ code, name: PRODUCT_TEXT[code] })),
  printMode: [
    { code: 'offset',  name: '胶印' },
    { code: 'flexo',   name: '柔印' },
    { code: 'gravure', name: '凹印' },
    { code: 'digital', name: '数码印' },
  ],
  process: [
    { code: 'MATTE_FILM',  name: '覆哑膜' },
    { code: 'GLOSS_FILM',  name: '覆光膜' },
    { code: 'UV_COAT',     name: 'UV上光' },
    { code: 'CALENDAR',    name: '压光' },
    { code: 'CORRUGATE',   name: '瓦楞' },
    { code: 'HOT_STAMP',   name: '烫金' },
    { code: 'EMBOSS_PROC', name: '击凸' },
    { code: 'TEXTURE',     name: '压纹' },
    { code: 'DIE_CUT',     name: '模切异形' },
    { code: 'GLUE_BOX',    name: '粘箱' },
    { code: 'PACK',        name: '打包' },
    { code: 'PUNCH',       name: '打孔' },
    { code: 'PERF',        name: '打拢线' },
    { code: 'ROPE',        name: '穿绳打扣' },
    { code: 'ROPE_COTTON', name: '棉绳拎手' },
    { code: 'CLASP',       name: '塑料扣' },
    { code: 'SEWING',      name: '车缝' },
    { code: 'LAMINATE',    name: '复合' },
    { code: 'BAG_3SEAL',   name: '三边封制袋' },
    { code: 'BAG_CENTER',  name: '中封制袋' },
    { code: 'BAG_STAND',   name: '自立袋制袋' },
    { code: 'BAG_ZIP',     name: '拉链袋制袋' },
    { code: 'LASER_AF',    name: '激光防伪' },
    { code: 'SCRATCH',     name: '刮刮银' },
    { code: 'FLUOR',       name: '荧光油墨' },
    { code: 'VOID_AF',     name: '揭开留底' },
    { code: 'TRACE_QR',    name: '二维码溯源' },
    { code: 'FOLD',        name: '折页' },
    { code: 'SADDLE',      name: '骑马订' },
    { code: 'PERFECT_BIND',name: '无线胶装' },
    { code: 'SEW_BIND',    name: '锁线胶装' },
    { code: 'FLOCK',       name: '植绒' },
    // 纸容器工艺（与 finishing_process 目录 / product_config.paperContainer 白名单一致）
    { code: 'CUP_FORMING', name: '杯成型' },
    { code: 'RIM_ROLLING', name: '卷边' },
    { code: 'BOTTOM_SEAL', name: '底封' },
    { code: 'TUBE_WINDING', name: '卷管' },
    { code: 'LABELING',    name: '贴标' },
    { code: 'ASSEMBLY',    name: '组装' },
    { code: 'LINING',      name: '内衬' },
  ],
  material: [
    { code: 'B_B3',    name: '单坑B楞' },
    { code: 'B_A3',    name: '单坑A楞' },
    { code: 'B_BC5',   name: '双坑BC楞' },
    { code: 'B_BCE7',  name: '三坑BCE楞' },
    { code: 'CARD250', name: '250g白卡' },
    { code: 'CARD300', name: '300g白卡' },
    { code: 'COAT200', name: '200g铜版' },
    { code: 'KRAFT120', name: '120g牛皮纸' },
    { code: 'KRAFT200', name: '200g牛皮纸' },
    { code: 'KRAFT300', name: '300g牛皮纸' },
    { code: 'NW_80',    name: '无纺布80g' },
    { code: 'NW_100',   name: '无纺布100g' },
    { code: 'NW_120',   name: '无纺布120g' },
    { code: 'HTF_FILM', name: '热转印花膜' },
    { code: 'STK_COPPER', name: '铜版纸不干胶' },
    { code: 'STK_PET',   name: '透明PET不干胶' },
    { code: 'STK_SYNTH', name: '合成纸不干胶' },
    { code: 'STK_THERMAL', name: '热敏纸不干胶' },
    { code: 'STK_PETSILVER', name: 'PET哑银不干胶' },
    { code: 'PP_40',  name: 'PP 4丝' },
    { code: 'PP_60',  name: 'PP 6丝' },
    { code: 'PE_50',  name: 'PE 5丝' },
    { code: 'PE_80',  name: 'PE 8丝' },
    { code: 'PET_35', name: 'PET 3.5丝' },
  ],
};

const CAP_LABELS = { productType: '产品类型', printMode: '印刷方式', process: '后道工艺', material: '常备材料' };

// 员工管理（F-152~F-159 简版：列表 + 新增 + 启停；编辑/重置密码请用 Web 端）
const STAFF_ROLES = [
  { value: 'manager', name: '主管' },
  { value: 'sales', name: '业务员' },
  { value: 'finance', name: '财务' },
  { value: 'designer', name: '设计' },
  { value: 'viewer', name: '查看者' },
];
const ROLE_TEXT = { owner: '老板', manager: '主管', sales: '业务员', finance: '财务', designer: '设计', viewer: '查看者' };

const TYPE_MAP = {};
OVERRIDE_TYPES.forEach((t) => { TYPE_MAP[t.value] = t; });

// 027 闲置产能三态（与后端 CAPACITY_STATUS 一致）
const CAPACITY_OPTIONS = [
  { code: 'idle', name: '产能空闲', tip: '优先被平台撮合推单' },
  { code: 'normal', name: '生产正常', tip: '正常接单中' },
  { code: 'busy', name: '排单饱和', tip: '暂少接新单' },
];
// 027 设备图文类型（与后端 MEDIA_TYPES 一致，上限 9 张）
// certificate=资质证书（Batch D1）：营业执照/印刷许可证扫描件走同一通道，展示在工厂详情页图集里
const MEDIA_TYPE_OPTIONS = [
  { code: 'equipment', name: '设备' },
  { code: 'workshop', name: '车间' },
  { code: 'product', name: '样品' },
  { code: 'certificate', name: '资质证书' },
];
const MAX_MEDIA_COUNT = 9;
// Batch D3 图集视频上限（与后端 middlewares/upload.js 的 MEDIA_VIDEO_MAX_MB 一致）：
// 超了后端会直接拒，先在端上拦一次免得用户白等一场上传
const MAX_VIDEO_MB = 20;
// 审核状态中文（视频与资质证书先审后发，待审期间 C 端看不到，得让工厂知道原因）
const VIDEO_STATUS_TEXT = { pending: '平台审核中，通过后对外展示', approved: '已通过审核', rejected: '已被驳回，请删除后重新上传' };

// 图条目的展示派生字段（视频要区分渲染方式 + 时长/体积角标）
function decorateMedia(list) {
  return (list || []).map((m) => ({
    ...m,
    isVideo: m.media_type === 'video',
    durationText: m.duration ? Math.floor(m.duration / 60) + ':' + String(m.duration % 60).padStart(2, '0') : '',
    sizeText: m.file_size ? Math.round(m.file_size / 1024 / 1024 * 10) / 10 + 'MB' : '',
  }));
}

// Batch D1 经营硬指标（与后端 HARD_METRICS 白名单一一对应，字段名用驼峰提交）
// 单独成一个对象而不是并入 profile：保存基本资料时只发 contact/phone/... 不带这些键，
// 后端按「没传就不动这一列」处理，避免改个电话把后台核验过的面积/设备数清成空
const OUTER_OPTIONS = [
  { code: '1', name: '接受对外加工' },
  { code: '0', name: '只接自有订单' },
];

// DECIMAL 列下来是 '3000.00' 这种串，回填输入框前去掉多余的零（填过的数字要能原样保存回去）
function fmtMetric(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '';
}

function buildCapView(caps) {
  const view = {};
  Object.keys(CAP_OPTIONS).forEach((type) => {
    const selected = (caps && caps[type]) || [];
    view[type] = CAP_OPTIONS[type].map((o) => ({ code: o.code, name: o.name, on: selected.indexOf(o.code) >= 0 }));
  });
  return view;
}

function flattenOverrides(ov, options) {
  const list = [];
  Object.keys(ov || {}).forEach((t) => {
    Object.keys(ov[t] || {}).forEach((c) => {
      const typeDef = TYPE_MAP[t];
      const codeDef = ((options && options[t]) || []).find((x) => x.code === c);
      Object.keys(ov[t][c] || {}).forEach((f) => {
        const fieldDef = ((typeDef && typeDef.fields) || []).find((x) => x.value === f);
        list.push({
          key: t + '|' + c + '|' + f,
          targetType: t, targetCode: c, fieldName: f, fieldValue: ov[t][c][f],
          typeName: (typeDef && typeDef.name) || t,
          targetCodeName: (codeDef && codeDef.name) || '',
          codeLabel: codeDef ? codeDef.name + '（' + c + '）' : c,
          fieldLabel: (fieldDef && fieldDef.name) || f,
        });
      });
    });
  });
  return list;
}

const toPct = (v) => Math.round((Number(v) || 0) * 1000) / 10;
// 034 同环比百分比格式化（无数据 → —）
const fmtDelta = (v) => {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  const n = Number(v);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
};

// 从字段名提取单位：'吨价(元/吨)' → '元/吨'；无括号则返回原名（如'层数'）
function fieldUnit(fieldName) {
  const m = /\((.+?)\)/.exec(fieldName);
  return m ? m[1] : fieldName;
}

Page({
  data: {
    // 自定义导航栏高度（与其他页面同一套算法）
    statusBarHeight: 20,
    navBarHeight: 44,
    // 吸顶后条右侧要让出的宽度（px）：胶囊固定在右上角，吸顶后条与它同一水平线，最右边几段会被盖住。
    // 0 表示拿不到胶囊信息，不做避让
    capsuleGap: 0,
    // 吸顶态：只有吸顶时条才与胶囊同一水平线、才需要让位（未吸顶时条在头部卡片下方，那里没有胶囊）
    navStuck: false,
    auth: null,
    factoryInfo: { name: '', code: '', username: '' },
    profile: { contact: '', phone: '', address: '', intro: '', acceptDirectCall: 1 },
    pricing: { marginPct: 15, taxRatePct: 10, wasteRatePct: 4 },
    overrides: [],
    overrideTypeNames: OVERRIDE_TYPES.map((t) => t.name),
    overrideFieldNames: OVERRIDE_TYPES[0].fields.map((f) => f.name),
    catalogOptions: {},   // 价格覆盖可选项 { 类型: [{code, name}] }（从后端目录拉取）
    codeNames: [],        // 当前类型下的编码名称列表（下拉展示用）
    newOverride: { typeIndex: 0, fieldIndex: 0, codeIndex: 0, fieldValue: '' },
    fieldUnit: fieldUnit(OVERRIDE_TYPES[0].fields[0].name), // 数值输入框的单位提示
    capTypes: Object.keys(CAP_OPTIONS),
    capLabels: CAP_LABELS,
    caps: { productType: [], printMode: [], process: [], material: [] },
    capView: buildCapView({}),
    pwd: { old: '', n1: '', n2: '' },
    // 021 微信一键登录绑定（员工自助）
    wxBound: false,
    wxBinding: false,
    // 员工管理（仅 owner：staff:manage）
    canManageStaff: false,
    // 价格体系编辑（price:edit = 老板/主管；无权限者不请求不渲染，避免 403 打断整页加载）
    canEditPrice: false,
    staff: [],
    staffRoleNames: STAFF_ROLES.map((r) => r.name),
    newStaff: { username: '', password: '', realName: '', phone: '', roleIndex: 1 },
    // F-102 我的专属二维码：客户扫码直达我厂询价页（小程序码由后端调微信接口生成）
    qrVisible: false,
    qrLoading: false,
    qrcodeUrl: '',
    qrcodeTip: '',
    // 分区切换：默认经营概览（onLoad 会按上次停留的分区覆盖）
    section: 'dashboard',
    // 029 经营概览数据（进入页面时若落在经营分区即拉取，其他分区首次切到时懒加载）
    dashSummary: {},
    dashTrend: [],
    dashTopProducts: [],
    dashLoaded: false,
    dashLoading: false,
    // 034 日期区间 + 同环比
    dashRange: { start: '', end: '' },
    dashCompare: null,
    // 027 闲置产能填报（印查查式撮合加权：空闲厂优先推单）
    capacityOptions: CAPACITY_OPTIONS,
    capacity: { status: '', note: '' },
    capacityUpdatedAt: '',
    // 027 设备图文画像（本厂图集，上传/删除；实拍先发后审，资质证书与视频先审后发）
    apiBase: api.BASE_URL,
    mediaTypeOptions: MEDIA_TYPE_OPTIONS,
    mediaTypeIndex: 0,
    media: [],
    mediaMax: MAX_MEDIA_COUNT,
    maxVideoMb: MAX_VIDEO_MB,
    // Batch D3 视频播放弹层（在本页内播，不跳页；关闭即销毁，免得原生播放器在后台继续出声）
    videoVisible: false,
    videoUrl: '',
    videoTitle: '',
    videoStatusText: '',
    // Batch D1 经营硬指标（空串=未填报，落库 NULL；与 0 是两回事）
    metrics: { factoryArea: '', annualVolume: '', employeeCount: '', equipmentCount: '', assemblyLines: '', outerProcessing: '' },
    outerOptions: OUTER_OPTIONS,
    viewCount: '',
    // Batch D2 地图选址：后端存 lat/lng，距离排序靠它；本厂地址在后台/工厂自己手里，选址不会抢地址字段
    geo: { lat: '', lng: '' },
    geoText: '未选址',
    hasGeo: false,
  },

  onLoad(options) {
    // 自定义导航栏高度（与其他页面同一套算法）
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      // statusBarHeight 有 0.5px 取整的情况，先用 Number 兜一层再参与运算（否则会算出 NaN）
      const sbh = Number(info.statusBarHeight) || 20;
      const navBarHeight = (menu.top - sbh) * 2 + menu.height;
      // 胶囊让位宽度：屏宽 - 胶囊左边缘 + 8px 间距。条本身还缩在 .container 的 24rpx 内边距里，
      // 实际内容右边界会比这个更靠左，所以这个值偏保守（宁可多让一点也不能让段钻到胶囊下面）
      const capsuleGap = info.windowWidth && menu.left
        ? Math.round(info.windowWidth - menu.left) + 8
        : 0;
      this.setData({ statusBarHeight: sbh, navBarHeight, capsuleGap });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44, capsuleGap: 0 });
    }

    const auth = wx.getStorageSync('factoryAuth');
    if (!auth || !auth.token) {
      wx.showToast({ title: '请先登录工厂账号', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    this.setData({ auth });
    // F-168：仅 owner（staff:manage）显示员工管理入口；旧版登录数据无 permissions 时按角色兜底
    const canManageStaff = Array.isArray(auth.permissions)
      ? auth.permissions.indexOf('staff:manage') >= 0
      : (auth.role ? auth.role === 'owner' : true);
    // F-25：价格设置仅老板/主管（price:edit），业务员等子账号隐藏
    const canEditPrice = Array.isArray(auth.permissions)
      ? auth.permissions.indexOf('price:edit') >= 0
      : (auth.role ? (auth.role === 'owner' || auth.role === 'manager') : true);
    this.setData({ canManageStaff, canEditPrice });
    // 默认落在「经营」概览（进"我的工厂"最想看的是生意情况，且导航里经营本就排第一），
    // 落地分区优先级：URL 指定（如生产能力引导直达「能力」）> 上次停留的分区 > 经营
    // 员工分区只对 owner 开放，避免恢复到看不见的空白分区
    const allowed = ['dashboard', 'profile', 'price', 'cap', 'trust', 'account'];
    if (canManageStaff) allowed.push('staff');
    const picked = (options && options.section) || '';
    const last = wx.getStorageSync('factoryMeSection');
    const section = allowed.indexOf(picked) >= 0 ? picked
      : (allowed.indexOf(last) >= 0 ? last : 'dashboard');
    this.setData({ section });
    this.loadAll();
    if (section === 'dashboard') this.loadDashboard();
  },

  authHeaders() {
    const a = this.data.auth;
    return { 'X-Factory-Id': String(a.factoryId), 'X-Factory-Token': a.token };
  },

  // 分区导航切换：只展示选中的分区（导航选中项高亮），回到页面顶部，并记住本次选择
  switchSection(e) {
    const s = e.currentTarget.dataset.section;
    if (!s || s === this.data.section) return;
    this.setData({ section: s });
    wx.setStorageSync('factoryMeSection', s);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    // 回顶后必然不再吸顶；直接落一次，免得 scrollTop 本来就是 0 时收不到滚动事件、条还留着让位
    this.updateNavStuck(0);
    if (s === 'dashboard' && !this.data.dashLoaded) this.loadDashboard();
  },

  // ===== 分区导航吸顶（Batch D1 的 .sec-nav） =====
  // 注意这页和工厂详情页不是一回事：这里是「切换分区」，点了只换下面的内容并回顶，
  // 没有分段锚点要滚过去、也没有「滚动反算高亮」，所以这里没有定位基准要调；
  // 要做的只有判定「条有没有吸顶」——吸顶时才补状态栏让位与胶囊空档。
  onReady() {
    this.measureNavStick();
  },

  // 吸顶临界点：条滚到状态栏下沿时的 scrollTop。条在文档流里的位置固定在头部卡片下方，
  // 分区切换不会动它，所以只在渲染完成、资料回填后各量一次，不跟着滚动反复量
  measureNavStick() {
    wx.createSelectorQuery()
      .select('.sec-nav')
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res) => {
        const rect = res && res[0];
        const scroll = res && res[1];
        if (!rect || !scroll) return;
        // 条让开了状态栏（wxml 里 sticky top 用的就是 statusBarHeight），临界点要减掉这一段
        const barTop = Number(this.data.statusBarHeight) || 0;
        this._navStickAt = rect.top + scroll.scrollTop - barTop;
        this.updateNavStuck(scroll.scrollTop);
      });
  },

  // 只翻一个布尔、不涉及布局反算，所以不节流；结论没变就不 setData
  updateNavStuck(scrollTop) {
    const at = this._navStickAt;
    if (at === undefined) return;
    const stuck = scrollTop >= at - 1;
    if (stuck !== this.data.navStuck) this.setData({ navStuck: stuck });
  },

  onPageScroll(e) {
    this.updateNavStuck(e.scrollTop);
  },

  // 029 经营概览：汇总 / 趋势 / 品类（均拉失败不卡页面，汇总中默认 0）
  async loadDashboard() {
    this.setData({ dashLoading: true });
    try {
      const rangeQs = this.data.dashRange.start && this.data.dashRange.end
        ? ('?start=' + encodeURIComponent(this.data.dashRange.start) + '&end=' + encodeURIComponent(this.data.dashRange.end))
        : '';
      const [summaryRes, trendRes, topRes, compareRes] = await Promise.all([
        api.request('/api/factory/dashboard/summary' + rangeQs, { headers: this.authHeaders() }).catch(() => ({ data: {} })),
        api.request('/api/factory/dashboard/trend?months=6', { headers: this.authHeaders() }).catch(() => ({ data: { list: [] } })),
        api.request('/api/factory/dashboard/top-products' + rangeQs, { headers: this.authHeaders() }).catch(() => ({ data: { list: [] } })),
        api.request('/api/factory/dashboard/compare' + rangeQs, { headers: this.authHeaders() }).catch(() => ({ data: null })),
      ]);
      const s = summaryRes.data || {};
      s.monthlyRevenue = Number(s.monthlyRevenue || 0).toFixed(2);
      s.rating = s.rating ? Number(s.rating).toFixed(1) : 0;
      s.avgResponseHours = s.avgResponseHours ? Number(s.avgResponseHours).toFixed(1) : 0;
      const trend = (trendRes.data && trendRes.data.list) || [];
      const maxCnt = trend.reduce((m, x) => Math.max(m, Number(x.cnt) || 0), 0) || 1;
      const trendView = trend.map((x) => ({
        ...x,
        amtText: Number(x.amt || 0).toFixed(0),
        pct: Math.round(((Number(x.cnt) || 0) / maxCnt) * 100),
      }));
      const top = (topRes.data && topRes.data.list) || [];
      const maxTop = top.reduce((m, x) => Math.max(m, Number(x.cnt) || 0), 0) || 1;
      const topView = top.map((x) => ({
        ...x,
        // 品名以后端 product_config 解析的中文名为准, 后端漏给时前端共享映射兜底, 绝不露英文码
        label: x.name || productName(x.product_type),
        pct: Math.round(((Number(x.cnt) || 0) / maxTop) * 100),
        amtText: Number(x.amt || 0).toFixed(2),
      }));
      const cmp = compareRes.data || null;
      if (cmp) {
        cmp.momOrdersText = fmtDelta(cmp.momOrders);
        cmp.momRevenueText = fmtDelta(cmp.momRevenue);
        cmp.yoyOrdersText = fmtDelta(cmp.yoyOrders);
        cmp.yoyRevenueText = fmtDelta(cmp.yoyRevenue);
      }
      this.setData({
        dashSummary: s,
        dashTrend: trendView,
        dashTopProducts: topView,
        dashCompare: cmp,
        dashLoaded: true,
      });
    } catch (e) { /* 静默 */ } finally {
      this.setData({ dashLoading: false });
    }
  },

  onDashStartDate(e) {
    this.setData({ 'dashRange.start': e.detail.value });
    this.loadDashboard();
  },

  onDashEndDate(e) {
    this.setData({ 'dashRange.end': e.detail.value });
    this.loadDashboard();
  },

  resetDashRange() {
    this.setData({ dashRange: { start: '', end: '' } });
    this.loadDashboard();
  },

  // 027 待处理工单入口 → 拉取本厂工单列表 + 弹层选中后跳 issue-detail?role=factory
  async onIssuesTap() {
    try {
      const res = await api.request('/api/factory/issue?status=open,processing', { headers: this.authHeaders() });
      const list = (res.data && (res.data.list || res.data)) || [];
      if (!list.length) {
        wx.showToast({ title: '当前没有待处理工单', icon: 'none' });
        return;
      }
      const TYPE_LABEL = { quality: '质量', delay: '延期', reprint: '补印', other: '其他' };
      const items = list.slice(0, 20).map((t) =>
        (TYPE_LABEL[t.type] || t.type) + ' · ' + (t.title || t.ticket_no || ('#' + t.id)));
      wx.showActionSheet({
        itemList: items,
        success: (r) => {
          const pick = list[r.tapIndex];
          if (!pick) return;
          wx.navigateTo({ url: '/pages/issue-detail/issue-detail?id=' + pick.id + '&role=factory' });
        },
      });
    } catch (err) {
      wx.showToast({ title: err.message || '工单拉取失败', icon: 'none' });
    }
  },

  async loadAll() {
    try {
      const [profileRes, pricingRes, capsRes, optionsRes, staffRes, mediaRes] = await Promise.all([
        api.request('/api/factory/me/profile', { headers: this.authHeaders() }),
        // 价格体系仅 price:edit 持有者可读可编（GET /me/pricing 需 price:view 起）
        this.data.canEditPrice
          ? api.request('/api/factory/me/pricing', { headers: this.authHeaders() })
          : Promise.resolve({ data: null }),
        api.request('/api/factory/me/capabilities', { headers: this.authHeaders() }),
        // 目录选项拉取失败不阻塞页面其他部分
        api.request('/api/factory/me/catalog-options', { headers: this.authHeaders() })
          .catch(() => ({ data: {} })),
        // 员工列表仅 owner 拉取；无权限静默跳过（业务员看不到该区块）
        this.data.canManageStaff
          ? api.request('/api/factory/me/staff', { headers: this.authHeaders() }).catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        // 027 本厂图集（含待审，供自查；失败不阻塞主流程）
        api.request('/api/factory/me/media', { headers: this.authHeaders() }).catch(() => ({ data: { list: [] } })),
      ]);
      const p = profileRes.data;
      const pr = pricingRes.data || {};
      const caps = capsRes.data;
      const options = optionsRes.data || {};
      const staff = (staffRes.data || []).map((u) => ({ ...u, roleText: ROLE_TEXT[u.role] || u.role }));
      // 021 微信绑定状态：失败不阻塞整页
      const wxStatus = await api.request('/api/auth/factory-wx-status', { headers: this.authHeaders() })
        .catch(() => ({ data: { bound: false } }));
      this.setData({
        wxBound: !!(wxStatus.data && wxStatus.data.bound),
        factoryInfo: { name: p.name, code: p.code, username: p.username },
        profile: {
          contact: p.contact || '',
          phone: p.phone || '',
          address: p.address || '',
          intro: p.intro || '',
          // 列是 tinyint NOT NULL DEFAULT 1：只有明确 0 才算关闭，老数据/异常值按默认开启
          acceptDirectCall: Number(p.accept_direct_call) === 0 ? 0 : 1,
        },
        pricing: {
          marginPct: toPct(pr.defaultMargin),
          taxRatePct: toPct(pr.defaultTaxRate),
          wasteRatePct: toPct(pr.defaultWasteRate),
        },
        overrides: pr.overrides ? flattenOverrides(pr.overrides, options) : [],
        catalogOptions: options,
        codeNames: (options[OVERRIDE_TYPES[0].value] || []).map((x) => x.name),
        caps,
        capView: buildCapView(caps),
        staff,
        capacity: {
          status: ['idle', 'normal', 'busy'].includes(p.capacity_status) ? p.capacity_status : '',
          note: p.capacity_note || '',
        },
        capacityUpdatedAt: p.capacity_updated_at ? this.fmtDate(p.capacity_updated_at) : '',
        // Batch D1 经营硬指标回填（NULL → 空串，输入框里空代「未填报」而不是 0）
        metrics: {
          factoryArea: fmtMetric(p.factory_area),
          annualVolume: fmtMetric(p.annual_volume),
          employeeCount: fmtMetric(p.employee_count),
          equipmentCount: fmtMetric(p.equipment_count),
          assemblyLines: fmtMetric(p.assembly_lines),
          outerProcessing: (p.outer_processing === null || p.outer_processing === undefined)
            ? '' : String(Number(p.outer_processing)),
        },
        viewCount: fmtMetric(p.view_count) || '0',
        geo: { lat: fmtMetric(p.lat), lng: fmtMetric(p.lng) },
        geoText: (p.lat && p.lng)
          ? fmtMetric(p.lat) + ', ' + fmtMetric(p.lng)
          : '未选址',
        hasGeo: !!(p.lat && p.lng),
        media: decorateMedia(mediaRes.data && mediaRes.data.list),
      });
      // 工厂名回填后头部卡片高度可能变，条的绝对位置跟着变，这里重量一次
      wx.nextTick(() => this.measureNavStick());
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      if (err.message.indexOf('验证失败') >= 0 || err.message.indexOf('登录') >= 0) {
        wx.removeStorageSync('factoryAuth');
        setTimeout(() => wx.navigateBack(), 900);
      }
    }
  },

  // ===== 基本资料 =====
  onProfileInput(e) {
    this.setData({ ['profile.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  async saveProfile() {
    try {
      await api.request('/api/factory/me/profile', {
        method: 'PUT',
        data: this.data.profile,
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '资料已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 是否接受客户直接拨打（0/1，默认开启）：点选即存，不等「保存资料」
  // 它决定的是陌生客户能不能直接打进来，点完以为生效了却还要再按一次保存，是这类开关最容易出的坑
  async pickDirectCall(e) {
    const next = Number(e.currentTarget.dataset.code) === 0 ? 0 : 1;
    const prev = Number(this.data.profile.acceptDirectCall) === 0 ? 0 : 1;
    if (next === prev) return;
    this.setData({ 'profile.acceptDirectCall': next });
    try {
      await api.request('/api/factory/me/profile', {
        method: 'PUT',
        data: { acceptDirectCall: next },
        headers: this.authHeaders(),
      });
      wx.showToast({
        title: next ? '已开启：客户登录后可直接拨打' : '已关闭：客户只能发起询价',
        icon: 'none',
      });
    } catch (err) {
      // 回滚到真实落库值，避免页面显示「已关闭」而服务端仍开着
      this.setData({ 'profile.acceptDirectCall': prev });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  // ===== Batch D1 经营硬指标（工厂自报，展示在工厂详情页概况段） =====
  onMetricInput(e) {
    this.setData({ ['metrics.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  // 对外加工是 0/1 三态（未表态=NULL），再点一次已选项即撤回
  pickOuter(e) {
    const code = e.currentTarget.dataset.code;
    this.setData({ 'metrics.outerProcessing': this.data.metrics.outerProcessing === code ? '' : code });
  },

  async saveMetrics() {
    try {
      await api.request('/api/factory/me/profile', {
        method: 'PUT',
        data: this.data.metrics,
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '硬指标已保存', icon: 'success' });
      this.loadAll();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== Batch D2 地图选址（找厂页「距离最近」的数据来源） =====
  // 后端 PUT /me/profile 对 lat/lng 是成对处理，所以选址结果一个请求提交，不拆两步
  pickLocation() {
    wx.chooseLocation({
      success: (r) => {
        const patch = {
          lat: r.latitude,
          lng: r.longitude,
          // 工厂地址为空时顺手填上选点地址；已有地址就不动它，后台/工厂自己写的地址比自动选址更可靠
          ...(this.data.profile.address ? {} : { address: r.address || r.name || '' }),
        };
        this.setData({
          'geo.lat': patch.lat,
          'geo.lng': patch.lng,
          geoText: patch.lat.toFixed(6) + ', ' + patch.lng.toFixed(6),
          hasGeo: true,
          ...(patch.address ? { 'profile.address': patch.address } : {}),
        });
        this.saveGeo(patch, r.name || '');
      },
      // 用户主动取消不提醒；其余失败（未授权/后台定位关）给出可操作的下一步
      fail: (e) => {
        if (e && String(e.errMsg || '').indexOf('cancel') >= 0) return;
        wx.showModal({
          title: '选址失败',
          content: '需要在右上角“…”→ 设置里允许使用位置权限，再重新选址',
          showCancel: false,
        });
      },
    });
  },

  async saveGeo(patch, placeName) {
    try {
      await api.request('/api/factory/me/profile', {
        method: 'PUT',
        data: patch,
        headers: this.authHeaders(),
      });
      wx.showToast({ title: placeName ? '已选址：' + placeName : '坐标已保存', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
      this.loadAll();
    }
  },

  // 撤回选址（搬厂/选错了）：两个都传空 → 后端归一为 NULL
  async clearGeo() {
    try {
      await api.request('/api/factory/me/profile', {
        method: 'PUT',
        data: { lat: '', lng: '' },
        headers: this.authHeaders(),
      });
      this.setData({ 'geo.lat': '', 'geo.lng': '', geoText: '未选址', hasGeo: false });
      wx.showToast({ title: '已清除选址', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 价格体系 =====
  onPricingInput(e) {
    this.setData({ ['pricing.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  async savePricing() {
    const p = this.data.pricing;
    try {
      await api.request('/api/factory/me/pricing', {
        method: 'PUT',
        data: {
          defaultMargin: (Number(p.marginPct) || 0) / 100,
          defaultTaxRate: (Number(p.taxRatePct) || 0) / 100,
          defaultWasteRate: (Number(p.wasteRatePct) || 0) / 100,
        },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '定价已保存', icon: 'success' });
      this.loadAll();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 价格覆盖 =====
  onNewOverrideInput(e) {
    this.setData({ ['newOverride.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  onOverrideTypeChange(e) {
    const idx = Number(e.detail.value);
    const type = OVERRIDE_TYPES[idx];
    const options = this.data.catalogOptions[type.value] || [];
    this.setData({
      'newOverride.typeIndex': idx,
      'newOverride.fieldIndex': 0,
      'newOverride.codeIndex': 0,
      overrideFieldNames: type.fields.map((f) => f.name),
      codeNames: options.map((x) => x.name),
      fieldUnit: fieldUnit(type.fields[0].name),
    });
  },

  onOverrideCodeChange(e) {
    this.setData({ 'newOverride.codeIndex': Number(e.detail.value) });
  },

  onOverrideFieldChange(e) {
    const idx = Number(e.detail.value);
    this.setData({
      'newOverride.fieldIndex': idx,
      fieldUnit: fieldUnit(this.data.overrideFieldNames[idx]),
    });
  },

  async addOverride() {
    const o = this.data.newOverride;
    const type = OVERRIDE_TYPES[o.typeIndex];
    const field = type.fields[o.fieldIndex];
    const opt = (this.data.catalogOptions[type.value] || [])[o.codeIndex];
    if (!opt) return wx.showToast({ title: '请选择材料/工艺编码', icon: 'none' });
    if (o.fieldValue === '' || isNaN(Number(o.fieldValue))) {
      return wx.showToast({ title: '请填写数值', icon: 'none' });
    }
    try {
      await api.request('/api/factory/me/override', {
        method: 'POST',
        data: { targetType: type.value, targetCode: opt.code, fieldName: field.value, fieldValue: Number(o.fieldValue) },
        headers: this.authHeaders(),
      });
      this.setData({ 'newOverride.fieldValue': '' });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.loadAll();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async removeOverride(e) {
    const { tType, tCode, fName } = e.currentTarget.dataset;
    const res = await new Promise((resolve) => wx.showModal({
      title: '删除覆盖',
      content: '确认删除该价格覆盖？删除后恢复平台默认价。',
      success: resolve,
    }));
    if (!res.confirm) return;
    try {
      await api.request('/api/factory/me/override', {
        method: 'DELETE',
        data: { targetType: tType, targetCode: tCode, fieldName: fName },
        headers: this.authHeaders(),
      });
      this.loadAll();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 生产能力 =====
  toggleCap(e) {
    const { type, code } = e.currentTarget.dataset;
    const list = (this.data.caps[type] || []).slice();
    const idx = list.indexOf(code);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(code);
    const caps = { ...this.data.caps, [type]: list };
    this.setData({ caps, capView: buildCapView(caps) });
  },

  async saveCaps() {
    try {
      await api.request('/api/factory/me/capabilities', {
        method: 'POST',
        data: this.data.caps,
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '能力已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 027 闲置产能填报（填报后 72h 内有效，撮合/找厂优先推空闲厂） =====
  fmtDate(t) {
    const d = new Date(t);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  pickCapacity(e) {
    const code = e.currentTarget.dataset.code;
    this.setData({ 'capacity.status': this.data.capacity.status === code ? '' : code });
  },

  onCapNoteInput(e) {
    this.setData({ 'capacity.note': e.detail.value });
  },

  async saveCapacity() {
    const c = this.data.capacity;
    if (!c.status) return wx.showToast({ title: '请选择产能状态', icon: 'none' });
    try {
      await api.request('/api/factory/me/capacity', {
        method: 'PUT',
        data: { status: c.status, note: c.note },
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '产能已填报', icon: 'success' });
      this.loadAll();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 027 设备图文画像（base64 上传与头像同机制；实拍先上传先展示，资质证书与视频需平台审核） =====
  onMediaTypeChange(e) {
    this.setData({ mediaTypeIndex: Number(e.detail.value) });
  },

  addMedia() {
    const d = this.data;
    if (d.media.length >= MAX_MEDIA_COUNT) {
      return wx.showToast({ title: '最多 ' + MAX_MEDIA_COUNT + ' 张，请先删除旧图', icon: 'none' });
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        // 先填图注（可选）：如“海德堡对开机×2”，展示在 C 端图集
        const modal = await new Promise((resolve) => wx.showModal({
          title: '图注（选填）',
          editable: true,
          placeholderText: '如：海德堡对开机×2',
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }));
        if (!modal || !modal.confirm) return;
        const caption = (modal.content || '').trim().slice(0, 100);
        wx.showLoading({ title: '上传中', mask: true });
        try {
          const base64 = await new Promise((resolve, reject) => {
            wx.getFileSystemManager().readFile({ filePath: file.tempFilePath, encoding: 'base64', success: (r) => resolve(r.data), fail: reject });
          });
          const m = /\.(png|jpe?g|gif|webp)(\?|$)/i.exec(file.tempFilePath);
          const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
          await api.request('/api/factory/me/media', {
            method: 'POST',
            data: {
              dataUrl: 'data:image/' + ext + ';base64,' + base64,
              mediaType: MEDIA_TYPE_OPTIONS[d.mediaTypeIndex].code,
              caption,
            },
            headers: this.authHeaders(),
          });
          wx.hideLoading();
          wx.showToast({ title: '已上传', icon: 'success' });
          this.loadAll();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '上传失败', icon: 'none' });
        }
      },
    });
  },

  previewMedia(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [this.data.apiBase + url] });
  },

  async removeMedia(e) {
    const { id } = e.currentTarget.dataset;
    const r = await new Promise((resolve) => wx.showModal({
      title: '删除图片',
      content: '确认删除这张图？删除后 C 端图集同步移除。',
      success: resolve,
    }));
    if (!r.confirm) return;
    try {
      await api.request('/api/factory/me/media/' + id, { method: 'DELETE', headers: this.authHeaders() });
      wx.showToast({ title: '已删除', icon: 'success' });
      this.loadAll();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // Batch D3 图集视频：必须走 multipart 而不是既有的 base64 通道——
  // 全局 express.json 限额 2MB，且 base64 比原文件还大约 1/3，视频传不上来（见 middlewares/upload.js）
  addVideo() {
    const d = this.data;
    if (d.media.length >= MAX_MEDIA_COUNT) {
      return wx.showToast({ title: '最多 ' + MAX_MEDIA_COUNT + ' 项，请先删除旧内容', icon: 'none' });
    }
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: 60,
      compressed: true,
      camera: 'back',
      success: async (res) => {
        const sizeMb = Math.round((Number(res.size) || 0) / 1024 / 1024 * 10) / 10;
        if (sizeMb > MAX_VIDEO_MB) {
          return wx.showToast({ title: '视频 ' + sizeMb + 'MB 超过 ' + MAX_VIDEO_MB + 'MB 上限', icon: 'none' });
        }
        const modal = await new Promise((resolve) => wx.showModal({
          title: '视频说明（选填）',
          editable: true,
          placeholderText: '如：车间实拍 · 海德堡开机中',
          success: resolve,
          fail: () => resolve({ confirm: false }),
        }));
        if (!modal || !modal.confirm) return;
        const caption = (modal.content || '').trim().slice(0, 100);
        wx.showLoading({ title: '上传中', mask: true });
        try {
          await api.upload('/api/factory/me/media-video', res.tempFilePath, {
            caption,
            // 时长由端上给（wx.chooseVideo 返回秒数），服务端不解析容器元数据
            duration: Math.round(Number(res.duration) || 0),
          }, { headers: this.authHeaders() });
          wx.hideLoading();
          wx.showToast({ title: '已上传，待平台审核', icon: 'none' });
          this.loadAll();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '上传失败', icon: 'none' });
        }
      },
      fail: () => { /* 用户取消选择，不打扰 */ },
    });
  },

  playVideo(e) {
    const { url, id } = e.currentTarget.dataset;
    if (!url) return;
    const item = (this.data.media || []).find((m) => String(m.id) === String(id)) || {};
    this.setData({
      videoVisible: true,
      videoUrl: this.data.apiBase + url,
      videoTitle: item.caption || '工厂视频',
      videoStatusText: VIDEO_STATUS_TEXT[item.audit_status] || '',
    });
  },

  closeVideo() {
    // src 一并清空：video 是原生组件，只把浮层 v:if 关掉会留下一个还在出声的播放器
    this.setData({ videoVisible: false, videoUrl: '', videoTitle: '', videoStatusText: '' });
  },

  // 视频首帧封面：不传也能用（C 端视频区按类型给占位块），这里只是让工厂能把视频做得好看
  setVideoCover(e) {
    const mediaId = e.currentTarget.dataset.id;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        wx.showLoading({ title: '上传中', mask: true });
        try {
          await api.upload('/api/factory/me/media-video-cover', file.tempFilePath,
            { mediaId }, { headers: this.authHeaders() });
          wx.hideLoading();
          wx.showToast({ title: '封面已更新', icon: 'success' });
          this.loadAll();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message || '封面上传失败', icon: 'none' });
        }
      },
      fail: () => { /* 用户取消选择 */ },
    });
  },

  // ===== 员工管理（简版：列表 + 新增 + 启停） =====
  async loadStaffs() {
    try {
      const res = await api.request('/api/factory/me/staff', { headers: this.authHeaders() });
      this.setData({ staff: (res.data || []).map((u) => ({ ...u, roleText: ROLE_TEXT[u.role] || u.role })) });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onNewStaffInput(e) {
    this.setData({ ['newStaff.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  onStaffRoleChange(e) {
    this.setData({ 'newStaff.roleIndex': Number(e.detail.value) });
  },

  async addStaff() {
    const s = this.data.newStaff;
    if (!s.username || s.username.length < 4) return wx.showToast({ title: '账号至少 4 位', icon: 'none' });
    if (!s.password || s.password.length < 6) return wx.showToast({ title: '初始密码至少 6 位', icon: 'none' });
    const role = STAFF_ROLES[s.roleIndex] || STAFF_ROLES[1];
    try {
      await api.request('/api/factory/me/staff', {
        method: 'POST',
        data: { username: s.username.trim(), password: s.password, realName: s.realName, phone: s.phone, role: role.value },
        headers: this.authHeaders(),
      });
      this.setData({ newStaff: { username: '', password: '', realName: '', phone: '', roleIndex: 1 } });
      wx.showToast({ title: '已添加', icon: 'success' });
      this.loadStaffs();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async toggleStaffStatus(e) {
    const { id, name, status } = e.currentTarget.dataset;
    const action = Number(status) ? '禁用' : '启用';
    const tip = Number(status) ? '，禁用后其所有设备立即无法登录' : '';
    const res = await new Promise((resolve) => wx.showModal({
      title: action + '员工',
      content: '确认' + action + '「' + name + '」' + tip + '？',
      success: resolve,
    }));
    if (!res.confirm) return;
    try {
      await api.request('/api/factory/me/staff/' + id + '/toggle', {
        method: 'POST',
        headers: this.authHeaders(),
      });
      wx.showToast({ title: '已' + action, icon: 'success' });
      this.loadStaffs();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== F-102 我的专属二维码 =====
  async openQrcode() {
    this.setData({ qrVisible: true });
    if (this.data.qrcodeUrl) return; // 已生成过直接展示（服务端落盘幂等复用）
    this.setData({ qrLoading: true });
    try {
      const res = await api.request('/api/factory/me/miniprogram-qrcode', { headers: this.authHeaders() });
      const d = res.data || {};
      this.setData({
        qrcodeUrl: d.qrcodeUrl ? api.BASE_URL + d.qrcodeUrl : '',
        qrcodeTip: d.tip || '',
        qrLoading: false,
      });
    } catch (err) {
      this.setData({ qrLoading: false });
      wx.showToast({ title: err.message || '二维码生成失败', icon: 'none' });
    }
  },

  closeQrcode() {
    this.setData({ qrVisible: false });
  },

  // 保存到相册：先下载临时文件再写入相册；拒绝授权时引导去设置页开启
  async saveQrcode() {
    if (!this.data.qrcodeUrl) return;
    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const dl = await new Promise((resolve, reject) =>
        wx.downloadFile({ url: this.data.qrcodeUrl, success: resolve, fail: reject }));
      await new Promise((resolve, reject) =>
        wx.saveImageToPhotosAlbum({ filePath: dl.tempFilePath, success: resolve, fail: reject }));
      wx.hideLoading();
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      const msg = (err && err.errMsg) || '';
      if (msg.indexOf('auth') >= 0 || msg.indexOf('deny') >= 0) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册',
          confirmText: '去设置',
          success: (r) => { if (r.confirm) wx.openSetting(); },
        });
      } else {
        wx.showToast({ title: '保存失败，可长按图片保存', icon: 'none' });
      }
    }
  },

  // ===== 修改密码 =====
  onPwdInput(e) {
    this.setData({ ['pwd.' + e.currentTarget.dataset.field]: e.detail.value });
  },

  async savePwd() {
    const p = this.data.pwd;
    if (!p.old || !p.n1) return wx.showToast({ title: '请输入原密码和新密码', icon: 'none' });
    if (p.n1.length < 6) return wx.showToast({ title: '新密码至少 6 位', icon: 'none' });
    if (p.n1 !== p.n2) return wx.showToast({ title: '两次输入不一致', icon: 'none' });
    try {
      await api.request('/api/factory/me/password', {
        method: 'POST',
        data: { oldPassword: p.old, newPassword: p.n1 },
        headers: this.authHeaders(),
      });
      this.setData({ pwd: { old: '', n1: '', n2: '' } });
      wx.showToast({ title: '密码已修改', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // ===== 021 微信一键登录绑定（员工自助）=====

  // 绑定当前微信到本员工账号：之后接单页「微信一键登录」按 openid 直进
  async bindWx() {
    if (this.data.wxBinding) return;
    this.setData({ wxBinding: true });
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({ success: (r) => (r.code ? resolve(r.code) : reject(new Error(r.errMsg || '微信登录失败'))), fail: reject });
      });
      await api.request('/api/auth/factory-wx-bind', {
        method: 'POST', data: { code }, headers: this.authHeaders(),
      });
      this.setData({ wxBound: true });
      wx.showToast({ title: '绑定成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none', duration: 3500 });
    } finally {
      this.setData({ wxBinding: false });
    }
  },

  async unbindWx() {
    const res = await new Promise((resolve) => wx.showModal({
      title: '解绑微信',
      content: '解绑后本微信将无法一键登录，需重新绑定或改用账号密码。',
      success: resolve,
    }));
    if (!res.confirm) return;
    try {
      await api.request('/api/auth/factory-wx-unbind', { method: 'POST', headers: this.authHeaders() });
      this.setData({ wxBound: false });
      wx.showToast({ title: '已解绑', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 退出当前工厂账号：接单页头部只留「沟通」, 退出统一收在账号分区
  async logout() {
    const r = await new Promise((resolve) => wx.showModal({
      title: '退出工厂账号',
      content: '确认退出「' + ((this.data.factoryInfo && this.data.factoryInfo.name) || '工厂') + '」？退出后接单页需重新登录。',
      confirmColor: '#e64340',
      success: resolve,
    }));
    if (!r.confirm) return;
    // 先作废服务端会话（与「我的」页退出同口径）, 失败也继续本地退出
    try {
      await api.request('/api/auth/factory-logout', { method: 'POST', data: {}, headers: this.authHeaders() });
    } catch (e) { /* 服务端登出失败不影响本地退出 */ }
    wx.removeStorageSync('factoryAuth');
    this.setData({ auth: null });
    wx.showToast({ title: '已退出工厂账号', icon: 'success' });
    // 回接单页（tab 页 onShow 会同步为未登录态并展示登录卡）
    setTimeout(() => wx.switchTab({ url: '/pages/factory/factory' }), 900);
  },

  // 返回上一页（自定义导航栏无原生返回按钮）
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/factory/factory' }) });
  },
});
