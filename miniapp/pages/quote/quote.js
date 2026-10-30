const api = require('../../utils/api');

// 021 有排版模板的品类（与 design_template 种子一致；进入智能排版工具前据此提示）
const DESIGN_TOOL_PRODUCTS = ['nonWovenBag', 'paperBag'];

// 数量词数字 token → 整数：语音报价常说"一万个/1万个"，只认 \d+ 会丢数量
// 支持纯阿拉伯（1万）、纯中文（一万五）、混写（1万5千 / 1.5万）；口语省略：三千二=3200，有"零"直加：一万零五=10005
function qtyTokenToInt(s) {
  const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 };
  let total = 0, section = 0, num = 0, lastUnit = 1, hasLing = false, arabic = '';
  const flush = () => { if (arabic) { num = parseFloat(arabic); arabic = ''; } };
  for (const ch of s) {
    if (/[0-9.]/.test(ch)) { arabic += ch; continue; }  // 阿拉伯数字（含小数点）先缓冲
    if (ch === '零') { flush(); num = 0; hasLing = true; continue; }  // 须在 DIGITS 判断之前
    if (ch in DIGITS) { flush(); num = DIGITS[ch]; continue; }
    const u = UNITS[ch];
    if (!u) return null;
    flush();
    if (u >= 10000) { section = (section + num) * u; total += section; section = 0; }
    else { section += (num || 1) * u; }
    num = 0; lastUnit = u; hasLing = false;
  }
  flush();
  // 尾数字按最后一级单位补位（一万五=15000）；有"零"则直加个位（一万零五=10005）
  return Math.round(total + section + (num ? (hasLing ? num : num * Math.max(lastUnit / 10, 1)) : 0));
}

Page({
  data: {
    loading: false,
    apiBase: api.BASE_URL, // 021 参考图相对 URL 拼完整地址用
    voiceEnabled: true, // F-105 语音总开关：后端未配置 ASR/插件时置 false 隐藏入口
    voiceMode: 'asr',   // F-105 通道：'asr'=原生录音+后端识别（个人主体现状）；'plugin'=同声传译插件（个体户开通后切回，见 initVoiceManager 注释）
    voiceRecording: false, // F-105 语音识别中（按住说话态）
    voiceTarget: '',       // F-105 正在识别的回填目标字段（textInput/designNote，按钮按下态区分用）
    termsVisible: false,  // F-85 首次启动协议弹窗
    termsChecked: false,  // 协议勾选状态（未勾不允许继续）
    guideVisible: false,  // F-96 新用户三步引导
    guideStep: 0,         // 当前引导步骤（0/1/2）
    textInput: '',
    parsedTags: [],
    productIndex: 0,
    materialIndex: 0,
    templateIndex: 0,
    productTypes: [
      { value: 'carton', label: '纸箱' },
      { value: 'cardBox', label: '彩盒' },
      { value: 'card', label: '卡片' },
      { value: 'paperBag', label: '纸袋' },
      { value: 'sticker', label: '不干胶' },
      { value: 'flexiblePackaging', label: '软包装' },
      { value: 'nonWovenBag', label: '无纺布袋' },
      { value: 'antiCounterfeitLabel', label: '防伪标签' },
      { value: 'heatTransfer', label: '热转印' },
      { value: 'paperContainer', label: '纸容器' },
    ],
    // 场景模板：一键带入产品类型 + 常用材料（icon 为 app.wxss 线性图标类名，全站统一风格）
    templates: [
      { icon: 'ic-box', name: '纸箱', desc: '双坑BC楞 · 1.78元/㎡', product: 'carton', materialCode: 'B_BC5' },
      { icon: 'ic-p-gift', name: '彩盒', desc: '250g白卡 · 覆哑膜', product: 'cardBox', materialCode: 'CARD250' },
      { icon: 'ic-p-card', name: '卡片', desc: '300g白卡 · 烫金', product: 'card', materialCode: 'CARD300' },
      { icon: 'ic-p-bag', name: '纸袋', desc: '300g牛皮纸 · 穿绳', product: 'paperBag', materialCode: 'KRAFT300' },
      { icon: 'ic-p-tag', name: '不干胶', desc: '铜版纸 · 模切', product: 'sticker', materialCode: 'STK_COPPER' },
      { icon: 'ic-p-pouch', name: '软包装', desc: 'PP 4丝 · 三边封', product: 'flexiblePackaging', materialCode: 'PP_40' },
      { icon: 'ic-p-tote', name: '无纺布袋', desc: '100g · 车缝', product: 'nonWovenBag', materialCode: 'NW_100' },
      { icon: 'ic-p-shield', name: '防伪标签', desc: '激光防伪 · 溯源', product: 'antiCounterfeitLabel', materialCode: 'STK_COPPER' },
      { icon: 'ic-p-heat', name: '热转印', desc: '花膜 · 模内贴标', product: 'heatTransfer', materialCode: 'HTF_FILM' },
      { icon: 'ic-p-cup', name: '纸容器', desc: '320g食品白卡 · 杯成型', product: 'paperContainer', materialCode: 'FOOD_CARD' },
    ],
    // 全量材料库；materialOptions 随品类过滤（纸板/卡纸/薄膜三类）
    materials: [
      { code: 'B_BC5', name: '双坑BC楞', type: 'boardPaper' },
      { code: 'B_B3', name: '单坑B楞', type: 'boardPaper' },
      { code: 'B_A3', name: '单坑A楞', type: 'boardPaper' },
      { code: 'B_E3', name: '单坑E楞', type: 'boardPaper' },
      { code: 'CARD250', name: '250g白卡', type: 'cardPaper' },
      { code: 'CARD300', name: '300g白卡', type: 'cardPaper' },
      { code: 'COAT200', name: '200g铜版', type: 'cardPaper' },
      { code: 'KRAFT120', name: '120g牛皮纸', type: 'cardPaper' },
      { code: 'KRAFT200', name: '200g牛皮纸', type: 'cardPaper' },
      { code: 'KRAFT300', name: '300g牛皮纸', type: 'cardPaper' },
      { code: 'NW_80', name: '无纺布80g', type: 'cardPaper' },
      { code: 'NW_100', name: '无纺布100g', type: 'cardPaper' },
      { code: 'NW_120', name: '无纺布120g', type: 'cardPaper' },
      { code: 'HTF_FILM', name: '热转印花膜', type: 'cardPaper' },
      { code: 'STK_COPPER', name: '铜版纸不干胶', type: 'cardPaper' },
      { code: 'STK_PET', name: '透明PET不干胶', type: 'cardPaper' },
      { code: 'STK_SYNTH', name: '合成纸不干胶', type: 'cardPaper' },
      { code: 'STK_THERMAL', name: '热敏纸不干胶', type: 'cardPaper' },
      { code: 'STK_PETSILVER', name: 'PET哑银不干胶', type: 'cardPaper' },
      // 纸容器白名单材料（与 product_config.paperContainer / card_paper 目录一致）
      { code: 'FOOD_CARD', name: '320g食品白卡', type: 'cardPaper' },
      { code: 'FOOD_KRAFT', name: '300g食品牛皮卡', type: 'cardPaper' },
      { code: 'CUP_PE', name: '单PE淋膜杯纸', type: 'cardPaper' },
      { code: 'CUP_PLA', name: 'PLA淋膜杯纸', type: 'cardPaper' },
      { code: 'PP_40', name: 'PP 4丝', type: 'plasticFilm' },
      { code: 'PP_60', name: 'PP 6丝', type: 'plasticFilm' },
      { code: 'PE_50', name: 'PE 5丝', type: 'plasticFilm' },
      { code: 'PE_80', name: 'PE 8丝', type: 'plasticFilm' },
      { code: 'PET_35', name: 'PET 3.5丝', type: 'plasticFilm' },
    ],
    materialOptions: [],
    processes: [
      { code: 'MATTE_FILM', name: '覆哑膜', selected: false },
      { code: 'GLOSS_FILM', name: '覆光膜', selected: false },
      { code: 'UV_COAT', name: 'UV上光', selected: false },
      { code: 'CALENDAR', name: '压光', selected: false },
      { code: 'HOT_STAMP', name: '烫金', selected: false },
      { code: 'EMBOSS_PROC', name: '击凸', selected: false },
      { code: 'TEXTURE', name: '压纹', selected: false },
      { code: 'CORRUGATE', name: '瓦楞', selected: false },
      { code: 'DIE_CUT', name: '模切异形', selected: false },
      { code: 'GLUE_BOX', name: '粘箱', selected: false },
      { code: 'PACK', name: '打包', selected: false },
      { code: 'PUNCH', name: '打孔', selected: false },
      { code: 'PERF', name: '打拢线', selected: false },
      { code: 'ROPE', name: '穿绳打扣', selected: false },
      { code: 'ROPE_COTTON', name: '棉绳拎手', selected: false },
      { code: 'CLASP', name: '塑料扣', selected: false },
      { code: 'SEWING', name: '车缝', selected: false },
      { code: 'LAMINATE', name: '复合', selected: false },
      { code: 'BAG_3SEAL', name: '三边封制袋', selected: false },
      { code: 'BAG_CENTER', name: '中封制袋', selected: false },
      { code: 'BAG_STAND', name: '自立袋制袋', selected: false },
      { code: 'BAG_ZIP', name: '拉链袋制袋', selected: false },
      { code: 'LASER_AF', name: '激光防伪', selected: false },
      { code: 'SCRATCH', name: '刮刮银', selected: false },
      { code: 'FLUOR', name: '荧光油墨', selected: false },
      { code: 'VOID_AF', name: '揭开留底', selected: false },
      { code: 'TRACE_QR', name: '二维码溯源', selected: false },
      { code: 'FOLD', name: '折页', selected: false },
      { code: 'SADDLE', name: '骑马订', selected: false },
      { code: 'PERFECT_BIND', name: '无线胶装', selected: false },
      { code: 'SEW_BIND', name: '锁线胶装', selected: false },
      { code: 'FLOCK', name: '植绒', selected: false },
      // 纸容器工艺（白名单：杯成型/卷边/底封/卷管/贴标/组装/内衬）
      { code: 'CUP_FORMING', name: '杯成型', selected: false },
      { code: 'RIM_ROLLING', name: '卷边', selected: false },
      { code: 'BOTTOM_SEAL', name: '底封', selected: false },
      { code: 'TUBE_WINDING', name: '卷管', selected: false },
      { code: 'LABELING', name: '贴标', selected: false },
      { code: 'ASSEMBLY', name: '组装', selected: false },
      { code: 'LINING', name: '内衬', selected: false },
    ],
    qtyChips: [500, 1000, 2000, 5000, 10000],
    // 尺寸标签随品类切换（纸袋/无纺布袋：袋高×袋宽×侧宽；平面类：长×宽）
    sizeLabels: ['长', '宽', '高'],
    // 盒型/拼版（彩盒）、层数/袋型（软包装）、拎手（纸袋/无纺布袋）
    boxTypes: [
      { value: 'normal', label: '普通折叠盒' },
      { value: 'lidBase', label: '天地盖' },
      { value: 'drawer', label: '抽屉盒' },
    ],
    bagTypes: [
      { value: '3seal', label: '三边封', process: 'BAG_3SEAL' },
      { value: 'center', label: '中封', process: 'BAG_CENTER' },
      { value: 'stand', label: '自立袋', process: 'BAG_STAND' },
      { value: 'zip', label: '拉链袋', process: 'BAG_ZIP' },
    ],
    handleTypes: [
      { value: 'none', label: '无拎手', process: null },
      { value: 'paper', label: '普通绳', process: 'ROPE' },
      { value: 'cotton', label: '棉绳', process: 'ROPE_COTTON' },
      { value: 'clasp', label: '塑料扣', process: 'CLASP' },
    ],
    filmLayerOptions: [1, 2, 3],
    // 016 印刷参数：图案覆盖率/油墨类型/专色数量（参与印工系数与专色加价）
    patternCoverIndex: 1, // 默认中等
    patternCoverOptions: [
      { value: 'low', label: '少量（文字/logo为主）' },
      { value: 'mid', label: '中等（图案+文字）' },
      { value: 'high', label: '满版（整面都是图）' },
    ],
    inkTypeIndex: 0,
    inkTypeOptions: [
      { code: 'NORMAL', name: '普通油墨' },
      { code: 'UV', name: 'UV油墨（+30%）' },
      { code: 'METALLIC', name: '金属油墨（+50%）' },
      { code: 'FLUOR', name: '荧光油墨（+80%）' },
      { code: 'SOY', name: '大豆油墨（+15%）' },
    ],
    // 020 印刷配置：色数与专色合并单选（cmyk=四色 / cmyk+spot=四色+专色 / spot=纯专色），概念不再混淆
    printConfig: 'cmyk',
    // 020 三参数按品类显隐（/api/c/config 的 productConfig 下发；缺失默认全显）
    paramShow: { pattern: true, ink: true, spot: true },
    // 专色数量选项改为 1-6 色（印刷配置选中含专色时才展示，下标+1 即色数）
    spotColorIndex: 0,
    spotColorOptions: ['1 色', '2 色', '3 色', '4 色', '5 色', '6 色'],
    boxTypeIndex: 0,
    bagTypeIndex: 0,
    handleIndex: 1,
    filmLayersIndex: 0,
    // Stage9 产品类型联动配置（/api/c/config 下发；空对象=不联动，容错）
    linkConfig: {},
    // Stage11 找厂页「按此厂报价」带入的指定工厂（提交后询价单直接推送该厂）
    preferFactoryId: null,
    preferFactoryName: '',
    // F-102 工厂专属二维码：扫码进入即锁定该厂（持续性语义，手动 ✕ 才解除；询价只推给这家不走撮合）
    entryFactoryId: null,
    entryFactoryName: '',
    // 021 设计需求：none=已有设计稿（默认） need=需要设计（描述需求/传参考图，工厂报价含设计费）
    designMode: 'none',
    designNote: '',
    designImages: [],      // 参考图 URL 数组（/uploads/designs/ 下，含排版工具产出的稿）
    designPdfs: [],        // 024 排版工具产出的印刷制版 PDF（矢量文字/CMYK/裁切角线，随单给工厂直接制版）
    designToolAvailable: false, // 当前品类是否有智能排版模板（nonWovenBag/paperBag）
    // 自定义下拉弹层状态（原生 picker 弹层字号不可控，改用页面内大字体弹层）
    pickerVisible: false,
    pickerTitle: '',
    pickerOptions: [],
    pickerSelected: 0,
    pickerIntoView: '',
    form: {
      lengthMm: 300,
      widthMm: 200,
      heightMm: 150,
      quantity: 1000,
      nUp: 1,
    },
    // F-96 新用户三步引导：每步配图标/标题/说明，圆点指示进度，看过一次不再弹
    guideSteps: [
      { icon: '📦', title: '第一步 · 选产品', desc: '选择你要印的产品类型，或直接点上方「我想印」场景模板，一键带入常用配置。' },
      { icon: '📝', title: '第二步 · 填参数', desc: '填写尺寸、数量、材质与后道工艺；懒得逐项填就打字说需求，例如「1000个双坑纸箱 30x20x15厘米 覆哑膜」。' },
      { icon: '💰', title: '第三步 · 看报价', desc: '点「立即报价」实时算出成本明细，自动匹配龙港本地工厂，满意即可一键询价。' },
    ],
  },

  onLoad() {
    // Stage10 自定义导航栏：状态栏高度 + 与右上角胶囊对齐的导航栏高度
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
    // Stage9 拉取产品类型联动配置（印刷方式/材料/工艺白名单），失败静默容错
    // 注意：api.request 返回完整响应包 {success,data}，联动配置在 data 层
    api.request('/api/c/config').then((res) => {
      const cfg = (res && res.data) || {};
      const patch = { linkConfig: cfg.productConfig || {} };
      // 028：工艺清单改由目录动态下发（目录新增/停用工序即同步），本地写死列表仅作请求失败兜底；
      // 替换时保留用户已勾选项，并重置 _allProcesses 让品类联动按新清单重建
      const remote = cfg.finishingProcesses;
      if (Array.isArray(remote) && remote.length) {
        const prevSel = new Set(this.data.processes.filter((p) => p.selected).map((p) => p.code));
        patch.processes = remote.map((p) => ({ code: p.code, name: p.name, selected: prevSel.has(p.code) }));
        this._allProcesses = null;
      }
      this.setData(patch);
      // 首次 filterMaterials 可能先于请求返回，配置到达后按当前品类补一次联动：
      // 工艺按白名单收窄 + 材料按白名单重筛，保证纸容器等白名单品类联动即时生效
      const pv = this.data.productTypes[this.data.productIndex].value;
      this.applyLinkage(pv);
      this.filterMaterials(pv);
      // 020 配置到达后按当前品类补一次三参数显隐联动
      this.applyParamShow(pv);
    }).catch(() => {});
  },

  onShow() {
    this.applyRepurchase();
    this.syncTabBar();
    // 021 排版工具回跳：工具页产出的设计稿带回，挂到图片列表随单发给工厂（保持用户当前所选设计模式）
    const designResult = wx.getStorageSync('designResult');
    if (designResult && designResult.url) {
      wx.removeStorageSync('designResult');
      const images = this.data.designImages.indexOf(designResult.url) >= 0
        ? this.data.designImages
        : this.data.designImages.concat(designResult.url);
      this.setData({ designImages: images.slice(0, 3) });
      // 024 排版稿同步产出印刷制版 PDF：一并带回随单给工厂（AI 稿/拍照稿无 PDF）
      if (designResult.pdfUrl && this.data.designPdfs.indexOf(designResult.pdfUrl) < 0) {
        this.setData({ designPdfs: [designResult.pdfUrl] });
      }
      wx.showToast({ title: '设计稿已加入', icon: 'none' });
    }
    // Stage11 读取找厂页指定的工厂并展示；提交时随表单带给后端直接推送
    // Stage12 一次性语义：读完即清 storage，退出重进/跨会话不再残留横幅
    const preferFactoryId = wx.getStorageSync('preferFactoryId') || null;
    const preferFactoryName = wx.getStorageSync('preferFactoryName') || '';
    if (preferFactoryId || preferFactoryName) {
      wx.removeStorageSync('preferFactoryId');
      wx.removeStorageSync('preferFactoryName');
    }
    if (preferFactoryId !== this.data.preferFactoryId) {
      this.setData({ preferFactoryId, preferFactoryName });
    }
    // F-102 扫码锁定工厂（持续性，与 preferFactoryId 一次性不同）：保持锁定直到用户手动取消，
    // 老客户扫厂码后可能多次询价，故提交成功也不自动清除
    const entryFactoryId = wx.getStorageSync('entryFactoryId') || null;
    if (entryFactoryId !== this.data.entryFactoryId) {
      this.setData({ entryFactoryId, entryFactoryName: '' });
      if (entryFactoryId) this.loadEntryFactory(entryFactoryId);
    }
    // 首次进入按当前品类过滤材料列表
    if (!this.data.materialOptions.length) {
      this.filterMaterials(this.data.productTypes[this.data.productIndex].value);
    }
    // 021 智能排版入口按当前品类显隐
    this.updateDesignTool();
    // F-85 首次启动协议勾选：未同意则弹协议窗并阻断登录（app.js 保证不发起 user-login）
    const app = getApp();
    if (app && !app.globalData.agreed && !this.data.termsVisible) {
      this.setData({ termsVisible: true, termsChecked: false });
    }
    // F-96 协议已同意后，首次进入弹出三步引导
    this.maybeShowGuide();
  },

  // ---- F-85 协议勾选 ----
  // 自绘勾选框点击（替代原生 checkbox-group：模拟器部分基础库点不上原生 checkbox）
  toggleTermsCheck() {
    this.setData({ termsChecked: !this.data.termsChecked });
  },

  agreeTerms() {
    if (!this.data.termsChecked) {
      return wx.showToast({ title: '请先勾选「我已阅读并同意」', icon: 'none', duration: 2500 });
    }
    this.setData({ termsVisible: false });
    getApp().agreeTerms(); // 记录同意时间并补发登录
    // F-96 协议同意后紧接着弹新用户三步引导
    this.maybeShowGuide();
  },

  // ---- F-96 新用户三步引导：协议同意后首次进入触发，看过一次不再打扰 ----
  maybeShowGuide() {
    const app = getApp();
    if (!app || !app.globalData.agreed) return; // 协议未同意不弹（协议窗优先）
    if (this.data.termsVisible || this.data.guideVisible) return;
    if (wx.getStorageSync('guideDone')) return;
    this.setData({ guideVisible: true, guideStep: 0 });
  },

  nextGuideStep() {
    if (this.data.guideStep < this.data.guideSteps.length - 1) {
      this.setData({ guideStep: this.data.guideStep + 1 });
      return;
    }
    // 最后一步点「开始体验」：记录已引导并关闭
    wx.setStorageSync('guideDone', Date.now());
    this.setData({ guideVisible: false });
  },

  skipGuide() {
    wx.setStorageSync('guideDone', Date.now());
    this.setData({ guideVisible: false });
  },

  declineTerms() {
    wx.showToast({ title: '需同意协议后才能继续使用', icon: 'none', duration: 2500 });
  },

  // 打开后端托管的协议静态页（/legal/*，webview 通用页承载）
  openTermsDoc(e) {
    const type = e.currentTarget.dataset.type; // user-agreement | privacy
    const url = api.BASE_URL + '/legal/' + type + '.html';
    wx.navigateTo({ url: '/pages/webview/webview?url=' + encodeURIComponent(url) });
  },

  // 取消指定工厂，回落普通匹配逻辑
  clearPreferFactory() {
    wx.removeStorageSync('preferFactoryId');
    wx.removeStorageSync('preferFactoryName');
    this.setData({ preferFactoryId: null, preferFactoryName: '' });
  },

  // F-102 拉取锁定工厂名称（/public/:id 为公开接口，返回脱敏信息；失败静默，横幅保底展示「工厂N」）
  loadEntryFactory(factoryId) {
    api.request('/api/factory/public/' + factoryId).then((res) => {
      const f = res && res.data;
      if (f && f.name && factoryId === this.data.entryFactoryId) {
        this.setData({ entryFactoryName: f.name });
      }
    }).catch(() => {});
  },

  // F-102 解除扫码锁定，回落平台撮合匹配
  clearEntryFactory() {
    wx.removeStorageSync('entryFactoryId');
    this.setData({ entryFactoryId: null, entryFactoryName: '' });
  },

  // Stage12 匿名询价本地记账：登录成功后由 app.bindAnonymousInquiries 认领归户
  rememberAnonymousInquiry(inquiryId) {
    const ids = wx.getStorageSync('anonInquiryIds') || [];
    if (ids.indexOf(inquiryId) >= 0) return;
    ids.push(inquiryId);
    wx.setStorageSync('anonInquiryIds', ids.slice(-50));
  },

  // 自定义 tabBar：同步当前选中项
  syncTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncRole();
      this.getTabBar().selectByPath('/pages/quote/quote');
      this.getTabBar().updateBadge();
    }
  },

  // 一键复购：从「我的-询价记录」点「再次询价」跳转过来，带入历史参数
  // Batch E：社区帖子详情的「按此参数算一算」也走同一个通道（tabBar 页带不了 query, 只能走 storage）,
  // 它额外给一个 tip 覆盖文案——不然明明从社区带过来的也会说成「上次询价参数」
  applyRepurchase() {
    const p = wx.getStorageSync('repurchaseParams');
    if (!p || !p.productType) return;
    wx.removeStorageSync('repurchaseParams');
    const pi = this.data.productTypes.findIndex((x) => x.value === p.productType);
    this.setData({
      productIndex: pi >= 0 ? pi : 0,
      templateIndex: this.data.templates.findIndex((t) => t.product === p.productType),
      'form.lengthMm': Math.round((p.length_m || 0.3) * 1000),
      'form.widthMm': Math.round((p.width_m || 0.2) * 1000),
      'form.heightMm': Math.round((p.height_m || 0.15) * 1000),
      'form.quantity': p.quantity || 1000,
      'form.nUp': p.n_up || 1,
      boxTypeIndex: Math.max(0, this.data.boxTypes.findIndex((x) => x.value === (p.box_type || 'normal'))),
      filmLayersIndex: Math.max(0, this.data.filmLayerOptions.indexOf(p.film_layers || 1)),
    });
    if (pi >= 0) {
      this.updateSizeLabels(p.productType);
      this.filterMaterials(p.productType, p.material_code); // 内部按新品类白名单过滤工艺
      this.applyParamShow(p.productType);
      this.updateDesignTool(p.productType);
    }
    // 工艺选中态在过滤完成后的当前品类列表上回填
    const sel = new Set(p.processes || []);
    this.setData({
      processes: this.data.processes.map((x) => ({ ...x, selected: sel.has(x.code) })),
    });
    wx.showToast({ title: p.tip || '已带入上次询价参数', icon: 'none' });
  },

  // 场景模板：联动产品类型 + 推荐材料
  onTemplateTap(e) {
    const tpl = this.data.templates[e.currentTarget.dataset.index];
    const pi = this.data.productTypes.findIndex((x) => x.value === tpl.product);
    this.setData({
      templateIndex: e.currentTarget.dataset.index,
      productIndex: pi >= 0 ? pi : 0,
      boxTypeIndex: 0,
    });
    if (pi >= 0) {
      this.updateSizeLabels(tpl.product);
      this.filterMaterials(tpl.product, tpl.materialCode);
      this.applyParamShow(tpl.product);
      this.updateDesignTool(tpl.product);
    }
  },

  // 材料随品类过滤：优先按后端品类白名单收窄（纸容器等品类只展示白名单材料）；
  // 白名单缺失或无命中时按材料大类回退：纸箱→纸板，软包装→塑料薄膜，其余→卡纸系
  filterMaterials(productValue, preferCode) {
    const cfg = this.data.linkConfig[productValue];
    let materialOptions = [];
    if (cfg && cfg.materials && cfg.materials.length) {
      const allowSet = new Set(cfg.materials);
      materialOptions = this.data.materials.filter((m) => allowSet.has(m.code));
    }
    if (!materialOptions.length) {
      const typeMap = { carton: 'boardPaper', flexiblePackaging: 'plasticFilm' };
      const wantType = typeMap[productValue] || 'cardPaper';
      materialOptions = this.data.materials.filter((m) => m.type === wantType);
    }
    let materialIndex = 0;
    if (preferCode) {
      const mi = materialOptions.findIndex((m) => m.code === preferCode);
      if (mi >= 0) materialIndex = mi;
    }
    this.setData({ materialOptions, materialIndex });
    this.applyLinkage(productValue);
  },

  // Stage9 品类联动：只展示当前品类白名单内的工艺，白名单外的直接不渲染（避免长串灰标签刷屏）；
  // 配置缺失时放开全量。全量主列表存于 _allProcesses，避免过滤后丢失、切品类时无法恢复
  applyLinkage(productValue) {
    const all = this._allProcesses || (this._allProcesses = this.data.processes);
    const prevSel = new Set(this.data.processes.filter((p) => p.selected).map((p) => p.code));
    const cfg = this.data.linkConfig[productValue];
    if (!cfg || !cfg.processes || !cfg.processes.length) {
      this.setData({ processes: all.map((p) => ({ ...p, selected: prevSel.has(p.code), allowed: true })) });
      return;
    }
    const allowSet = new Set(cfg.processes);
    this.setData({
      processes: all
        .filter((p) => allowSet.has(p.code))
        .map((p) => ({ ...p, selected: prevSel.has(p.code), allowed: true })),
    });
  },

  // 数量快捷选择
  onQtyChip(e) {
    this.setData({ 'form.quantity': e.currentTarget.dataset.q });
    this.refreshTags();
  },

  onTextInput(e) {
    this.setData({ textInput: e.detail.value });
    this.refreshTags();
  },

  // ---- F-105 语音报价：按住说话 → 识别文本填入一句话报价并即时解析 ----
  // 双通道（voiceMode）：
  //  'asr'（当前默认）个人主体小程序无法添加「微信同声传译」插件（工具申请报 89260、
  //   声明 plugins 则启动报「插件未授权使用」整个 App 进不去），改走原生录音
  //   wx.getRecorderManager → 上传后端 POST /api/voice/recognize（讯飞 ASR，需 XF_* 密钥）→ 文本回填；
  //  'plugin' 个体户主体开通后切回微信同声传译插件，切回步骤：
  //   1) mp 后台「设置→第三方设置→插件管理」添加插件 wx069ba97219f66d99；
  //   2) app.json 恢复 plugins 声明（WechatSI / version 0.3.5 / provider wx069ba97219f66d99）；
  //   3) data.voiceMode 改 'plugin'，并把 initVoiceManager 恢复为下方注释中的实现。
  initVoiceManager() {
    /* plugin 通道恢复此实现（前提：app.json 已声明 WechatSI 插件）：
    if (this._voiceMgr !== undefined) return this._voiceMgr;
    try {
      const plugin = requirePlugin('WechatSI');
      const mgr = plugin.getRecordRecognitionManager();
      mgr.onStop = (res) => {
        const text = ((res && res.result) || '').trim();
        this.setData({ voiceRecording: false });
        if (!text) {
          wx.showToast({ title: '未识别到内容，请再说一次', icon: 'none' });
          return;
        }
        this.setData({ textInput: text });
        this.refreshTags();
        wx.showToast({ title: '识别成功', icon: 'success' });
      };
      mgr.onError = () => {
        this.setData({ voiceRecording: false });
        wx.showToast({ title: '语音识别失败，请重试', icon: 'none' });
      };
      this._voiceMgr = mgr;
    } catch (e) {
      this._voiceMgr = null;
    }
    return this._voiceMgr;
    */
    return null; // asr 通道不走插件管理器，录音由 initRecorder 接管
  },

  // asr 通道录音器：wx.getRecorderManager 全局唯一实例，惰性创建并绑定回调
  initRecorder() {
    if (this._recorder) return this._recorder;
    const mgr = wx.getRecorderManager();
    mgr.onStop((res) => {
      this.setData({ voiceRecording: false, voiceTarget: '' });
      if (res && res.tempFilePath) {
        // 识别目标在按压时记录（_voiceField/_voiceAppend），支持多输入框复用同一录音器
        this.uploadVoice(res.tempFilePath, this._voiceField || 'textInput', this._voiceAppend !== false);
      }
    });
    mgr.onError(() => {
      this.setData({ voiceRecording: false, voiceTarget: '' });
      wx.showToast({ title: '录音失败，请重试', icon: 'none' });
    });
    this._recorder = mgr;
    return mgr;
  },

  // 上传录音 → 后端讯飞 ASR → 识别文本回填。
  // field: 回填的数据字段（默认 textInput 一句话报价）；append=true 时拼到已有内容后（设计需求场景）
  uploadVoice(tempFilePath, field, append) {
    wx.showLoading({ title: '识别中...' });
    const header = {};
    try {
      const userAuth = wx.getStorageSync('userAuth');
      if (userAuth && userAuth.userId) {
        header['X-User-Id'] = String(userAuth.userId);
        header['X-User-Token'] = userAuth.token;
      }
    } catch (e) { /* 匿名报价无需登录态 */ }
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
          if (field === 'designNote') {
            const old = (this.data.designNote || '').trim();
            const merged = old ? (old + '，' + text).slice(0, 200) : text.slice(0, 200);
            this.setData({ designNote: merged });
            wx.showToast({ title: '识别成功', icon: 'success' });
          } else {
            this.setData({ textInput: text });
            this.refreshTags();
            wx.showToast({ title: '识别成功', icon: 'success' });
          }
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

  // 按住开始录音识别。e.currentTarget.dataset.target 指定回填字段（缺省 textInput）
  startVoice(e) {
    const target = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.target) || 'textInput';
    if (this.data.voiceMode === 'plugin') {
      const mgr = this.initVoiceManager();
      if (!mgr) {
        wx.showToast({ title: '语音组件不可用，请直接输入', icon: 'none' });
        return;
      }
      this._voiceField = target;
      this.setData({ voiceRecording: true, voiceTarget: target });
      mgr.start({ duration: 30000, lang: 'zh_CN' });
      return;
    }
    // asr 通道：原生录音（16kHz 单声道 PCM，讯飞 ASR 直接可用，后端兜底再转一次）
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this._voiceField = target;
        this._voiceAppend = true;
        this.setData({ voiceRecording: true, voiceTarget: target });
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
          content: '请在设置中开启麦克风权限，以使用语音报价功能。',
          success: (r) => { if (r.confirm) wx.openSetting(); },
        });
      },
    });
  },

  // 松开结束（状态复位在 onStop 回调统一处理）
  stopVoice() {
    if (!this.data.voiceRecording) return;
    if (this.data.voiceMode === 'plugin') {
      if (this._voiceMgr) this._voiceMgr.stop();
      return;
    }
    if (this._recorder) this._recorder.stop();
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
    this.refreshTags();
  },
  // 手选产品类型：同步联动尺寸标签/材料过滤，并反联动「我想印」模板高亮
  applyProductIndex(productIndex) {
    const productValue = this.data.productTypes[productIndex].value;
    const ti = this.data.templates.findIndex((t) => t.product === productValue);
    this.setData({
      productIndex,
      templateIndex: ti >= 0 ? ti : -1,
      boxTypeIndex: 0,
    });
    this.updateSizeLabels(productValue);
    this.filterMaterials(productValue);
    this.applyParamShow(productValue);
    this.updateDesignTool(productValue);
    this.refreshTags();
  },

  // 021 当前品类是否有智能排版模板（wxml 据此显隐「智能排版」入口）
  updateDesignTool(productValue) {
    const pv = productValue || (this.data.productTypes[this.data.productIndex] || {}).value;
    this.setData({ designToolAvailable: DESIGN_TOOL_PRODUCTS.indexOf(pv) >= 0 });
  },

  // 020 三参数显隐联动：按品类配置（/api/c/config 下发）显示/隐藏图案覆盖率/油墨类型/专色数量。
  // 隐藏时重置为中性取值（图案 low=×1.0、油墨 NORMAL=×1.0、专色回落四色），保证该品类价格不随隐藏参数波动
  applyParamShow(productValue) {
    const cfg = this.data.linkConfig[productValue];
    const show = {
      pattern: !cfg || cfg.showPatternCover !== false,
      ink: !cfg || cfg.showInkType !== false,
      spot: !cfg || cfg.showSpotColors !== false,
    };
    const patch = { paramShow: show };
    if (!show.pattern) patch.patternCoverIndex = 0;
    if (!show.ink) patch.inkTypeIndex = 0;
    if (!show.spot) { patch.printConfig = 'cmyk'; patch.spotColorIndex = 0; }
    this.setData(patch);
  },

  // 020 印刷配置单选：色数与专色合并（四色CMYK / 四色+专色 / 纯专色），选中含专色时展开专色数量选择
  onPrintConfigChange(e) {
    this.setData({ printConfig: e.currentTarget.dataset.pc });
    this.refreshTags();
  },

  // 自定义下拉弹层：原生 picker 弹层字号基础库写死且不可样式化，
  // 统一改为页面内大字体弹层（取消/确定交互与原生一致）
  showPicker(e) {
    const key = e.currentTarget.dataset.picker;
    const d = this.data;
    const map = {
      product: { title: '产品类型', options: d.productTypes.map((x) => x.label), selected: d.productIndex },
      boxType: { title: '盒型', options: d.boxTypes.map((x) => x.label), selected: d.boxTypeIndex },
      filmLayers: { title: '复合层数', options: d.filmLayerOptions.map((n) => n + ' 层'), selected: d.filmLayersIndex },
      bagType: { title: '袋型', options: d.bagTypes.map((x) => x.label), selected: d.bagTypeIndex },
      handle: { title: '拎手', options: d.handleTypes.map((x) => x.label), selected: d.handleIndex },
      material: { title: '材质', options: (d.materialOptions || []).map((x) => x.name), selected: d.materialIndex },
      // 016 印刷参数
      patternCover: { title: '图案覆盖率', options: d.patternCoverOptions.map((x) => x.label), selected: d.patternCoverIndex },
      inkType: { title: '油墨类型', options: d.inkTypeOptions.map((x) => x.name), selected: d.inkTypeIndex },
      spotColor: { title: '专色数量', options: d.spotColorOptions, selected: d.spotColorIndex },
    };
    const cfg = map[key];
    if (!cfg) return;
    this._pickerKey = key;
    this.setData({ pickerVisible: true, pickerTitle: cfg.title, pickerOptions: cfg.options, pickerSelected: cfg.selected, pickerIntoView: '' });
    // 打开弹层时滚动定位到当前选中项：scroll-view 会保留上次的滚动位置，
    // 不主动定位的话长列表（产品类型 10 项 / 材质白名单 4 项）的末项会被面板底边裁掉，
    // 视觉上就像「选项缺失」（纸容器/PLA淋膜杯纸因此被误以为没有下发）
    setTimeout(() => this.setData({ pickerIntoView: 'po-' + cfg.selected }), 50);
  },
  pickOption(e) {
    this.setData({ pickerSelected: Number(e.currentTarget.dataset.index) });
  },
  confirmPicker() {
    const key = this._pickerKey;
    const i = this.data.pickerSelected;
    this.closePicker();
    if (key === 'product') { this.applyProductIndex(i); return; }
    const fieldMap = {
      boxType: 'boxTypeIndex',
      bagType: 'bagTypeIndex',
      handle: 'handleIndex',
      filmLayers: 'filmLayersIndex',
      material: 'materialIndex',
      patternCover: 'patternCoverIndex',
      inkType: 'inkTypeIndex',
      spotColor: 'spotColorIndex',
    };
    const field = fieldMap[key];
    if (field) this.setData({ [field]: i });
    this.refreshTags();
  },
  closePicker() {
    this.setData({ pickerVisible: false });
  },

  // 尺寸标签随品类切换：纸袋/无纺布袋=袋高×袋宽×侧宽；平面类（不干胶/软包装/防伪/热转印）=长×宽
  updateSizeLabels(productValue) {
    const map = {
      carton: ['长', '宽', '高'],
      cardBox: ['长', '宽', '高'],
      card: ['长', '宽', '高'],
      paperBag: ['袋高', '袋宽', '侧宽'],
      nonWovenBag: ['袋高', '袋宽', '侧宽'],
      sticker: ['长', '宽'],
      flexiblePackaging: ['长', '宽'],
      antiCounterfeitLabel: ['长', '宽'],
      heatTransfer: ['长', '宽'],
    };
    const sizeLabels = map[productValue] || ['长', '宽', '高'];
    this.setData({ sizeLabels });
  },
  toggleProcess(e) {
    const code = e.currentTarget.dataset.code;
    const processes = this.data.processes.map((p) =>
      p.code === code && p.allowed !== false ? { ...p, selected: !p.selected } : p
    );
    this.setData({ processes });
    this.refreshTags();
  },

  // ---- 021 设计需求：自带稿/工厂公版/需要设计 三态 ----
  // none=自带设计稿（传稿图给工厂）；public=用工厂公版（备注要印的文字）；need=需要设计（描述+参考图，报价含设计费）
  onDesignMode(e) {
    const mode = e.currentTarget.dataset.m;
    // 切到「工厂公版」时不收图；切到「自带稿」时不收文字备注：清空非本模式数据，避免脏数据随单提交
    const patch = { designMode: mode };
    if (mode === 'none') patch.designNote = '';
    if (mode === 'public') { patch.designImages = []; patch.designPdfs = []; }
    this.setData(patch);
  },

  onDesignNote(e) {
    this.setData({ designNote: e.detail.value });
  },

  // 选图上传：微信选图 → 上传后端 → 拿回 URL 挂列表（最多 3 张，点图预览、长按删）
  addDesignImg() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        wx.showLoading({ title: '上传中...' });
        const header = {};
        try {
          const userAuth = wx.getStorageSync('userAuth');
          if (userAuth && userAuth.userId) {
            header['X-User-Id'] = String(userAuth.userId);
            header['X-User-Token'] = userAuth.token;
          }
        } catch (e) { /* 匿名报价无需登录态 */ }
        wx.uploadFile({
          url: api.BASE_URL + '/api/c/upload/design',
          filePath: file.tempFilePath,
          name: 'image',
          header,
          success: (up) => {
            wx.hideLoading();
            let body = null;
            try { body = JSON.parse(up.data); } catch (e) { /* 非 JSON 响应 */ }
            if (up.statusCode === 200 && body && body.success && body.data && body.data.url) {
              this.setData({ designImages: this.data.designImages.concat(body.data.url).slice(0, 3) });
            } else {
              wx.showToast({ title: (body && body.error) || '上传失败，请重试', icon: 'none' });
            }
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '网络错误，请重试', icon: 'none' });
          },
        });
      },
    });
  },

  previewDesignImg(e) {
    const url = this.data.designImages[e.currentTarget.dataset.idx];
    if (!url) return;
    wx.previewImage({ current: api.BASE_URL + url, urls: this.data.designImages.map((u) => api.BASE_URL + u) });
  },

  removeDesignImg(e) {
    const idx = e.currentTarget.dataset.idx;
    wx.showModal({
      title: '移除参考图',
      content: '确认移除这张参考图？',
      success: (r) => {
        if (!r.confirm) return;
        const images = this.data.designImages.slice();
        images.splice(idx, 1);
        this.setData({ designImages: images });
      },
    });
  },

  // 跳智能排版工具（仅模板覆盖的品类）：产出设计稿后自动带回本页参考图列表
  goDesignTool() {
    const pv = (this.data.productTypes[this.data.productIndex] || {}).value;
    if (this.data.designToolAvailable) {
      wx.navigateTo({ url: '/pages/design/design?productType=' + pv });
      return;
    }
    // 未覆盖品类也给入口：进工具页看全部模板，换个有模板的品类一样能排版
    wx.navigateTo({ url: '/pages/design/design' });
  },

  // 「已识别」标签重算入口：上面打字、下面手选，任何一侧变化都刷新顶部标签
  refreshTags() {
    this.setData({ parsedTags: this.buildParsedTags(this.parseLocal(this.data.textInput || '')) });
  },

  // 将解析结果 + 手动表单当前值合并为可展示的「已识别」标签
  // （文字里识别到的优先；没写到的字段回落到当前表单选择，保证上下双向联动）
  buildParsedTags(parsed) {
    const d = this.data;
    const tags = [];
    const qty = parsed.quantity || parseInt(d.form.quantity, 10) || 0;
    if (qty) tags.push('数量 ' + qty);
    const productValue = parsed.productType || (d.productTypes[d.productIndex] || {}).value;
    if (productValue) {
      const pt = d.productTypes.find((x) => x.value === productValue);
      if (pt) tags.push(pt.label);
    }
    const matCode = parsed.materialCode || (d.materialOptions[d.materialIndex] || {}).code;
    if (matCode) {
      const m = d.materials.find((x) => x.code === matCode);
      tags.push(m ? m.name : matCode);
    }
    if (parsed.lengthM) {
      const w = parsed.widthM ? Math.round(parsed.widthM * 1000) : '?';
      const h = parsed.heightM ? Math.round(parsed.heightM * 1000) : '?';
      tags.push(`尺寸 ${Math.round(parsed.lengthM * 1000)}×${w}×${h}mm`);
    } else if (d.form.lengthMm && d.form.widthMm) {
      const flat = ['sticker', 'flexiblePackaging', 'antiCounterfeitLabel', 'heatTransfer'];
      tags.push(flat.includes(productValue) || !d.form.heightMm
        ? `尺寸 ${d.form.lengthMm}×${d.form.widthMm}mm`
        : `尺寸 ${d.form.lengthMm}×${d.form.widthMm}×${d.form.heightMm}mm`);
    }
    if (productValue === 'flexiblePackaging') {
      const layers = parsed.filmLayers || d.filmLayerOptions[d.filmLayersIndex];
      if (layers > 1) tags.push(layers + ' 层复合');
    }
    if (productValue === 'cardBox') {
      const boxType = parsed.boxType || d.boxTypes[d.boxTypeIndex].value;
      if (boxType && boxType !== 'normal') {
        const bt = d.boxTypes.find((x) => x.value === boxType);
        if (bt) tags.push(bt.label);
      }
      const nUp = parsed.nUp || parseInt(d.form.nUp, 10) || 1;
      if (nUp > 1) tags.push('拼版 ' + nUp + ' 个/张');
    }
    const procCount = d.processes.filter((p) => p.selected).length;
    if (procCount) tags.push(`工艺 ${procCount} 项`);
    return tags;
  },

  async quickQuote() {
    if (!this.data.textInput.trim()) return wx.showToast({ title: '请输入需求', icon: 'none' });
    const wasAnonymous = !getApp().globalData.userAuth; // Stage12 记录匿名提交，登录后认领
    this.setData({ loading: true });
    try {
      await getApp().ensureLogin();
      // 先本地解析关键词，减少一次网络请求
      const parsed = this.parseLocal(this.data.textInput);
      // 020 文字里识别到专色数量时，联动印刷配置单选为「四色+专色」，保证表单与提交口径一致
      if (parsed.spotColors > 0 && this.data.paramShow.spot) {
        this.setData({ printConfig: 'cmyk+spot', spotColorIndex: Math.min(5, parsed.spotColors - 1) });
      }
      const payload = {
        ...this.buildForm(), ...parsed,
        preferFactoryId: this.data.preferFactoryId || undefined,
        lockedFactoryId: this.data.entryFactoryId || undefined, // F-102 扫码锁定：只推给该厂
      };
      const res = await api.request('/api/c/quote', { method: 'POST', data: payload });
      if (wasAnonymous && res.data && res.data.inquiryId) this.rememberAnonymousInquiry(res.data.inquiryId);
      wx.setStorageSync('lastQuote', res.data);
      this.clearPreferFactory(); // 已随单推送，清除指定状态
      wx.navigateTo({ url: '/pages/result/result' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async submitQuote() {
    const wasAnonymous = !getApp().globalData.userAuth; // Stage12 记录匿名提交，登录后认领
    this.setData({ loading: true });
    try {
      await getApp().ensureLogin();
      const res = await api.request('/api/c/quote', {
        method: 'POST',
        data: {
          ...this.buildForm(),
          preferFactoryId: this.data.preferFactoryId || undefined,
          lockedFactoryId: this.data.entryFactoryId || undefined, // F-102 扫码锁定：只推给该厂
        },
      });
      if (wasAnonymous && res.data && res.data.inquiryId) this.rememberAnonymousInquiry(res.data.inquiryId);
      wx.setStorageSync('lastQuote', res.data);
      this.clearPreferFactory(); // 已随单推送，清除指定状态
      wx.navigateTo({ url: '/pages/result/result' });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  buildForm() {
    const product = this.data.productTypes[this.data.productIndex];
    const material = this.data.materialOptions[this.data.materialIndex];
    const bagType = this.data.bagTypes[this.data.bagTypeIndex];
    const handle = this.data.handleTypes[this.data.handleIndex];
    const processSet = new Set(this.data.processes.filter((p) => p.selected).map((p) => p.code));
    // 袋型/拎手参数自动映射为制袋/拎手工艺码（工厂匹配也感知）
    if (product.value === 'flexiblePackaging' && bagType && bagType.process) processSet.add(bagType.process);
    if ((product.value === 'paperBag' || product.value === 'nonWovenBag') && handle && handle.process) processSet.add(handle.process);
    // 平面类无高度维度
    const flatTypes = ['sticker', 'flexiblePackaging', 'antiCounterfeitLabel', 'heatTransfer'];

    return {
      productType: product.value,
      // 印刷方式按联动配置首选项（软包装凹印/无纺布袋丝印等），配置缺失回退旧默认
      printMode: (this.data.linkConfig[product.value] || {}).printModes?.[0]
        || (product.value === 'flexiblePackaging' ? 'gravure' : 'offset'),
      lengthM: parseFloat(this.data.form.lengthMm) / 1000,
      widthM: parseFloat(this.data.form.widthMm) / 1000,
      heightM: flatTypes.includes(product.value) ? 0 : parseFloat(this.data.form.heightMm) / 1000,
      quantity: parseInt(this.data.form.quantity),
      materialType: material.type,
      materialCode: material.code,
      // 020 印刷配置 → 引擎色数/专色：四色=4色0专色；四色+专色=4色N专色（印工外加专色版费）；
      // 纯专色=N色0专色（专色即印刷色，N 块版 N 色印工，不再重复收专色加价）
      colorCount: this.data.printConfig === 'spot' ? this.data.spotColorIndex + 1 : 4,
      processes: [...processSet],
      // Stage7 扩展参数
      boxType: this.data.boxTypes[this.data.boxTypeIndex].value,
      nUp: parseInt(this.data.form.nUp) || 1,
      filmLayers: this.data.filmLayerOptions[this.data.filmLayersIndex],
      filmCodes: product.value === 'flexiblePackaging' ? [material.code] : undefined,
      // 016/020 印刷参数：图案覆盖率/油墨类型/专色数量；品类隐藏时发中性值（low/NORMAL/0），价格不随隐藏参数波动
      patternCover: this.data.paramShow.pattern ? this.data.patternCoverOptions[this.data.patternCoverIndex].value : 'low',
      inkType: this.data.paramShow.ink ? this.data.inkTypeOptions[this.data.inkTypeIndex].code : 'NORMAL',
      spotColors: this.data.printConfig === 'cmyk+spot' ? this.data.spotColorIndex + 1 : 0,
      // 021 设计需求三态：none=自带稿（传稿图）/ public=工厂公版（只传备注）/ need=需要设计（描述+参考图）
      designStatus: ['none', 'public', 'need'].indexOf(this.data.designMode) >= 0 ? this.data.designMode : 'none',
      designNote: this.data.designMode === 'none' ? '' : this.data.designNote.trim(),
      designImages: this.data.designMode === 'public' ? [] : this.data.designImages,
      designPdfs: this.data.designMode === 'public' ? [] : this.data.designPdfs,
    };
  },

  /**
   * Batch E：把当前填好的表单变成社区帖的「规格」草稿
   * 只搬计价需要的字段（尺寸回 mm）：社区参考价用系统基准价算, 与这里选的工厂无关；
   * 社区页是 tabBar 页带不了 query, 走 storage 一次性语义, 发帖页读完即清。
   */
  shareToCommunity() {
    const product = this.data.productTypes[this.data.productIndex];
    const material = this.data.materialOptions[this.data.materialIndex];
    if (!product || !material) return wx.showToast({ title: '先选好品类与材料', icon: 'none' });
    const f = this.buildForm();
    const spec = {
      productType: product.value,
      printMode: f.printMode,
      lengthMm: Math.round((f.lengthM || 0) * 1000),
      widthMm: Math.round((f.widthM || 0) * 1000),
      heightMm: Math.round((f.heightM || 0) * 1000),
      quantity: f.quantity,
      materialCode: material.code,
      processes: f.processes || [],
    };
    if (!spec.lengthMm || !spec.widthMm || !spec.quantity) {
      return wx.showToast({ title: '先填好尺寸与数量', icon: 'none' });
    }
    wx.setStorageSync('communitySpec', spec);
    wx.switchTab({ url: '/pages/community/community' });
  },

  parseLocal(text) {
    const result = {};
    const qtyMatch = text.match(/([0-9.零一二两三四五六七八九十百千万亿]+)\s*(个|只|张|份|件|套|枚|本)/);
    if (qtyMatch) {
      // "几十万个"这类约数不取（几/数/上/约/近 前缀直接跳过）
      const prevChar = qtyMatch.index > 0 ? text[qtyMatch.index - 1] : '';
      if (!/[几数上约近]/.test(prevChar)) {
        const v = qtyTokenToInt(qtyMatch[1].replace(/\s+/g, ''));
        if (v != null && !isNaN(v)) result.quantity = v;
      }
    }

    const dimMatch = text.match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(?:[×xX*]\s*(\d+(?:\.\d+)?))?\s*(mm|厘米|cm|毫米)?/);
    if (dimMatch) {
      const unit = dimMatch[4];
      const div = (unit === '厘米' || unit === 'cm') ? 100 : 1000;
      result.lengthM = parseFloat(dimMatch[1]) / div;
      result.widthM = parseFloat(dimMatch[2]) / div;
      result.heightM = dimMatch[3] ? parseFloat(dimMatch[3]) / div : 0.15;
    }

    // 软包装层数/彩盒盒型/拼版（与后端 nl-parser 同规则）
    if (/三层|四层|多层/.test(text)) result.filmLayers = 3;
    else if (/双层|二层|两层/.test(text)) result.filmLayers = 2;
    if (/天地盖/.test(text)) result.boxType = 'lidBase';
    else if (/抽屉/.test(text)) result.boxType = 'drawer';
    const nupMatch = text.match(/(?:拼\s*(\d+)|(\d+)\s*拼)/);
    if (nupMatch) result.nUp = parseInt(nupMatch[1] || nupMatch[2], 10);

    // 产品类型词优先（防伪/软包装/无纺布/热转印须排在标签/纸袋等泛词之前）
    let productType;
    if (/防伪标签|防伪/.test(text)) productType = 'antiCounterfeitLabel';
    else if (/软包装|复合袋|胶袋|塑料袋|自立袋|拉链袋/.test(text)) productType = 'flexiblePackaging';
    else if (/热转印|模内贴/.test(text)) productType = 'heatTransfer';
    else if (/无纺布袋|无纺布|环保袋/.test(text)) productType = 'nonWovenBag';
    else if (/纸杯|纸碗|纸罐|纸桶|纸餐盒|纸盘|纸容器/.test(text)) productType = 'paperContainer';
    else if (/手提袋|手挽袋|纸袋|购物袋/.test(text)) productType = 'paperBag';
    else if (/不干胶|标签|贴纸/.test(text)) productType = 'sticker';

    if (/120g牛皮/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'KRAFT120'; }
    else if (/200g牛皮/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'KRAFT200'; }
    else if (/牛皮纸/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'KRAFT300'; }
    else if (/无纺布/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'NW_100'; }
    else if (/热转印膜/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'HTF_FILM'; }
    else if (/合成纸/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'STK_SYNTH'; }
    else if (/热敏/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'STK_THERMAL'; }
    else if (/哑银/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'STK_PETSILVER'; }
    else if (/不干胶/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'STK_COPPER'; }
    else if (/PET/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'STK_PET'; }
    else if (/PP/.test(text)) { result.materialType = 'plasticFilm'; result.materialCode = 'PP_40'; }
    else if (/PE/.test(text)) { result.materialType = 'plasticFilm'; result.materialCode = 'PE_50'; }
    else if (/PLA淋膜|PLA/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'CUP_PLA'; }
    else if (/淋膜|杯纸/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'CUP_PE'; }
    else if (/食品白卡|食品卡/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'FOOD_CARD'; }
    else if (/食品牛皮/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'FOOD_KRAFT'; }
    else if (/白卡/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'CARD250'; }
    else if (/铜版/.test(text)) { result.materialType = 'cardPaper'; result.materialCode = 'COAT200'; }
    else if (/双坑/.test(text)) { result.materialType = 'boardPaper'; result.materialCode = 'B_BC5'; }
    else if (/单坑/.test(text)) { result.materialType = 'boardPaper'; result.materialCode = 'B_B3'; }

    if (productType) {
      result.productType = productType;
      // 软包装语境下 PET 指薄膜不是标签面材
      if (productType === 'flexiblePackaging' && result.materialCode === 'STK_PET') {
        result.materialType = 'plasticFilm';
        result.materialCode = 'PET_35';
      }
      if (!result.materialType) {
        const def = {
          paperBag: ['cardPaper', 'KRAFT300'],
          sticker: ['cardPaper', 'STK_COPPER'],
          flexiblePackaging: ['plasticFilm', 'PP_40'],
          nonWovenBag: ['cardPaper', 'NW_100'],
          antiCounterfeitLabel: ['cardPaper', 'STK_COPPER'],
          paperContainer: ['cardPaper', 'FOOD_CARD'],
          heatTransfer: ['cardPaper', 'HTF_FILM'],
        }[productType];
        if (def) { result.materialType = def[0]; result.materialCode = def[1]; }
      }
    } else if (result.materialType === 'boardPaper') result.productType = 'carton';
    else if (result.materialType === 'plasticFilm') result.productType = 'flexiblePackaging';
    else if (result.materialType === 'cardPaper') result.productType = 'cardBox';

    // 016 油墨类型（与后端 nl-parser 同规则；「UV油墨」须先于工艺词，避免误命中 UV上光）
    if (/uv油墨|uv印刷/i.test(text)) { result.inkType = 'UV'; result._uvInkHit = true; }
    else if (/金属墨|金银墨|金属油墨/.test(text)) result.inkType = 'METALLIC';
    else if (/荧光墨|荧光油墨/.test(text)) result.inkType = 'FLUOR';
    else if (/大豆墨|大豆油墨|环保墨/.test(text)) result.inkType = 'SOY';

    // 016 图案覆盖率：满版/整版 → high；少量图案/以文字为主 → low
    if (/满版|整版|大面积图案|实地印刷/.test(text)) result.patternCover = 'high';
    else if (/少量图案|简单文字|以文字为主|无图案/.test(text)) result.patternCover = 'low';

    // 016 专色数量：专色N / N个专色
    const spotMatch = text.match(/专色\s*(\d+)|(\d+)\s*个\s*专色/);
    if (spotMatch) result.spotColors = Math.min(6, parseInt(spotMatch[1] || spotMatch[2], 10) || 0);

    // ===== 028：工艺识别——动态下发的清单先匹配（最长名优先、记录区间），硬编码别名随后；
    // 落在长名区间内的别名跳过（「雕花压纹」只认新工艺，不连带「压纹」→ 后端白名单拒绝会整单 400）
    const processes = [];
    const spans = [];
    const dynBase = this._allProcesses || this.data.processes;
    const uvInkCtx = /uv油墨|uv印刷/i.test(text);
    (dynBase || []).slice()
      .sort((a, b) => String(b.name || '').length - String(a.name || '').length)
      .forEach((p) => {
        const nm = String(p.name || '');
        if (nm.length < 2) return;
        const idx = text.indexOf(nm);
        if (idx < 0 || spans.some(([s, e]) => idx >= s && idx + nm.length <= e)) return;
        if (uvInkCtx && nm.toLowerCase().indexOf('uv') >= 0) return;
        if (!processes.includes(p.code)) processes.push(p.code);
        spans.push([idx, idx + nm.length]);
      });
    const hit = (kw) => {
      const idx = text.indexOf(kw);
      return idx >= 0 && !spans.some(([s, e]) => idx >= s && idx + kw.length <= e);
    };
    if (hit('覆哑膜')) processes.push('MATTE_FILM');
    else if (hit('覆膜')) processes.push('MATTE_FILM');
    if (hit('覆光膜')) processes.push('GLOSS_FILM');
    // 「UV油墨」语境下剔除误命中的 UV上光工艺（与后端 nl-parser 同规则）
    if (hit('烫金')) processes.push('HOT_STAMP');
    if (hit('UV') || hit('uv')) processes.push('UV_COAT');
    if (hit('粘箱')) processes.push('GLUE_BOX');
    if (hit('模切')) processes.push('DIE_CUT');
    if (hit('穿绳') || hit('打扣')) processes.push('ROPE');
    if (hit('棉绳')) processes.push('ROPE_COTTON');
    if (hit('塑料扣')) processes.push('CLASP');
    if (hit('车缝') || hit('缝纫')) processes.push('SEWING');
    if (hit('复合')) processes.push('LAMINATE');
    if (hit('三边封')) processes.push('BAG_3SEAL');
    else if (hit('中封')) processes.push('BAG_CENTER');
    if (hit('自立袋')) processes.push('BAG_STAND');
    if (hit('拉链')) processes.push('BAG_ZIP');
    if (hit('激光')) processes.push('LASER_AF');
    if (hit('刮刮')) processes.push('SCRATCH');
    if (hit('荧光')) processes.push('FLUOR');
    if (hit('揭开留底')) processes.push('VOID_AF');
    if (hit('溯源') || hit('二维码')) processes.push('TRACE_QR');
    if (hit('折页')) processes.push('FOLD');
    if (hit('骑马订')) processes.push('SADDLE');
    // 纸容器工艺（须在品类白名单内，后端 validateInput 严格校验，勿加泛词）
    if (hit('杯成型')) processes.push('CUP_FORMING');
    if (hit('卷边')) processes.push('RIM_ROLLING');
    if (hit('底封')) processes.push('BOTTOM_SEAL');
    if (hit('卷管')) processes.push('TUBE_WINDING');
    if (hit('贴标')) processes.push('LABELING');
    if (result._uvInkHit) {
      const i = processes.indexOf('UV_COAT');
      if (i >= 0) processes.splice(i, 1);
      delete result._uvInkHit;
    }

    if (processes.length) result.processes = processes;

    return result;
  },
});
