const api = require('../../utils/api');
const { getAvatarConfig } = require('../../utils/avatar');

Page({
  data: {
    // Stage11 自定义导航栏高度（onLoad 计算）
    statusBarHeight: 20,
    navBarHeight: 44,
    // Stage12 默认选中「纸箱」：进页面即按纸箱能力过滤工厂与工艺
    filter: { productType: 'carton', printMode: '', process: [] },
    // Stage9 品类联动配置（/api/c/config 下发；空对象=不联动，容错）
    linkConfig: {},
    // Stage11 筛选全量展开：产品 10 类 + 常用工艺（与后台能力配置同源）
    productOptions: [
      { code: '', name: '全部' },
      { code: 'carton', name: '纸箱' },
      { code: 'cardBox', name: '彩盒' },
      { code: 'card', name: '卡片' },
      { code: 'paperBag', name: '纸袋' },
      { code: 'sticker', name: '不干胶' },
      { code: 'flexiblePackaging', name: '软包装' },
      { code: 'nonWovenBag', name: '无纺布袋' },
      { code: 'antiCounterfeitLabel', name: '防伪标签' },
      { code: 'heatTransfer', name: '热转印' },
      { code: 'paperContainer', name: '纸容器' },
    ],
    // 名称/地址关键词搜索（与能力筛选叠加生效）
    keyword: '',
    // F-100 排序：综合（缺省）/ 评分 / 接单量 / 响应速度 / 产能优先
    sort: '',
    sortOptions: [
      { code: '', name: '综合' },
      { code: 'capacity', name: '产能空闲' },
      { code: 'rating', name: '评分高' },
      { code: 'accepts', name: '接单多' },
      { code: 'response', name: '响应快' },
    ],
    factoriesLoading: false,
    // 全量工艺池；processOptions 为当前品类过滤后的展示项
    allProcessOptions: [
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
      // 纸容器工艺（与 product_config.paperContainer 白名单一致）
      { code: 'CUP_FORMING', name: '杯成型' },
      { code: 'RIM_ROLLING', name: '卷边' },
      { code: 'BOTTOM_SEAL', name: '底封' },
      { code: 'TUBE_WINDING', name: '卷管' },
      { code: 'LABELING',    name: '贴标' },
      { code: 'ASSEMBLY',    name: '组装' },
      { code: 'LINING',      name: '内衬' },
    ],
    processOptions: [], // 由 applyLinkage 按当前品类填充（配置到达前为空）
    factories: [],
  },

  onLoad() {
    // Stage11 自定义导航栏：状态栏高度 + 与右上角胶囊对齐的导航栏高度
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
    // Stage12 拉取品类联动配置（工艺白名单），到达后按当前品类（默认纸箱）收窄工艺展示
    api.request('/api/c/config').then((res) => {
      this.setData({ linkConfig: (res && res.data && res.data.productConfig) || {} });
      this.applyLinkage(this.data.filter.productType);
    }).catch(() => this.applyLinkage(this.data.filter.productType));
  },

  onShow() {
    this.loadFactories();
    this.syncTabBar();
  },

  // 自定义 tabBar：同步当前选中项
  syncTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().syncRole();
      this.getTabBar().selectByPath('/pages/factories/factories');
      this.getTabBar().updateBadge();
    }
  },

  setFilter(e) {
    const { type, code } = e.currentTarget.dataset;
    if (type === 'process') {
      const list = this.data.filter.process;
      const i = list.indexOf(code);
      if (i >= 0) list.splice(i, 1);
      else list.push(code);
      // 数据驱动选中态：预计算 selected 标记，避免模板内 indexOf 判定失效
      this.syncProcessSelected([...list]);
    } else {
      // Stage12 产品联动：切换品类时收窄工艺可选项，并剔除不再适用的已选工艺
      this.setData({ [`filter.${type}`]: code });
      if (type === 'productType') this.applyLinkage(code);
    }
    this.loadFactories();
  },

  // 同步工艺选中标记（数据驱动，wxml 直接读 item.selected）
  syncProcessSelected(selected) {
    this.setData({
      'filter.process': selected,
      processOptions: this.data.processOptions.map((p) => ({ ...p, selected: selected.includes(p.code) })),
    });
  },

  // Stage12 品类联动：选具体品类时工艺只展示该品类白名单内项；「全部」展示全量
  applyLinkage(productType) {
    const all = this.data.allProcessOptions;
    const cfg = this.data.linkConfig[productType];
    const cur = this.data.filter.process;
    if (!productType || !cfg || !cfg.processes || !cfg.processes.length) {
      this.setData({ processOptions: all.map((p) => ({ ...p, selected: cur.includes(p.code) })) });
      return;
    }
    const allowSet = new Set(cfg.processes);
    const kept = cur.filter((c) => allowSet.has(c));
    this.setData({
      processOptions: all.filter((p) => allowSet.has(p.code)).map((p) => ({ ...p, selected: kept.includes(p.code) })),
      'filter.process': kept,
    });
  },

  // 名称搜索输入（与筛选条件叠加，直接触发查询）
  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    this.loadFactories();
  },

  // F-100：切换排序（综合/评分/接单量/响应速度）
  setSort(e) {
    this.setData({ sort: e.currentTarget.dataset.code });
    this.loadFactories();
  },

  // 清除搜索关键词
  clearKeyword() {
    this.setData({ keyword: '' });
    this.loadFactories();
  },

  async loadFactories() {
    const f = this.data.filter;
    const params = [];
    if (f.productType) params.push('productType=' + f.productType);
    if (f.printMode)   params.push('printMode=' + f.printMode);
    if (f.process.length) params.push('process=' + f.process.join(','));
    if (this.data.keyword && this.data.keyword.trim()) {
      params.push('keyword=' + encodeURIComponent(this.data.keyword.trim()));
    }
    if (this.data.sort) params.push('sort=' + this.data.sort);

    this.setData({ factoriesLoading: true });
    try {
      const res = await api.request('/api/factory/list?' + params.join('&'));
      // Stage10 中文名由后端随列表下发（product_config / finishing 目录），无需前端写死映射
      const names = (res.data && res.data.names) || { productType: {}, process: {} };
      const list = res.data.list.map((x) => {
        const avatar = getAvatarConfig(x.name);
        return {
          ...x,
          avatarText: avatar.text,
          avatarColor: avatar.color,
          // F-100：评分/接单量/响应时长格式化（列表徽标展示）
          ratingText: x.rating ? Number(x.rating).toFixed(1) : '',
          acceptsText: x.total_accepts ? x.total_accepts + ' 单' : '',
          // 印查查式：已核验 + 产能状态（后端 capacityStatus 为 idle/normal/busy 才展示）
          verified: !!x.verified,
          capacityLabel: x.capacityStatus && x.capacityStatus !== 'unknown' ? x.capacityLabel : '',
          capacityStatus: x.capacityStatus || '',
          capNameList: [
            ...x.capabilities.productType.map((c) => names.productType[c] || c),
            ...x.capabilities.process.slice(0, 3).map((c) => names.process[c] || c),
          ],
        };
      });
      this.setData({ factories: list });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ factoriesLoading: false });
    }
  },

  // 点击工厂头部 → 工厂详情页（介绍/能力/联系方式）
  goFactoryDetail(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/factory-detail/factory-detail?id=' + id });
  },

  quickQuote(e) {
    const item = this.data.factories.find((x) => x.id === e.currentTarget.dataset.id);
    wx.setStorageSync('preferFactoryId', e.currentTarget.dataset.id);
    wx.setStorageSync('preferFactoryName', item ? item.name : '');
    wx.switchTab({ url: '/pages/quote/quote' });
  },
});