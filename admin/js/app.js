const { createApp, reactive, computed, onMounted, toRefs, watch  } = Vue;

const app = createApp({
  setup() {
    const state = reactive({
      page: 'dashboard',
      currentFactoryId: 0,
      factories: [],
      catalog: { rawPaper: {}, boardPaper: {}, cardPaper: {}, plasticFilm: {}, plateType: {}, printingRate: {}, finishing: {} },
      // Stage10 目录维护页数据源：含停用行（/api/catalog?all=1），与报价链路用的 catalog 分离
      catalogAll: {},
      quotes: [],
      inquiries: [],
      customers: [],
      orders: [],
      orderFilter: '',
      stats: {},
      activeFactory: null,
      activeOverrides: {},
      newOverride: { targetType: 'boardPaper', targetCode: '', fieldName: 'price_per_sqm', fieldValue: 0 },
      // stage14 工厂邀请码弹窗（小程序「我是工厂」绑定入口）
      inviteCodeModal: { open: false, factoryId: 0, factoryName: '', list: [] },
      calcForm: {
        productType: 'carton',
        printMode: 'offset',
        lengthMm: 300,
        widthMm: 200,
        heightMm: 150,
        quantity: 1000,
        materialCode: 'B_BC5',
        colorCount: 4,
        processes: [],
        // Stage7：盒型/拼版/软包装层数与固定费
        boxType: 'normal',
        nUp: 1,
        filmLayers: 1,
        moldFee: 0,
        knifeFee: 0,
        // 016 印刷参数：图案覆盖率/油墨类型/专色数量
        patternCover: 'mid',
        inkType: 'NORMAL',
        spotColors: 0,
        // 020 印刷配置：色数与专色合并单选（与小程序同口径）
        printConfig: 'cmyk',
        // 025 客户折扣：0=不关联客户按牌价；>0 按客户档案折扣比例计价
        customerId: 0,
      },
      calcResult: null,
      calculating: false,
      currentUser: null,
      adminUsers: [],
      // Stage13 物流履约：运费模板 / 发货弹窗 / 物流查看
      shippingTemplates: [],
      shipModal: { open: false, orderId: null, orderNo: '', form: { expressCompany: '', expressNo: '' } },
      logisticsViewer: { open: false, loading: false, orderNo: '', logistics: null, traces: [], configured: true },
      shippingEditor: {
        open: false,
        form: { id: null, name: '', mode: 'fixed', firstWeightKg: 1, firstFee: 0, extraWeightKg: 1, extraFee: 0, pieceFee: 0, fixedFee: 0, freeThreshold: 0, isDefault: false },
      },
      // ===== stage14 SaaS 工厂视图 =====
      isFactoryMode: false,
      factoryAuth: null,
      factoryPricing: { defaultMargin: 0, defaultTaxRate: 0, defaultWasteRate: 0, overrides: {} },
      factoryCatalogOpts: {},
      pricingForm: { defaultMargin: 0, defaultTaxRate: 0, defaultWasteRate: 0 },
      factoryNewOverride: { targetType: 'boardPaper', targetCode: '', fieldName: 'price_per_sqm', fieldValue: 0 },
      // stage14 列表搜索关键词（与状态过滤叠加；工厂模式为本地过滤）
      orderKeyword: '',
      quoteKeyword: '',
      inquiryKeyword: '',
      customerKeyword: '',
      // ===== F-148/150 在线设备（管理端） =====
      sessions: [],
      sessionsLoading: false,
      sessionUserType: '',
      sessionKeyword: '',
      // ===== F-57 服务费台账（管理端） =====
      feeLedger: [],
      feeLedgerTotal: 0,
      feeLedgerSum: 0,
      feeLedgerStatus: '',
      feeLedgerLoading: false,
      // ===== F-158 工厂员工操作日志弹窗（管理端从工厂列表进入） =====
      opLogModal: { open: false, factoryId: 0, factoryName: '', list: [], loading: false, username: '', action: '' },
      // ===== 027 设备图文审核弹窗（管理端从工厂列表进入：图集 + 通过/驳回） =====
      mediaModal: { open: false, factoryId: 0, factoryName: '', list: [], loading: false },
      // ===== stage15 侧边栏收起状态（localStorage 记忆，默认展开） =====
      sidebarCollapsed: (() => {
        try { return localStorage.getItem('admin_sidebar_collapsed') === '1'; } catch (e) { return false; }
      })(),
      // ===== stage15c 多标签页工作区 + 侧边栏分组折叠 =====
      // tabs：已打开的页面 key（点菜单加入，可切换/关闭，页面 DOM 保留状态）
      tabs: ['dashboard'],
      // collapsedGroups：{ '业务': true } 记录被收起的分组（localStorage 记忆）
      collapsedGroups: (() => {
        try { return JSON.parse(localStorage.getItem('admin_nav_collapsed_groups') || '{}') || {}; } catch (e) { return {}; }
      })(),
      // ===== stage16 业务列表分页 + 计价工厂搜索选择器 + 目录页分组标签 =====
      quotePage: 1, quoteTotal: 0,
      orderPage: 1, orderTotal: 0,
      inquiryPage: 1, inquiryTotal: 0,
      customerPage: 1, customerTotal: 0,
      factoryPickerOpen: false,
      factoryKeyword: '',
      catalogTab: 'all',
    });

    // ===== F-167/168 配置驱动菜单（文档 11.2）=====
    // mode: admin=仅管理端 / factory=仅工厂端 / both=双端（工厂端标题取 factoryTitle）
    // perm: 可见所需权限点（登录返回的 permissions / admin-me 的 perms 判定）；soon: 置灰待上线（财务对账=阶段三、工厂计算器=阶段四）
    // stage15：图标改用统一线性 SVG（stroke 风格），菜单按 group 分组渲染
    const NAV_ICONS = {
      grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
      calculator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M8 7h8"/><path d="M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/></svg>',
      file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>',
      inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z"/></svg>',
      box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
      tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/></svg>',
      card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>',
      banknote: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>',
      users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
      truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.6a1 1 0 0 0-.2-.6l-3.5-4.4A1 1 0 0 0 17.5 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>',
      factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1M12 18h1M7 18h1"/></svg>',
      user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
      database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
      shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
      monitor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    };

    const NAV_GROUPS = ['概览', '业务', '管理', '系统'];
    const NAV_MENU = [
      { key: 'dashboard', title: '数据概览', factoryTitle: '我的数据', group: '概览', svg: NAV_ICONS.grid, mode: 'both', perm: 'dashboard:view' },
      { key: 'calculator', title: '报价计算器', group: '业务', svg: NAV_ICONS.calculator, mode: 'both', perm: 'calculator:use' },
      { key: 'quotes', title: '报价单', factoryTitle: '我的报价单', group: '业务', svg: NAV_ICONS.file, mode: 'both', perm: 'quote:view' },
      { key: 'inquiries', title: 'C端询价', factoryTitle: '我的询价', group: '业务', svg: NAV_ICONS.inbox, mode: 'both', perm: 'inquiry:view' },
      { key: 'orders', title: '订单管理', factoryTitle: '我的订单', group: '业务', svg: NAV_ICONS.box, mode: 'both', perm: 'order:view' },
      { key: 'finance', title: '财务对账', group: '业务', svg: NAV_ICONS.card, mode: 'factory', perm: 'finance:view', soon: true },
      { key: 'pricing', title: '价格设置', group: '管理', svg: NAV_ICONS.tag, mode: 'factory', perm: 'price:edit' },
      { key: 'staff', title: '员工管理', group: '管理', svg: NAV_ICONS.users, mode: 'factory', perm: 'staff:manage' },
      { key: 'shipping', title: '运费模板', group: '管理', svg: NAV_ICONS.truck, mode: 'admin', perm: 'shipping:manage' },
      { key: 'factories', title: '工厂管理', group: '管理', svg: NAV_ICONS.factory, mode: 'admin', perm: 'factory:manage' },
      { key: 'customers', title: '客户管理', group: '管理', svg: NAV_ICONS.user, mode: 'both', perm: 'customer:manage' },
      { key: 'catalog', title: '目录数据', group: '管理', svg: NAV_ICONS.database, mode: 'admin', perm: 'catalog:view' },
      { key: 'accounts', title: '账户管理', group: '系统', svg: NAV_ICONS.shield, mode: 'admin', perm: 'account:manage' },
      { key: 'sessions', title: '在线设备', group: '系统', svg: NAV_ICONS.monitor, mode: 'admin', perm: 'session:view' },
      { key: 'fee-ledger', title: '服务费台账', group: '系统', svg: NAV_ICONS.banknote, mode: 'admin', perm: 'finance:view' },
    ];

    // F-165 权限判定：工厂端看 factoryAuth.permissions；管理端看 admin-me 的 perms（角色映射兜底）
    function hasPerm(perm) {
      if (!perm) return true;
      if (state.isFactoryMode) {
        const auth = state.factoryAuth || {};
        if (Array.isArray(auth.permissions)) return auth.permissions.includes(perm);
        return auth.role ? auth.role === 'owner' : true; // 旧会话无 permissions 时按 owner 兜底
      }
      const me = state.currentUser || {};
      if (Array.isArray(me.perms)) return me.perms.includes(perm);
      const role = me.role || 'admin';
      if (role === 'super') return true;
      return perm !== 'account:manage'; // admin 角色唯一缺口
    }

    function menuTitle(item) {
      return state.isFactoryMode ? (item.factoryTitle || item.title) : item.title;
    }

    const visibleMenu = computed(() => NAV_MENU.filter((item) => {
      if (state.isFactoryMode ? item.mode === 'admin' : item.mode === 'factory') return false;
      return hasPerm(item.perm);
    }));

    // stage15：按 NAV_GROUPS 顺序聚合成"分组 -> 菜单项"，空分组不渲染
    const menuGroups = computed(() => NAV_GROUPS
      .map((label) => ({ label, items: visibleMenu.value.filter((item) => item.group === label) }))
      .filter((g) => g.items.length > 0));

    // stage15 侧边栏收起/展开（左上角按钮触发，localStorage 记忆）
    function toggleSidebar() {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      try { localStorage.setItem('admin_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    }

    const pageTitle = computed(() => ({
      dashboard: state.isFactoryMode ? '我的数据' : '数据概览',
      calculator: '报价计算器',
      quotes: state.isFactoryMode ? '我的报价单' : '报价单',
      inquiries: state.isFactoryMode ? '我的询价' : 'C端询价',
      orders: state.isFactoryMode ? '我的订单' : '订单管理',
      pricing: '价格设置',
      finance: '财务对账',
      staff: '员工管理',
      factories: '工厂管理',
      customers: '客户管理',
      catalog: '目录数据',
      shipping: '运费模板',
      accounts: '账户管理',
      sessions: '在线设备',
      'fee-ledger': '服务费台账',
    })[state.page]);

    const materialCount = computed(() =>
      Object.keys(state.catalog.rawPaper).length +
      Object.keys(state.catalog.boardPaper).length +
      Object.keys(state.catalog.cardPaper).length +
      Object.keys(state.catalog.plasticFilm || {}).length
    );

    const recentQuotes = computed(() => state.quotes.slice(0, 8));

    // ===== 订单：状态文案 / 徽章颜色 / 操作按钮 =====
    const ORDER_STATUS_TEXT = {
      pending: '待确认', confirmed: '已确认', sampling: '打样中', sample_confirmed: '样品已确认',
      producing: '生产中', shipped: '已发货', completed: '已完成', cancelled: '已取消',
    };
    const ORDER_STATUS_STYLE = {
      pending:   'background:#fef3c7;color:#b45309',
      confirmed: 'background:#dbeafe;color:#1d4ed8',
      sampling:  'background:#fce7f3;color:#be185d',
      sample_confirmed: 'background:#d1fae5;color:#047857',
      producing: 'background:#e0e7ff;color:#4338ca',
      shipped:   'background:#cffafe;color:#0e7490',
      completed: 'background:#dcfce7;color:#15803d',
      cancelled: 'background:#fee2e2;color:#dc2626',
    };
    // 管理端可执行的兜底操作（状态机约束仍由后端把关）
    // P1-9 打样流：confirmed 可寄样（→sampling，等待客户确认样品）；sample_confirmed 后才能开始生产
    const ORDER_ACTIONS = {
      pending:   [{ action: 'confirm',  label: '确认' }, { action: 'cancel', label: '取消' }],
      confirmed: [{ action: 'produce',  label: '开始生产' }, { action: 'sendSample', label: '寄样' }, { action: 'cancel', label: '取消' }],
      sampling:  [],   // 客户确认样品（confirmSample）是用户侧动作，工厂/管理端仅查看
      sample_confirmed: [{ action: 'produce', label: '开始生产' }],
      producing: [{ action: 'ship',     label: '发货' }],
      shipped:   [{ action: 'complete', label: '完成' }],
      completed: [],
      cancelled: [],
    };

    function orderStatusLabel(s) { return ORDER_STATUS_TEXT[s] || s; }
    function orderStatusStyle(s) { return ORDER_STATUS_STYLE[s] || ''; }
    function orderActions(o) { return ORDER_ACTIONS[o.status] || []; }

    // ===== 数据看板：趋势 / 状态分布 =====
    const ORDER_STATUS_KEYS = ['pending', 'confirmed', 'sampling', 'sample_confirmed', 'producing', 'shipped', 'completed', 'cancelled'];
    const DIST_COLORS = {
      pending: '#f59e0b', confirmed: '#3b82f6', sampling: '#ec4899', sample_confirmed: '#10b981',
      producing: '#6366f1', shipped: '#06b6d4', completed: '#22c55e', cancelled: '#ef4444',
    };
    const recentOrders = computed(() => state.orders.slice(0, 5));
    const trendMax = computed(() => {
      const t = state.stats.trend || [];
      return Math.max(1, ...t.map((d) => Math.max(d.inquiries, d.orders)));
    });

    function formatMoney(v) {
      const n = Number(v) || 0;
      return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function barHeight(v) {
      const n = Number(v) || 0;
      if (!n) return '0%';
      return Math.max(6, Math.round((n / trendMax.value) * 100)) + '%';
    }

    function distPct(s) {
      const total = state.stats.orderTotal || 0;
      const n = (state.stats.orderStatus || {})[s] || 0;
      if (!total || !n) return '0%';
      return Math.max(4, Math.round((n / total) * 100)) + '%';
    }

    function distColor(s) { return DIST_COLORS[s] || '#94a3b8'; }

    const filteredOrders = computed(() => {
      // stage16：管理端的订单状态筛选/关键词搜索已走后端分页，这里原样返回当前页；
      // 工厂模式仍是一次性加载本厂订单，保持本地过滤（含状态与关键词）
      if (!state.isFactoryMode) return state.orders;
      let list = state.orderFilter
        ? state.orders.filter((o) => o.status === state.orderFilter)
        : state.orders;
      if (state.orderKeyword) {
        const k = state.orderKeyword.toLowerCase();
        list = list.filter((o) =>
          (o.order_no || '').toLowerCase().includes(k) ||
          (o.contact_name || '').toLowerCase().includes(k) ||
          (o.contact_phone || '').toLowerCase().includes(k)
        );
      }
      return list;
    });

    // ===== stage16 列表分页加载（后端 page/pageSize；搜索/筛选变化回到第 1 页，每页 20 条） =====
    const LIST_PAGE_SIZE = 20;
    async function loadQuotesPage(page) {
      try {
        const res = await api.quoteList({
          page: page || 1, pageSize: LIST_PAGE_SIZE,
          keyword: state.quoteKeyword || undefined,
        });
        state.quotes = res.list || [];
        state.quoteTotal = res.total || 0;
        state.quotePage = res.page || page || 1;
      } catch (err) {
        if (err.code !== 401) alert('加载失败：' + err.message);
      }
    }
    async function loadOrdersPage(page) {
      if (state.isFactoryMode) return; // 工厂模式走 loadFactoryData，本地过滤不分页
      try {
        const res = await api.orderList({
          page: page || 1, pageSize: LIST_PAGE_SIZE,
          status: state.orderFilter || undefined,
          keyword: state.orderKeyword || undefined,
        });
        state.orders = res.list || [];
        state.orderTotal = res.total || 0;
        state.orderPage = res.page || page || 1;
      } catch (err) {
        if (err.code !== 401) alert('加载失败：' + err.message);
      }
    }
    async function loadInquiriesPage(page) {
      try {
        const res = await api.cInquiryList({
          page: page || 1, pageSize: LIST_PAGE_SIZE,
          keyword: state.inquiryKeyword || undefined,
        });
        state.inquiries = res.list || [];
        state.inquiryTotal = res.total || 0;
        state.inquiryPage = res.page || page || 1;
      } catch (err) {
        if (err.code !== 401) alert('加载失败：' + err.message);
      }
    }
    async function loadCustomersPage(page) {
      try {
        const res = await api.customers({
          page: page || 1, pageSize: LIST_PAGE_SIZE,
          keyword: state.customerKeyword || undefined,
        });
        state.customers = res.list || [];
        state.customerTotal = res.total || 0;
        state.customerPage = res.page || page || 1;
      } catch (err) {
        if (err.code !== 401) alert('加载失败：' + err.message);
      }
    }
    const quotePages = computed(() => Math.max(1, Math.ceil(state.quoteTotal / LIST_PAGE_SIZE)));
    const orderPages = computed(() => Math.max(1, Math.ceil(state.orderTotal / LIST_PAGE_SIZE)));
    const inquiryPages = computed(() => Math.max(1, Math.ceil(state.inquiryTotal / LIST_PAGE_SIZE)));
    const customerPages = computed(() => Math.max(1, Math.ceil(state.customerTotal / LIST_PAGE_SIZE)));

    // ===== stage14 列表搜索（防抖 300ms；工厂模式的订单搜索为本地过滤即时生效） =====
    const searchTimers = {};
    function debounceSearch(key, fn) {
      clearTimeout(searchTimers[key]);
      searchTimers[key] = setTimeout(fn, 300);
    }
    function onOrderSearch() {
      if (state.isFactoryMode) return; // 本地过滤，无需请求
      debounceSearch('order', () => loadOrdersPage(1));
    }
    function onOrderFilterChange() { loadOrdersPage(1); }
    function onQuoteSearch() { debounceSearch('quote', () => loadQuotesPage(1)); }
    function onInquirySearch() { debounceSearch('inquiry', () => loadInquiriesPage(1)); }
    function onCustomerSearch() { debounceSearch('customer', () => loadCustomersPage(1)); }

    // ===== Stage13 物流履约：发货弹窗 / 物流查看 / 运费模板 =====
    const EXPRESS_COMPANIES = [
      { code: 'SF', name: '顺丰速运' }, { code: 'ZTO', name: '中通快递' },
      { code: 'YTO', name: '圆通速递' }, { code: 'STO', name: '申通快递' },
      { code: 'YD', name: '韵达快递' }, { code: 'EMS', name: '邮政EMS' },
      { code: 'JD', name: '京东物流' }, { code: 'JTSD', name: '极兔速递' },
      { code: 'DBWL', name: '德邦物流' }, { code: 'OTHER', name: '其他快递' },
    ];
    const SHIPPING_MODE_TEXT = { weight: '按重量', piece: '按件数', fixed: '固定运费' };

    function openShipModal(o) {
      state.shipModal.orderId = o.id;
      state.shipModal.orderNo = o.order_no;
      state.shipModal.form = { expressCompany: '', expressNo: '' };
      state.shipModal.open = true;
    }

    async function submitShip() {
      const f = state.shipModal.form;
      if (!f.expressCompany) return alert('请选择快递公司');
      if (!f.expressNo || !f.expressNo.trim()) return alert('请填写快递单号');
      try {
        // stage14：工厂视图走工厂状态接口（requireFactory 鉴权 + 本厂归属校验）
        if (state.isFactoryMode) {
          await api.factoryOrderStatus(state.shipModal.orderId, 'ship', {
            expressCompany: f.expressCompany, expressNo: f.expressNo.trim(),
          });
          state.shipModal.open = false;
          await loadFactoryData();
          return;
        }
        await api.updateOrderStatus(state.shipModal.orderId, 'ship', {
          expressCompany: f.expressCompany, expressNo: f.expressNo.trim(),
        });
        state.shipModal.open = false;
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert('发货失败：' + err.message);
      }
    }

    async function openLogisticsViewer(o) {
      state.logisticsViewer = { open: true, loading: true, orderNo: o.order_no, logistics: null, traces: [], configured: true };
      try {
        // stage14：工厂视图查本厂订单物流
        const data = state.isFactoryMode
          ? await api.factoryOrderLogistics(o.id)
          : await api.request('/api/c/admin/order/' + o.id + '/logistics');
        state.logisticsViewer.logistics = data.logistics;
        state.logisticsViewer.traces = data.traces || [];
        state.logisticsViewer.configured = data.configured !== false;
      } catch (err) {
        if (err.code !== 401) alert('物流查询失败：' + err.message);
        state.logisticsViewer.open = false;
      } finally {
        state.logisticsViewer.loading = false;
      }
    }

    function shippingRuleText(t) {
      if (t.mode === 'weight') {
        return '首重 ' + t.first_weight_kg + 'kg ¥' + t.first_fee +
          '，续重每 ' + t.extra_weight_kg + 'kg ¥' + t.extra_fee;
      }
      if (t.mode === 'piece') return '每件 ¥' + t.piece_fee;
      return '固定 ¥' + t.fixed_fee;
    }

    async function loadShippingTemplates() {
      try {
        const data = await api.shippingTemplates();
        state.shippingTemplates = data.list || [];
      } catch (err) {
        if (err.code !== 401) alert('运费模板加载失败：' + err.message);
      }
    }

    function openShippingEditor(t) {
      state.shippingEditor.form = t ? {
        id: t.id, name: t.name, mode: t.mode,
        firstWeightKg: Number(t.first_weight_kg), firstFee: Number(t.first_fee),
        extraWeightKg: Number(t.extra_weight_kg), extraFee: Number(t.extra_fee),
        pieceFee: Number(t.piece_fee), fixedFee: Number(t.fixed_fee),
        freeThreshold: Number(t.free_threshold), isDefault: !!t.is_default,
      } : {
        id: null, name: '', mode: 'fixed', firstWeightKg: 1, firstFee: 0,
        extraWeightKg: 1, extraFee: 0, pieceFee: 0, fixedFee: 0, freeThreshold: 0, isDefault: false,
      };
      state.shippingEditor.open = true;
    }

    async function saveShipping() {
      const f = state.shippingEditor.form;
      if (!f.name || !f.name.trim()) return alert('请填写模板名称');
      try {
        await api.saveShippingTemplate(f);
        state.shippingEditor.open = false;
        await loadShippingTemplates();
      } catch (err) {
        if (err.code !== 401) alert('保存失败：' + err.message);
      }
    }

    async function toggleShipping(t) {
      try {
        await api.toggleShippingTemplate(t.id, !t.is_active);
        await loadShippingTemplates();
      } catch (err) {
        if (err.code !== 401) alert('操作失败：' + err.message);
      }
    }

    async function setDefaultShipping(t) {
      try {
        await api.saveShippingTemplate({ id: t.id, name: t.name, mode: t.mode, isDefault: true });
        await loadShippingTemplates();
      } catch (err) {
        if (err.code !== 401) alert('设置失败：' + err.message);
      }
    }

    async function adminOrderAction(o, action) {
      const labels = { confirm: '确认订单', produce: '开始生产', ship: '发货', complete: '完成', cancel: '取消订单', sendSample: '寄样' };
      try {
        if (action === 'confirm') {
          // stage13：确认订单时可填货物重量（默认模板为按重计费时必填，后端校验）
          const weight = await ui.prompt(
            `确认订单「${o.order_no}」？\n按重计费模板需填写货物重量（kg），其他模板可留空直接确认：`, ''
          );
          if (weight === null) return;
          // P1-9：可同时设定打样费（元，随首款一并收取；不打样留空）
          const sampleFee = await ui.prompt('打样费（元，随首款一并收取；不打样请留空或填 0）：', '');
          if (sampleFee === null) return;
          const extra = {};
          if (weight && weight.trim()) extra.weightKg = weight.trim();
          if (sampleFee && sampleFee.trim()) {
            if (!(Number(sampleFee.trim()) >= 0)) return alert('打样费需为不小于 0 的数字');
            extra.sampleFee = sampleFee.trim();
          }
          await api.updateOrderStatus(o.id, 'confirm', extra);
        } else if (action === 'ship') {
          openShipModal(o);
          return;
        } else {
          if (action === 'cancel' && !(await ui.confirm(`确认取消订单「${o.order_no}」？已支付订单将进入待退款（需管理端确认退款）。`))) return;
          if (action === 'complete' && !(await ui.confirm(`确认完成订单「${o.order_no}」？`))) return;
          if (action === 'sendSample' && !(await ui.confirm(`确认订单「${o.order_no}」样品已寄出？订单将进入打样中，等待客户确认样品。`))) return;
          if (action === 'produce' && o.pay_status !== 'paid'
              && !(await ui.confirm('订单尚未支付。admin 为平台兜底可跳过支付限制，确认继续开始生产？'))) return;
          await api.updateOrderStatus(o.id, action);
        }
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert(labels[action] + '失败：' + err.message);
      }
    }

    // ===== stage14 SaaS 工厂视图：订单操作（复用状态机组件，请求头换工厂身份） =====
    async function factoryOrderAction(o, action) {
      const labels = { confirm: '确认订单', produce: '开始生产', ship: '发货', complete: '完成', cancel: '取消订单', sendSample: '寄样' };
      try {
        if (action === 'confirm') {
          const weight = await ui.prompt(
            `确认订单「${o.order_no}」？\n按重计费模板需填写货物重量（kg），其他模板可留空直接确认：`, ''
          );
          if (weight === null) return;
          // P1-9：可同时设定打样费（元，随首款一并收取；不打样留空）
          const sampleFee = await ui.prompt('打样费（元，随首款一并收取；不打样请留空或填 0）：', '');
          if (sampleFee === null) return;
          const extra = {};
          if (weight && weight.trim()) extra.weightKg = weight.trim();
          if (sampleFee && sampleFee.trim()) {
            if (!(Number(sampleFee.trim()) >= 0)) return alert('打样费需为不小于 0 的数字');
            extra.sampleFee = sampleFee.trim();
          }
          await api.factoryOrderStatus(o.id, 'confirm', extra);
        } else if (action === 'ship') {
          openShipModal(o);
          return;
        } else {
          if (action === 'cancel' && !(await ui.confirm(`确认取消订单「${o.order_no}」？已支付订单将进入待退款（需管理端确认退款）。`))) return;
          if (action === 'complete' && !(await ui.confirm(`确认完成订单「${o.order_no}」？`))) return;
          if (action === 'sendSample' && !(await ui.confirm(`确认订单「${o.order_no}」样品已寄出？订单将进入打样中，等待客户确认样品。`))) return;
          await api.factoryOrderStatus(o.id, action);
        }
        await loadFactoryData();
      } catch (err) {
        if (err.code !== 401) alert(labels[action] + '失败：' + err.message);
      }
    }

    // ===== P1-10 退款确认：已支付订单取消后 pay_status=refunding，确认后 → refunded =====
    // F-56 闭环修复：工厂模式走工厂退款接口（/factory/*，校验本厂归属），平台模式走管理端接口
    async function adminConfirmRefund(o) {
      try {
        if (!(await ui.confirm(`确认订单「${o.order_no}」退款已完成？\n微信支付订单将先发起原路退款（未配置则仅标记退款状态）。`))) return;
        if (state.isFactoryMode) await api.factoryOrderRefundConfirm(o.id);
        else await api.adminOrderRefund(o.id);
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert('退款确认失败：' + err.message);
      }
    }

    // ===== P1 双轨支付：客户选线下转账的订单（offline+unpaid），工厂确认到账后标记已支付 =====
    async function factoryMarkOfflinePaid(o) {
      try {
        if (!(await ui.confirm(`确认已收到订单「${o.order_no}」的线下转账款项？确认后订单标记为已支付。`))) return;
        await api.factoryOrderOfflinePaid(o.id);
        await loadFactoryData();
      } catch (err) {
        if (err.code !== 401) alert('标记收款失败：' + err.message);
      }
    }

    // 订单操作统一入口：模板只绑这一个函数，内部分流 admin / 工厂
    function doOrderAction(o, action) {
      if (state.isFactoryMode) return factoryOrderAction(o, action);
      return adminOrderAction(o, action);
    }

    // ===== stage14 SaaS 工厂视图：数据加载与价格设置 =====
    async function loadFactoryData() {
      try {
        const [ordersRes, inquiries, pricing, opts] = await Promise.all([
          api.factoryOrders(),
          api.factoryInquiries(),
          api.factoryPricing(),
          api.factoryCatalogOptions(),
        ]);
        state.orders = ordersRes.list || [];
        state.inquiries = inquiries || [];
        state.factoryPricing = pricing;
        state.pricingForm = {
          defaultMargin: Number(pricing.defaultMargin) || 0,
          defaultTaxRate: Number(pricing.defaultTaxRate) || 0,
          defaultWasteRate: Number(pricing.defaultWasteRate) || 0,
        };
        state.factoryCatalogOpts = opts || {};
        // 026：按已下发权限点加载本厂客户与本厂报价单（旧会话无新权限点则跳过，重新登录后生效）
        const perms = ((state.factoryAuth || {}).permissions) || [];
        if (perms.includes('customer:manage')) await loadCustomersPage(1);
        if (perms.includes('quote:view')) await loadQuotesPage(1);
      } catch (err) {
        console.error(err);
        // 401 时登录遮罩自动弹出
        if (err.code !== 401) alert('加载失败：' + err.message);
      }
    }

    // 覆盖条目数（空态判断）
    const overrideRowCount = computed(() => {
      let n = 0;
      for (const codes of Object.values(state.factoryPricing.overrides || {})) {
        for (const fields of Object.values(codes)) n += Object.keys(fields).length;
      }
      return n;
    });

    // 当前覆盖类型可选字段（复用 admin 的 OVERRIDE_FIELDS）
    const factoryOverrideFields = computed(() => OVERRIDE_FIELDS[state.factoryNewOverride.targetType] || []);

    // 目录项编码 → 中文名（来自 /me/catalog-options）
    function overrideItemName(type, code) {
      const list = state.factoryCatalogOpts[type] || [];
      const hit = list.find((o) => String(o.code) === String(code));
      return hit ? hit.name : code;
    }

    // 切覆盖类型时重置字段与目录项选择
    watch(
      () => state.factoryNewOverride.targetType,
      (newType) => {
        const fields = OVERRIDE_FIELDS[newType] || [];
        state.factoryNewOverride.fieldName = fields.length ? fields[0].value : '';
        state.factoryNewOverride.targetCode = '';
      }
    );

    async function saveFactoryPricing() {
      try {
        await api.factorySavePricing({
          defaultMargin: state.pricingForm.defaultMargin,
          defaultTaxRate: state.pricingForm.defaultTaxRate,
          defaultWasteRate: state.pricingForm.defaultWasteRate,
        });
        alert('定价参数已保存，立即生效');
      } catch (err) {
        if (err.code !== 401) alert('保存失败：' + err.message);
      }
    }

    async function addFactoryOverride() {
      const o = state.factoryNewOverride;
      if (!o.targetCode) return alert('请选择目录项');
      try {
        await api.factoryAddOverride({
          targetType: o.targetType, targetCode: o.targetCode,
          fieldName: o.fieldName, fieldValue: o.fieldValue,
        });
        state.factoryPricing = await api.factoryPricing();
        state.factoryNewOverride.targetCode = '';
      } catch (err) {
        if (err.code !== 401) alert('新增失败：' + err.message);
      }
    }

    async function removeFactoryOverride(type, code, field) {
      if (!(await ui.confirm('确认删除此价格覆盖？'))) return;
      try {
        await api.factoryDeleteOverride({ targetType: type, targetCode: code, fieldName: field });
        state.factoryPricing = await api.factoryPricing();
      } catch (err) {
        if (err.code !== 401) alert('删除失败：' + err.message);
      }
    }

    // ===== Stage8 产品类型联动：印刷方式/材料/工艺随品类收窄 =====
    const productConfig = reactive({ printModes: [], materials: [], processes: [] });

    watch(
      () => state.calcForm.productType,
      async (newType) => {
        if (!newType) return;
        try {
          const cfg = await api.request('/api/catalog/product-config/' + newType);
          productConfig.printModes = cfg.printModes || [];
          productConfig.materials = cfg.materials || [];
          productConfig.processes = cfg.processes || [];
          // 自动重置不在允许列表里的选择
          if (productConfig.printModes.length && !productConfig.printModes.includes(state.calcForm.printMode)) {
            state.calcForm.printMode = productConfig.printModes[0];
          }
          if (productConfig.materials.length && !productConfig.materials.includes(state.calcForm.materialCode)) {
            state.calcForm.materialCode = productConfig.materials[0];
          }
          state.calcForm.processes = (state.calcForm.processes || []).filter((p) => productConfig.processes.includes(p));
        } catch (err) {
          console.warn('加载产品联动配置失败:', err.message);
        }
      },
      { immediate: true }
    );

    // 允许列表为空时放行全部（配置缺失容错）
    function isPrintModeAllowed(code) { return !productConfig.printModes.length || productConfig.printModes.includes(code); }
    function isMaterialAllowed(code) { return !productConfig.materials.length || productConfig.materials.includes(code); }
    function isProcessAllowed(code) { return !productConfig.processes.length || productConfig.processes.includes(code); }

    // ===== 026：计算器目录来源 =====
    // 管理端用平台全量目录；工厂端只能用本厂 catalog-options（code/name，无平台价格），
    // 避免把平台价目本泄漏给工厂，同时材料/工艺下拉照常可用
    const calcCatalog = computed(() => {
      if (!state.isFactoryMode) return state.catalog || {};
      const opts = state.factoryCatalogOpts || {};
      const toMap = (arr) => Object.fromEntries((arr || []).map((r) => [r.code, r]));
      return {
        rawPaper: toMap(opts.rawPaper),
        boardPaper: toMap(opts.boardPaper),
        cardPaper: toMap(opts.cardPaper),
        plasticFilm: toMap(opts.plasticFilm),
        finishing: toMap(opts.finishing),
      };
    });

    // 材料下拉五分组：纸板/卡纸/不干胶(STK_*)/无纺布(NW_*)/塑料薄膜（纯前端分组，不动数据表）
    const materialGroups = computed(() => {
      const c = calcCatalog.value || {};
      const card = {}, label = {}, nonwoven = {};
      for (const [code, m] of Object.entries(c.cardPaper || {})) {
        if (code.indexOf('STK_') === 0) label[code] = m;
        else if (code.indexOf('NW_') === 0) nonwoven[code] = m;
        else card[code] = m;
      }
      return [
        { label: '纸板', items: c.boardPaper || {} },
        { label: '卡纸', items: card },
        { label: '不干胶', items: label },
        { label: '无纺布', items: nonwoven },
        { label: '塑料薄膜', items: c.plasticFilm || {} },
      ];
    });

    // 报价计算器可选工厂（过滤停用工厂）
    const activeFactories = computed(() => state.factories.filter((f) => f.status));
    const hasOverrides = computed(() => {
      for (const t of Object.values(state.activeOverrides)) {
        for (const c of Object.values(t)) {
          if (Object.keys(c).length) return true;
        }
      }
      return false;
    });

    // 每种覆盖类型对应的可覆盖字段（value 是数据库字段名，label 是中文）
    const OVERRIDE_FIELDS = {
      rawPaper: [
        { value: 'price_per_ton', label: '吨价(元/吨)' },
        { value: 'grammage',      label: '克重(g/m²)' },
      ],
      boardPaper: [
        { value: 'price_per_sqm', label: '单价(元/㎡)' },
        { value: 'layers',        label: '层数' },
      ],
      cardPaper: [
        { value: 'price_per_sqm', label: '单价(元/㎡)' },
        { value: 'grammage',      label: '克重(g/m²)' },
      ],
      plasticFilm: [
        { value: 'price_per_kg', label: '公斤价(元/kg)' },
      ],
      plateType: [
        { value: 'unit_price', label: '单价(元)' },
      ],
      printingRate: [
        { value: 'start_fee',      label: '开机费(元)' },
        { value: 'extra_per_1000', label: '每千印加价(元)' },
        { value: 'color_rate',     label: '每色每㎡费率(元)' },
        { value: 'min_charge',     label: '最低收费(元)' },
        // 020 图案覆盖率三档系数（与小程序隐藏参数同源）
        { value: 'ink_factor_low',  label: '覆盖率系数·少量' },
        { value: 'ink_factor_mid',  label: '覆盖率系数·中等' },
        { value: 'ink_factor_high', label: '覆盖率系数·满版' },
      ],
      finishing: [
        { value: 'rate',       label: '费率' },
        { value: 'plate_fee',  label: '版费(元)' },
        { value: 'waste_rate', label: '损耗率' },
      ],
      // 020 油墨类型加价系数（专色版价走 plateType/SPOT_COLOR 的 unit_price 覆盖）
      inkType: [
        { value: 'price_factor', label: '加价系数' },
      ],
    };

    // 切换覆盖类型时联动默认字段（必须在 OVERRIDE_FIELDS 声明之后注册：immediate 回调同步执行，提前注册会触发暂时性死区报错）
    watch(
      () => state.newOverride.targetType,
      (newType) => {
        const fields = OVERRIDE_FIELDS[newType] || [];
        state.newOverride.fieldName = fields.length ? fields[0].value : '';
      },
      { immediate: true }
    );

    // 根据当前选中的类型，返回可覆盖的字段列表
    const currentOverrideFields = computed(() => {
      return OVERRIDE_FIELDS[state.newOverride.targetType] || [];
    });

    // 印刷方式下拉选项（目录编辑器复用）
    const PRINT_MODE_OPTIONS = [
      ['offset', '胶印'], ['flexo', '柔印'], ['gravure', '凹印'], ['digital', '数码印'], ['screen', '丝印'],
    ];
    const APPLIED_MODE_OPTIONS = [['all', '通用']].concat(PRINT_MODE_OPTIONS);
    const FINISHING_MODE_OPTIONS = [
      ['perSqm', '按面积计价'], ['perSqm_withPlate', '按面积计价+版费'], ['perUnit', '按件计价'],
    ];
    const RATE_MODE_OPTIONS = [
      ['startFee', '开机费+每千印'], ['perSqm', '按面积计价'], ['perUnit', '按件计价'],
    ];
    const BOOL_OPTIONS = [[1, '是'], [0, '否']];
    const ACTIVE_OPTIONS = [[1, '启用'], [0, '停用']];

    // Stage10 目录维护：table/keyCol 供 upsert 接口定位表与主键；columns.options 驱动编辑器下拉
    const catalogGroups = [
      {
        key: 'rawPaper', table: 'raw_paper', keyCol: 'code', label: '原纸',
        columns: [
          { key: 'code',          label: '编码' },
          { key: 'name',          label: '名称' },
          { key: 'grammage',      label: '克重(g/m²)' },
          { key: 'price_per_ton', label: '吨价(元/吨)' },
          { key: 'supplier',      label: '供应商' },
          { key: 'is_local',      label: '本地采购', options: BOOL_OPTIONS },
          { key: 'is_active',     label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
      {
        key: 'boardPaper', table: 'board_paper', keyCol: 'code', label: '纸板',
        columns: [
          { key: 'code',          label: '编码' },
          { key: 'name',          label: '名称' },
          { key: 'flute',         label: '楞型' },
          { key: 'layers',        label: '层数' },
          { key: 'price_per_sqm', label: '单价(元/㎡)' },
          { key: 'supplier',      label: '供应商' },
          { key: 'is_local',      label: '本地采购', options: BOOL_OPTIONS },
          { key: 'is_active',     label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
      {
        key: 'cardPaper', table: 'card_paper', keyCol: 'code', label: '卡纸',
        columns: [
          { key: 'code',          label: '编码' },
          { key: 'name',          label: '名称' },
          { key: 'grammage',      label: '克重(g/m²)' },
          { key: 'price_per_sqm', label: '单价(元/㎡)' },
          { key: 'supplier',      label: '供应商' },
          { key: 'is_active',     label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
      {
        key: 'plasticFilm', table: 'plastic_film', keyCol: 'code', label: '塑料薄膜',
        columns: [
          { key: 'code',          label: '编码' },
          { key: 'name',          label: '名称' },
          { key: 'material',      label: '材质' },
          { key: 'thickness_um',  label: '厚度(μm)' },
          { key: 'density',       label: '比重' },
          { key: 'price_per_kg',  label: '公斤价(元/kg)' },
          { key: 'supplier',      label: '供应商' },
          { key: 'is_active',     label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
      {
        key: 'plateType', table: 'plate_type', keyCol: 'code', label: '版材',
        columns: [
          { key: 'code',       label: '编码' },
          { key: 'name',       label: '名称' },
          { key: 'unit_price', label: '单价(元)' },
          { key: 'unit',       label: '计价单位' },
          { key: 'print_mode', label: '适用印刷方式', options: APPLIED_MODE_OPTIONS },
          { key: 'is_active',  label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
      {
        key: 'printingRate', table: 'printing_rate', keyCol: 'print_mode', label: '印工费率',
        columns: [
          { key: 'print_mode',      label: '印刷方式', options: PRINT_MODE_OPTIONS },
          { key: 'name',            label: '名称' },
          { key: 'mode',            label: '计价模式', options: RATE_MODE_OPTIONS },
          { key: 'start_fee',       label: '开机费(元)' },
          { key: 'extra_per_1000',  label: '每千印加价(元)' },
          { key: 'min_charge',      label: '最低收费(元)' },
          { key: 'color_rate',      label: '每色每㎡费率(元)' },
          { key: 'ink_factor_low',  label: '覆盖率系数·少量' },
          { key: 'ink_factor_mid',  label: '覆盖率系数·中等' },
          { key: 'ink_factor_high', label: '覆盖率系数·满版' },
        ],
      },
      // 020 油墨类型目录：系数源开放后台维护（此前只能改 DB）
      {
        key: 'inkType', table: 'ink_type', keyCol: 'code', label: '油墨类型',
        columns: [
          { key: 'code',         label: '编码' },
          { key: 'name',         label: '名称' },
          { key: 'price_factor', label: '加价系数' },
          { key: 'is_active',    label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
      {
        key: 'finishing', table: 'finishing_process', keyCol: 'code', label: '后道工艺',
        columns: [
          { key: 'code',                label: '编码' },
          { key: 'name',                label: '名称' },
          { key: 'mode',                label: '计价模式', options: FINISHING_MODE_OPTIONS },
          { key: 'rate',                label: '费率' },
          { key: 'plate_fee',           label: '版费(元)' },
          { key: 'waste_rate',          label: '损耗率' },
          { key: 'print_mode',          label: '适用印刷方式', options: APPLIED_MODE_OPTIONS },
          { key: 'small_qty_threshold', label: '小批量阈值' },
          { key: 'small_qty_factor',    label: '上浮倍率' },
          { key: 'is_active',           label: '状态', options: ACTIVE_OPTIONS },
        ],
      },
    ];

    function goto(page) {
      // F-167/168：目标页必须在菜单配置内且通过权限校验（防止越权直访）
      const item = NAV_MENU.find((x) => x.key === page);
      if (!item) return;
      if (state.isFactoryMode ? item.mode === 'admin' : item.mode === 'factory') return;
      if (!hasPerm(item.perm)) return;
      if (item.soon) { alert('「' + menuTitle(item) + '」将在后续阶段上线，敬请期待'); return; }
      // stage15d：切到某页时自动展开它所在的分组，左侧一定要能看到当前菜单项
      expandGroupOf(item);
      // stage15c：首次进入的页面加入标签栏（页面 DOM 常驻，切换不丢表单/滚动状态）
      if (!state.tabs.includes(page)) state.tabs.push(page);
      state.page = page;
      // 分组展开后菜单变长，把当前项滚进可视区
      setTimeout(() => {
        const el = document.querySelector('.nav-item.active');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }, 0);
      if (page === 'shipping') loadShippingTemplates();
      if (page === 'sessions') loadSessions();
      if (page === 'fee-ledger') loadFeeLedger();
      if (page === 'pricing' && state.isFactoryMode) loadFactoryData();
      if (page === 'staff' && state.isFactoryMode) loadStaffs();
      if (page === 'dashboard' && state.isFactoryMode) { loadFactoryData(); loadFactoryStats(); }
      // 029：管理端每次进入数据概览实时重拉统计——此前只在登录时拉一次，
      // 停用/启用工厂后切回看板数字仍是旧值
      if (page === 'dashboard' && !state.isFactoryMode) loadDashStats();
    }

    // stage15c：标签标题（管理端/工厂端文案不同，复用菜单配置）
    function tabTitle(key) {
      const item = NAV_MENU.find((x) => x.key === key);
      return item ? menuTitle(item) : key;
    }

    // stage15c：关闭标签页（关闭当前页时切到左侧相邻标签；只剩一个时不可关）
    function closeTab(key) {
      const idx = state.tabs.indexOf(key);
      if (idx < 0 || state.tabs.length === 1) return;
      state.tabs.splice(idx, 1);
      if (state.page === key) {
        const next = state.tabs[Math.max(0, idx - 1)];
        if (next) goto(next);
      }
    }

    // stage15c：侧边栏分组折叠（状态记忆到 localStorage）
    function persistCollapsedGroups() {
      try { localStorage.setItem('admin_nav_collapsed_groups', JSON.stringify(state.collapsedGroups)); } catch (e) { /* ignore */ }
    }
    function toggleGroup(label) {
      state.collapsedGroups = { ...state.collapsedGroups, [label]: !state.collapsedGroups[label] };
      persistCollapsedGroups();
    }
    function isGroupCollapsed(label) {
      return !!state.collapsedGroups[label];
    }
    // stage15d：进入页面时把该页所在分组展开（用户点顶部标签切页也能看到左侧菜单项）
    function expandGroupOf(item) {
      const group = item && item.group;
      if (!group || !state.collapsedGroups[group]) return;
      const next = { ...state.collapsedGroups };
      delete next[group];
      state.collapsedGroups = next;
      persistCollapsedGroups();
    }

    function getCell(row, col) {
      const v = row[col];
      if (v === undefined || v === null) return '-';
      return v;
    }

    // ===== Stage10 目录维护：行编辑 / 新增 / 启停 =====
    const catalogEditor = reactive({ open: false, groupKey: '', groupLabel: '', isNew: false, keyValue: '', form: {} });

    const catalogEditorColumns = computed(() => {
      const g = catalogGroups.find((x) => x.key === catalogEditor.groupKey);
      return g ? g.columns : [];
    });
    const catalogEditorKeyCol = computed(() => {
      const g = catalogGroups.find((x) => x.key === catalogEditor.groupKey);
      return g ? g.keyCol : 'code';
    });

    function openCatalogEditor(group, row) {
      catalogEditor.groupKey = group.key;
      catalogEditor.groupLabel = group.label;
      catalogEditor.isNew = !row;
      catalogEditor.keyValue = row ? String(row[group.keyCol]) : '';
      const form = {};
      for (const col of group.columns) {
        const v = row ? row[col.key] : (col.options ? col.options[0][0] : '');
        form[col.key] = v === undefined || v === null ? '' : v;
      }
      catalogEditor.form = form;
      catalogEditor.open = true;
    }

    async function saveCatalogItem() {
      const group = catalogGroups.find((g) => g.key === catalogEditor.groupKey);
      if (!group) return;
      const data = {};
      for (const col of group.columns) {
        if (!catalogEditor.isNew && col.key === group.keyCol) continue;
        let v = catalogEditor.form[col.key];
        if (v === '' || v === undefined || v === null) v = null;
        else if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) v = Number(v);
        data[col.key] = v;
      }
      try {
        await api.request('/api/catalog/item', {
          method: 'PUT',
          body: { group: group.key, key: catalogEditor.isNew ? null : catalogEditor.keyValue, data },
        });
        await refreshCatalog();
        catalogEditor.open = false;
      } catch (err) { alert('保存失败：' + err.message); }
    }

    async function toggleCatalogItem(group, row) {
      const key = String(row[group.keyCol]);
      const isRate = group.key === 'printingRate'; // 无 is_active 列，停用即删除
      const next = !row.is_active;
      if (isRate) {
        if (!(await ui.confirm('删除费率「' + (row.name || key) + '」？删除后该印刷方式将不可报价。'))) return;
      } else if (!(await ui.confirm((next ? '启用' : '停用') + '「' + (row.name || key) + '」？' + (next ? '' : '停用后报价不再使用该条。')))) return;
      try {
        await api.request('/api/catalog/item/toggle', { method: 'POST', body: { group: group.key, key, active: next } });
        await refreshCatalog();
      } catch (err) { alert('操作失败：' + err.message); }
    }

    // 目录写库后同时刷新「启用目录」与「维护目录」两份数据
    async function refreshCatalog() {
      const [catalog, catalogAll] = await Promise.all([api.catalog(), api.catalogAll()]);
      state.catalog = catalog;
      state.catalogAll = catalogAll;
    }

   function extractTotal(systemQuote) {
      if (!systemQuote) return '-';
      try {
        const q = typeof systemQuote === 'string' ? JSON.parse(systemQuote) : systemQuote;
        return q.totalPrice
            ?? q.total_price
            ?? q.finalPrice
            ?? q.final_price
            ?? (q.unitPrice && q.quantity ? (q.unitPrice * q.quantity).toFixed(2) : null)
            ?? '-';
      } catch (e) {
        console.warn('[extractTotal] 解析失败:', e, systemQuote);
        return '-';
      }
    }

    function factoryName(id) {
      if (!id) return '-';
      const f = state.factories.find((x) => x.id === id);
      return f ? f.name : '-';
    }

    function productTypeLabel(t) {
      return {
        carton: '纸箱', cardBox: '彩盒', card: '卡片',
        paperBag: '纸袋', sticker: '不干胶', flexiblePackaging: '软包装',
        nonWovenBag: '无纺布袋', antiCounterfeitLabel: '防伪标签', heatTransfer: '热转印',
        paperContainer: '纸容器',
      }[t] || t;
    }

    function statusLabel(s) {
      return {
        draft: '草稿', sent: '已发送', accepted: '已接受', rejected: '已拒绝',
        quoted: '已报价', matched: '已匹配', converted: '已转化',
        pending: '待处理', accept: '已接单', decline: '已拒绝',
        // C端询价单状态（c_inquiry）
        factory_quoted: '工厂已报价', user_confirmed: '已确认下单', expired: '已过期',
      }[s] || s;
    }

    function finishingModeLabel(mode) {
      return {
        perSqm: '按面积计价',
        perSqm_withPlate: '按面积计价 + 版费',
        perUnit: '按件计价',
      }[mode] || mode;
    }

    function printModeLabel(mode) {
      return {
        offset: '胶印',
        flexo: '柔印',
        gravure: '凹印',
        digital: '数码印',
        screen: '丝印',
        all: '通用',
      }[mode] || mode;
    }

    // 印工费率计价模式文案
    function rateModeLabel(mode) {
      return {
        startFee: '开机费+每千印',
        perSqm: '按面积计价',
        perUnit: '按件计价',
      }[mode] || mode;
    }

    function targetTypeLabel(type) {
      return {
        rawPaper:     '原纸',
        boardPaper:   '纸板',
        cardPaper:    '卡纸',
        plasticFilm:  '塑料薄膜',
        plateType:    '版材',
        printingRate: '印工费率',
        finishing:    '后道工艺',
        inkType:      '油墨类型',
      }[type] || type;
    }

    function fieldNameLabel(field) {
      return {
        price_per_ton:    '吨价(元/吨)',
        price_per_sqm:    '单价(元/㎡)',
        price_per_kg:     '公斤价(元/kg)',
        thickness_um:     '厚度(μm)',
        density:          '比重(g/cm³)',
        unit_price:       '单价(元)',
        start_fee:        '开机费(元)',
        extra_per_1000:   '每千印加价(元)',
        color_rate:       '每色每㎡费率(元)',
        min_charge:       '最低收费(元)',
        rate:             '费率',
        plate_fee:        '版费(元)',
        waste_rate:       '损耗率',
        ink_factor_low:   '覆盖率系数·少量',
        ink_factor_mid:   '覆盖率系数·中等',
        ink_factor_high:  '覆盖率系数·满版',
        price_factor:     '加价系数',
      }[field] || field;
    }

    function statusLabel(s) {
      return {
        draft: '草稿',
        sent: '已发送',
        accepted: '已接受',
        rejected: '已拒绝',
        quoted: '已报价',
        matched: '已匹配',
        converted: '已转化',
        pending: '待处理',
        accept: '已接单',
        decline: '已拒绝',
        // C端询价单状态（c_inquiry）
        factory_quoted: '工厂已报价',
        user_confirmed: '已确认下单',
        expired: '已过期',
      }[s] || s;
    }

    function productTypeLabel(t) {
      return {
        carton: '纸箱',
        cardBox: '彩盒',
        card: '卡片',
        paperBag: '纸袋',
        sticker: '不干胶',
        flexiblePackaging: '软包装',
        nonWovenBag: '无纺布袋',
        antiCounterfeitLabel: '防伪标签',
        heatTransfer: '热转印',
        paperContainer: '纸容器',
      }[t] || t;
    }

    function factoryNameById(id) {
      if (!id) return '-';
      const f = state.factories.find((x) => x.id === id);
      return f ? f.name : '-';
    }

    function formatTime(dateStr) {
      if (!dateStr) return '-';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const pad = (n) => String(n).padStart(2, '0');
      return (
        d.getFullYear() + '-' +
        pad(d.getMonth() + 1) + '-' +
        pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' +
        pad(d.getMinutes())
      );
    }

    // ===== stage15c 在线设备可读化：UA → 「系统 · 浏览器/微信」，IP 归一化 =====
    // 原始 UA/IP 仍放在 title 悬浮提示里，需要排查时鼠标悬停即可看到
    function formatDevice(ua) {
      if (!ua) return '未知设备';
      const u = String(ua);
      if (/wechatdevtools/i.test(u)) return '微信开发者工具';
      let os = '未知系统';
      if (/Windows NT 10/.test(u)) os = 'Windows 10/11';
      else if (/Windows NT 6\.1/.test(u)) os = 'Windows 7';
      else if (/iPhone/.test(u)) {
        const m = u.match(/OS (\d+)[._](\d+)/);
        os = 'iPhone' + (m ? ' · iOS ' + m[1] + '.' + m[2] : '');
      } else if (/iPad/.test(u)) os = 'iPad';
      else if (/Android/.test(u)) {
        const m = u.match(/Android (\d+)/);
        os = 'Android' + (m ? ' ' + m[1] : '');
      } else if (/Mac OS X/.test(u)) os = 'Mac';
      else if (/Linux/.test(u)) os = 'Linux';
      let app = '';
      let m;
      if (/MicroMessenger/i.test(u)) {
        m = u.match(/MicroMessenger\/([\d.]+)/);
        app = '微信' + (m ? ' ' + m[1] : '');
      } else if ((m = u.match(/Edg\/(\d+)/))) app = 'Edge ' + m[1];
      else if ((m = u.match(/OPR\/(\d+)/))) app = 'Opera ' + m[1];
      else if ((m = u.match(/Firefox\/(\d+)/))) app = 'Firefox ' + m[1];
      else if ((m = u.match(/Chrome\/(\d+)/))) app = 'Chrome ' + m[1];
      else if ((m = u.match(/Version\/(\d+)[\d.]* .*Safari/))) app = 'Safari ' + m[1];
      return app ? os + ' · ' + app : os;
    }

    function formatIp(ip) {
      if (!ip) return '-';
      const s = String(ip).trim();
      if (s === '::1' || s === '127.0.0.1') return '本机（127.0.0.1）';
      // IPv4 映射的 IPv6（::ffff:192.168.1.248）只显示 IPv4 部分
      if (s.toLowerCase().startsWith('::ffff:')) return s.slice(7);
      return s;
    }

    // ===== 设计稿展示（021/022：订单、询价单关联 c_inquiry 带出 design_* 字段）=====
    // design_images 是 JSON 数组列，mysql2 直出数组；兼容历史字符串形态
    function designImgs(row) {
      const v = row && row.design_images;
      if (Array.isArray(v)) return v;
      if (typeof v === 'string' && v) {
        try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
      }
      return [];
    }
    // 设计稿单元格徽标：none=自带稿（有图时不必展示徽标，图即稿）/ need=需设计 / public=工厂公版
    function designBadge(row) {
      const s = row && row.design_status;
      if (s === 'need') return { text: '需设计', style: 'background:#ede9fe;color:#6d28d9' };
      if (s === 'public') return { text: '工厂公版', style: 'background:#e0f2fe;color:#0369a1' };
      return null;
    }
    // 新标签打开原图：浏览器中可直接右键另存/拖拽保存，即工厂的取图通道
    function openDesignImg(url) { if (url) window.open(url, '_blank'); }
    // 024 印刷制版 PDF（排版工具产出的矢量文件：矢量文字/CMYK/裁切角线）：design_pdfs JSON 列，取第一个
    function designPdf(row) {
      const v = row && row.design_pdfs;
      if (Array.isArray(v) && v.length) return v[0];
      if (typeof v === 'string' && v) {
        try { const p = JSON.parse(v); return Array.isArray(p) && p.length ? p[0] : ''; } catch (e) { return ''; }
      }
      return '';
    }

    // 能力编辑状态
    const capabilityEditor = reactive({
      factoryId: null,
      factoryName: '',
      capabilities: { productType: [], printMode: [], process: [], material: [] },
    });

    // 可选能力清单（用于编辑时勾选）
    const CAP_OPTIONS = {
      productType: [
        { code: 'carton',  name: '纸箱' },
        { code: 'cardBox', name: '彩盒' },
        { code: 'card',    name: '卡片' },
        { code: 'paperBag', name: '纸袋' },
        { code: 'sticker',  name: '不干胶' },
        { code: 'flexiblePackaging', name: '软包装' },
        { code: 'nonWovenBag', name: '无纺布袋' },
        { code: 'antiCounterfeitLabel', name: '防伪标签' },
        { code: 'heatTransfer', name: '热转印' },
        { code: 'paperContainer', name: '纸容器' },
      ],
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
        // 纸容器工艺（与 product_config.paperContainer 白名单一致）
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
        // 纸容器白名单材料（与 card_paper 目录一致）
        { code: 'FOOD_CARD',  name: '320g食品白卡' },
        { code: 'FOOD_KRAFT', name: '300g食品牛皮卡' },
        { code: 'CUP_PE',     name: '单PE淋膜杯纸' },
        { code: 'CUP_PLA',    name: 'PLA淋膜杯纸' },
      ],
    };

    async function editCapability(factoryId) {
      const detail = await api.request(`/api/factory/detail/${factoryId}`);
      capabilityEditor.factoryId = factoryId;
      capabilityEditor.factoryName = detail.name;
      capabilityEditor.capabilities = detail.capabilities;
    }

    function toggleCapability(type, code) {
      const list = capabilityEditor.capabilities[type];
      const idx = list.indexOf(code);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(code);
    }

    async function saveCapability() {
      await api.request(`/api/factory/capabilities/${capabilityEditor.factoryId}`, {
        method: 'POST',
        body: capabilityEditor.capabilities,
      });
      alert('能力已保存');
      capabilityEditor.factoryId = null;
    }

    // ===== 工厂新增 / 编辑 / 启停 =====
    const factoryEditor = reactive({
      open: false,
      form: {
        id: null, code: '', name: '', contact: '', phone: '', address: '',
        defaultMarginPct: 15, cEndEnabled: 1,
        // 027 验真徽章：平台已核验资质（营业执照/印刷经营许可证），C 端展示「已核验」
        licenseVerified: 0,
        // 登录账号：新增时可设置（开户），编辑时不修改
        username: '', password: '',
        // 隐藏字段：编辑时原样回传，避免被后端默认值覆盖
        defaultTaxRate: 0.10, defaultWasteRate: 0.04, status: 1,
      },
    });

    function openFactoryEditor(f) {
      const form = factoryEditor.form;
      if (f) {
        Object.assign(form, {
          id: f.id, code: f.code, name: f.name,
          contact: f.contact || '', phone: f.phone || '', address: f.address || '',
          defaultMarginPct: Math.round((Number(f.default_margin) || 0) * 100),
          cEndEnabled: f.c_end_enabled ? 1 : 0,
          defaultTaxRate: Number(f.default_tax_rate) || 0.10,
          defaultWasteRate: Number(f.default_waste_rate) || 0.04,
          status: f.status,
          licenseVerified: f.license_verified ? 1 : 0,
          username: f.username || '', password: '',
        });
      } else {
        Object.assign(form, {
          id: null, code: '', name: '', contact: '', phone: '', address: '',
          defaultMarginPct: 15, cEndEnabled: 1,
          defaultTaxRate: 0.10, defaultWasteRate: 0.04, status: 1,
          licenseVerified: 0,
          username: '', password: '',
        });
      }
      factoryEditor.open = true;
    }

    async function saveFactory() {
      const f = factoryEditor.form;
      if (!f.name) return alert('请填写工厂名称');
      if (!f.id && !f.code) return alert('请填写工厂编码');
      if (!f.id && f.username && f.password && f.password.length < 6) return alert('密码至少 6 位，留空则用默认密码 000000');
      const body = {
        name: f.name, contact: f.contact, phone: f.phone, address: f.address,
        defaultMargin: (f.defaultMarginPct || 0) / 100,
        defaultTaxRate: f.defaultTaxRate,
        defaultWasteRate: f.defaultWasteRate,
        cEndEnabled: f.cEndEnabled,
        status: f.status,
        // 027：验真徽章开关（后端仅当显式传入时更新 license_verified，不影响旧请求）
        licenseVerified: f.licenseVerified ? 1 : 0,
      };
      try {
        if (f.id) {
          await api.factoryUpdate(f.id, body);
          factoryEditor.open = false;
          await loadAll();
        } else {
          await api.factoryCreate({
            ...body, code: f.code,
            username: f.username || undefined,
            password: f.username ? (f.password || '000000') : undefined,
          });
          factoryEditor.open = false;
          await loadAll();
          alert(f.username
            ? '工厂创建成功\n\n已开通登录账号「' + f.username + '」，初始密码 '
              + (f.password || '000000') + '（工厂方可在小程序工厂端登录后修改）。'
            : '工厂创建成功\n\n未设置登录账号：工厂方可自助注册后由你在本页审核激活。');
        }
      } catch (err) {
        if (err.code !== 401) alert('保存失败：' + err.message);
      }
    }

    // ===== 工厂注册审核 =====
    const AUDIT_STATUS_TEXT = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };
    const AUDIT_STATUS_STYLE = {
      pending:  'background:#fef3c7;color:#b45309',
      approved: 'background:#dcfce7;color:#15803d',
      rejected: 'background:#fee2e2;color:#dc2626',
    };
    const auditStatusLabel = (s) => AUDIT_STATUS_TEXT[s] || s;
    const auditStatusStyle = (s) => AUDIT_STATUS_STYLE[s] || '';
    const pendingCount = computed(() => state.factories.filter((f) => f.audit_status === 'pending').length);

    async function factoryAudit(f, action) {
      const label = action === 'approve' ? '通过' : '驳回';
      if (!(await ui.confirm(`确认${label}工厂「${f.name}」的注册申请？`))) return;
      try {
        await api.factoryAudit(f.id, action);
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert(label + '失败：' + err.message);
      }
    }

    async function toggleFactoryStatus(f) {
      const action = f.status ? '停用' : '启用';
      const tip = f.status ? '\n停用后该工厂不再参与匹配与接单。' : '';
      if (!(await ui.confirm(`确认${action}工厂「${f.name}」？${tip}`))) return;
      try {
        await api.factoryUpdate(f.id, {
          name: f.name, contact: f.contact, phone: f.phone, address: f.address,
          defaultMargin: Number(f.default_margin), defaultTaxRate: Number(f.default_tax_rate),
          defaultWasteRate: Number(f.default_waste_rate), cEndEnabled: f.c_end_enabled,
          status: f.status ? 0 : 1,
        });
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert(action + '失败：' + err.message);
      }
    }

    // ===== 客户管理 =====
    const customerEditor = reactive({
      open: false,
      form: { id: null, name: '', contact: '', phone: '', level: 'normal', discountPct: 100, address: '', factoryId: 0 },
    });

    function openCustomerEditor(c) {
      const form = customerEditor.form;
      if (c) {
        Object.assign(form, {
          id: c.id, name: c.name, contact: c.contact || '', phone: c.phone || '',
          level: c.level || 'normal',
          discountPct: Math.round((Number(c.discount) || 0) * 100),
          address: c.address || '', factoryId: c.factory_id || 0,
        });
      } else {
        Object.assign(form, {
          id: null, name: '', contact: '', phone: '',
          level: 'normal', discountPct: 100, address: '', factoryId: 0,
        });
      }
      customerEditor.open = true;
    }

    // 027：VIP 联动——等级切到 VIP 且折扣仍是原价（100/空）时自动带出 95 折，
    // 让 VIP 有实际意义；已手工填过折扣的不覆盖
    function onCustomerLevelChange() {
      const f = customerEditor.form;
      if (f.level === 'vip' && (!f.discountPct || Number(f.discountPct) === 100)) {
        f.discountPct = 95;
      }
    }

    async function saveCustomer() {
      const c = customerEditor.form;
      if (!c.name) return alert('请填写客户名称');
      const body = {
        factoryId: c.factoryId || 0,
        name: c.name, contact: c.contact, phone: c.phone,
        level: c.level, discount: (c.discountPct || 0) / 100, address: c.address,
      };
      try {
        if (c.id) await api.customerUpdate(c.id, body);
        else await api.customerCreate(body);
        customerEditor.open = false;
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert('保存失败：' + err.message);
      }
    }

    async function removeCustomer(c) {
      if (!(await ui.confirm(`确认删除客户「${c.name}」？此操作不可恢复。`))) return;
      try {
        await api.customerDelete(c.id);
        // stage16：删除后刷新当前页；删光本页且非首页时回退一页
        await (state.customers.length <= 1 && state.customerPage > 1
          ? loadCustomersPage(state.customerPage - 1)
          : loadCustomersPage(state.customerPage));
      } catch (err) {
        if (err.code !== 401) alert('删除失败：' + err.message);
      }
    }

    // ===== 业务数据删除 =====
    async function removeQuote(q) {
      if (!(await ui.confirm(`确认删除报价单「${q.quote_no}」？此操作不可恢复。`))) return;
      try {
        await api.deleteQuote(q.id);
        // stage16：删除后刷新当前页；删光本页且非首页时回退一页
        await (state.quotes.length <= 1 && state.quotePage > 1
          ? loadQuotesPage(state.quotePage - 1)
          : loadQuotesPage(state.quotePage));
      } catch (err) {
        if (err.code !== 401) alert('删除失败：' + err.message);
      }
    }

    async function removeInquiry(i) {
      if (!(await ui.confirm('确认删除该条C端询价（含推送记录）？此操作不可恢复。'))) return;
      try {
        await api.deleteInquiry(i.id);
        // stage16：删除后刷新当前页；删光本页且非首页时回退一页
        await (state.inquiries.length <= 1 && state.inquiryPage > 1
          ? loadInquiriesPage(state.inquiryPage - 1)
          : loadInquiriesPage(state.inquiryPage));
      } catch (err) {
        if (err.code !== 401) alert('删除失败：' + err.message);
      }
    }

    // ===== CSV 导出 =====
    async function exportQuotes() {
      try { await api.downloadCsv('/api/quote/export', 'quotes.csv'); }
      catch (err) { if (err.code !== 401) alert('导出失败：' + err.message); }
    }

    async function exportInquiries() {
      try { await api.downloadCsv('/api/c/inquiry/export', 'inquiries.csv'); }
      catch (err) { if (err.code !== 401) alert('导出失败：' + err.message); }
    }

    async function exportCustomers() {
      try { await api.downloadCsv('/api/customer/export', 'customers.csv'); }
      catch (err) { if (err.code !== 401) alert('导出失败：' + err.message); }
    }

    // ===== 账户管理（仅超级管理员可增改/重置密码，普通管理员只读列表） =====
    const isSuper = computed(() => !!state.currentUser && state.currentUser.role === 'super');
    const userEditor = reactive({
      open: false,
      form: { id: null, username: '', password: '', nickname: '', role: 'admin' },
    });

    function openUserEditor(u) {
      const form = userEditor.form;
      if (u) {
        Object.assign(form, {
          id: u.id, username: u.username, password: '',
          nickname: u.nickname || '', role: u.role || 'admin',
        });
      } else {
        Object.assign(form, { id: null, username: '', password: '', nickname: '', role: 'admin' });
      }
      userEditor.open = true;
    }

    async function saveUser() {
      const f = userEditor.form;
      if (!f.id && !f.username) return alert('请填写用户名');
      if (!f.id && (!f.password || f.password.length < 6)) return alert('初始密码至少 6 位');
      try {
        if (f.id) {
          await api.userUpdate(f.id, { nickname: f.nickname, role: f.role });
        } else {
          await api.userCreate({ username: f.username, password: f.password, nickname: f.nickname, role: f.role });
        }
        userEditor.open = false;
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert('保存失败：' + err.message);
      }
    }

    async function toggleUserStatus(u) {
      const action = u.status ? '禁用' : '启用';
      const tip = u.status ? '\n禁用后该账户将立即无法登录。' : '';
      if (!(await ui.confirm(`确认${action}账户「${u.username}」？${tip}`))) return;
      try {
        await api.userUpdate(u.id, { status: u.status ? 0 : 1 });
        await loadAll();
      } catch (err) {
        if (err.code !== 401) alert(action + '失败：' + err.message);
      }
    }

    async function resetUserPassword(u) {
      const pwd = await ui.prompt(`为账户「${u.username}」设置新密码（至少 6 位）：`, '', { inputType: 'password' });
      if (pwd === null) return;
      if (!pwd || pwd.length < 6) return alert('密码至少 6 位');
      try {
        await api.userResetPassword(u.id, pwd);
        alert('密码已重置，该账户需重新登录');
      } catch (err) {
        if (err.code !== 401) alert('重置失败：' + err.message);
      }
    }

    // ===== 员工管理（F-152~F-160：工厂多账号，owner 专属 staff:manage） =====
    const FACTORY_ROLE_TEXT = { owner: '老板', manager: '主管', sales: '业务员', finance: '财务', designer: '设计', viewer: '查看者' };

    // ===== 顶部角色信息（F-173）=====
    const roleBadge = computed(() => {
      if (state.isFactoryMode) return FACTORY_ROLE_TEXT[(state.factoryAuth || {}).role] || '工厂';
      return (state.currentUser || {}).role === 'super' ? '超级管理员' : '管理员';
    });
    const displayName = computed(() => {
      if (state.isFactoryMode) {
        const auth = state.factoryAuth || {};
        const real = auth.realName ? ' · ' + auth.realName : '';
        return (auth.name || '工厂') + real;
      }
      const me = state.currentUser || {};
      return me.nickname || me.username || '未登录';
    });
    // F-168：菜单按权限渲染——登录返回的 permissions 含 staff:manage 才显示「员工管理」
    const canManageStaff = computed(() => {
      if (!state.isFactoryMode) return false;
      const auth = state.factoryAuth || {};
      if (Array.isArray(auth.permissions)) return auth.permissions.includes('staff:manage');
      return auth.role ? auth.role === 'owner' : true;
    });
    const staffEditor = reactive({
      open: false,
      list: [],
      form: { id: null, username: '', password: '', realName: '', phone: '', role: 'sales', newPassword: '' },
    });

    async function loadStaffs() {
      try {
        const rows = await api.request('/api/factory/me/staff');
        staffEditor.list = Array.isArray(rows) ? rows : [];
      } catch (err) {
        if (err.code !== 401) alert('加载员工列表失败：' + err.message);
      }
    }

    function openStaffEditor(u) {
      const form = staffEditor.form;
      if (u) {
        Object.assign(form, {
          id: u.id, username: u.username, password: '',
          realName: u.real_name || '', phone: u.phone || '',
          role: u.role || 'sales', newPassword: '',
        });
      } else {
        Object.assign(form, { id: null, username: '', password: '', realName: '', phone: '', role: 'sales', newPassword: '' });
      }
      staffEditor.open = true;
    }

    async function saveStaff() {
      const f = staffEditor.form;
      try {
        if (!f.id) {
          if (!f.username) return alert('请填写登录账号');
          if (!f.password || f.password.length < 6) return alert('初始密码至少 6 位');
          await api.request('/api/factory/me/staff', {
            method: 'POST',
            body: { username: f.username, password: f.password, realName: f.realName, phone: f.phone, role: f.role },
          });
        } else {
          const body = { realName: f.realName, phone: f.phone, role: f.role };
          if (f.newPassword) {
            if (f.newPassword.length < 6) return alert('新密码至少 6 位');
            body.newPassword = f.newPassword;
          }
          await api.request('/api/factory/me/staff/' + f.id, { method: 'PUT', body });
        }
        staffEditor.open = false;
        await loadStaffs();
      } catch (err) {
        if (err.code !== 401) alert('保存失败：' + err.message);
      }
    }

    async function toggleStaffStatus(u) {
      const action = u.status ? '禁用' : '启用';
      const tip = u.status ? '\n禁用后其所有设备将立即无法登录。' : '';
      if (!(await ui.confirm(`确认${action}员工「${u.real_name || u.username}」？${tip}`))) return;
      try {
        await api.request('/api/factory/me/staff/' + u.id + '/toggle', { method: 'POST' });
        await loadStaffs();
      } catch (err) {
        if (err.code !== 401) alert(action + '失败：' + err.message);
      }
    }

    async function resetStaffPwd(u) {
      const pwd = await ui.prompt(`为员工「${u.username}」设置新密码（至少 6 位，重置后其所有设备需重新登录）：`, '', { inputType: 'password' });
      if (pwd === null) return;
      if (!pwd || pwd.length < 6) return alert('密码至少 6 位');
      try {
        await api.request('/api/factory/me/staff/' + u.id, { method: 'PUT', body: { newPassword: pwd } });
        alert('密码已重置');
      } catch (err) {
        if (err.code !== 401) alert('重置失败：' + err.message);
      }
    }

    async function removeStaff(u) {
      if (!(await ui.confirm(`确认删除员工「${u.real_name || u.username}」？删除后不可恢复。`))) return;
      try {
        await api.request('/api/factory/me/staff/' + u.id, { method: 'DELETE' });
        await loadStaffs();
      } catch (err) {
        if (err.code !== 401) alert('删除失败：' + err.message);
      }
    }

    // ===== 我的数据（工厂视角 F-19 简版统计）=====
    const factoryStats = reactive({ rating: 5, ratingCount: 0, totalPushes: 0, totalAccepts: 0, avgResponseHours: 0, loaded: false });
    async function loadFactoryStats() {
      if (factoryStats.loaded) return;
      try {
        const p = await api.request('/api/factory/me/profile');
        factoryStats.rating = Number(p.rating) || 5;
        factoryStats.ratingCount = p.rating_count || 0;
        factoryStats.totalPushes = p.total_pushes || 0;
        factoryStats.totalAccepts = p.total_accepts || 0;
        factoryStats.avgResponseHours = Number(p.avg_response_hours) || 0;
        factoryStats.loaded = true;
      } catch (err) {
        if (err.code !== 401) console.warn('工厂统计加载失败：', err.message);
      }
    }
    const factoryAcceptRate = computed(() => {
      const n = factoryStats.totalPushes;
      return n ? Math.round((factoryStats.totalAccepts / n) * 100) : 0;
    });
    const factoryAvgResponse = computed(() => {
      const h = factoryStats.avgResponseHours;
      if (!h || h <= 0) return '1小时内';
      return h < 24 ? h.toFixed(1) + '小时' : (h / 24).toFixed(1) + '天';
    });
    const factoryPendingInquiries = computed(() => (state.inquiries || []).filter((i) => i.response === 'pending'));

    async function changeMyPassword() {
      // stage14 SaaS：工厂视图改的是工厂账号密码
      if (state.isFactoryMode) {
        const oldPassword = await ui.prompt('请输入当前密码：', '', { inputType: 'password' });
        if (oldPassword === null) return;
        const newPassword = await ui.prompt('请输入新密码（至少 6 位）：', '', { inputType: 'password' });
        if (newPassword === null) return;
        if (!newPassword || newPassword.length < 6) return alert('新密码至少 6 位');
        try {
          await api.factoryPassword(oldPassword, newPassword);
          alert('密码已修改');
        } catch (err) {
          if (err.code !== 401) alert('修改失败：' + err.message);
        }
        return;
      }
      const oldPassword = await ui.prompt('请输入当前密码：', '', { inputType: 'password' });
      if (oldPassword === null) return;
      const newPassword = await ui.prompt('请输入新密码（至少 6 位）：', '', { inputType: 'password' });
      if (newPassword === null) return;
      if (!newPassword || newPassword.length < 6) return alert('新密码至少 6 位');
      try {
        await api.adminChangePassword(oldPassword, newPassword);
        alert('密码已修改');
      } catch (err) {
        if (err.code !== 401) alert('修改失败：' + err.message);
      }
    }

    // ===== F-148/150 在线设备管理（管理端） =====
    const SESSION_TYPE_TEXT = { admin: '管理员', factory: '工厂', customer: '客户' };
    async function loadSessions() {
      state.sessionsLoading = true;
      try {
        const params = {};
        if (state.sessionUserType) params.userType = state.sessionUserType;
        if (state.sessionKeyword) params.keyword = state.sessionKeyword;
        const data = await api.sessions(params);
        state.sessions = (data && data.list) || [];
      } catch (err) {
        if (err.code !== 401) alert('在线设备加载失败：' + err.message);
      } finally {
        state.sessionsLoading = false;
      }
    }
    function onSessionSearch() { debounceSearch('session', loadSessions); }
    async function revokeSession(s) {
      const name = s.admin_username || s.factory_username || s.customer_name || ('会话 #' + s.id);
      if (!(await ui.confirm(`确认强制下线「${name}」？\n该设备的登录态将立即失效，需重新登录。`))) return;
      try {
        await api.revokeSession(s.id);
        await loadSessions();
      } catch (err) {
        if (err.code !== 401) alert('强制下线失败：' + err.message);
      }
    }

    // ===== F-57 服务费台账（管理端） =====
    async function loadFeeLedger() {
      state.feeLedgerLoading = true;
      try {
        const data = await api.feeLedger({ status: state.feeLedgerStatus || undefined });
        state.feeLedger = (data && data.list) || [];
        state.feeLedgerTotal = (data && data.total) || 0;
        state.feeLedgerSum = (data && data.feeTotal) || 0;
      } catch (err) {
        if (err.code !== 401) alert('台账加载失败：' + err.message);
      } finally {
        state.feeLedgerLoading = false;
      }
    }
    async function settleLedgerItem(l) {
      if (!(await ui.confirm(`确认订单「${l.order_no}」的服务费 ¥${formatMoney(l.fee_amount)} 已结算？`))) return;
      try {
        await api.settleFeeLedger(l.id);
        await loadFeeLedger();
      } catch (err) {
        if (err.code !== 401) alert('结算标记失败：' + err.message);
      }
    }

    // ===== F-158 工厂员工操作日志（管理端从工厂列表进入查看） =====
    const OP_LOG_ACTIONS = [
      { code: 'login', name: '登录' },
      { code: 'login_abnormal', name: '异常登录' },
      { code: 'accept', name: '接单' },
      { code: 'decline', name: '拒单' },
      { code: 'order_confirm', name: '确认订单' },
      { code: 'order_produce', name: '开始生产' },
      { code: 'order_ship', name: '发货' },
      { code: 'order_cancel', name: '取消订单' },
      { code: 'order_sample_send', name: '寄样' },
      { code: 'order_sample_confirm', name: '确认样品' },
      { code: 'offline_paid', name: '确认收款' },
      { code: 'pricing', name: '修改定价' },
      { code: 'override', name: '价格覆盖' },
      { code: 'staff_add', name: '新增员工' },
      { code: 'staff_edit', name: '编辑员工' },
      { code: 'staff_toggle', name: '启停员工' },
      { code: 'staff_delete', name: '删除员工' },
      { code: 'refund_apply', name: '申请退款' },
      { code: 'refund_confirm', name: '确认退款' },
    ];
    function opLogActionLabel(code) {
      const hit = OP_LOG_ACTIONS.find((a) => a.code === code);
      return hit ? hit.name : code;
    }
    function openFactoryOpLogs(f) {
      state.opLogModal.factoryId = f.id;
      state.opLogModal.factoryName = f.name;
      state.opLogModal.username = '';
      state.opLogModal.action = '';
      state.opLogModal.open = true;
      loadFactoryOpLogs();
    }
    async function loadFactoryOpLogs() {
      if (!state.opLogModal.factoryId) return;
      state.opLogModal.loading = true;
      try {
        const data = await api.factoryOpLogs(state.opLogModal.factoryId, {
          username: state.opLogModal.username || undefined,
          action: state.opLogModal.action || undefined,
        });
        state.opLogModal.list = (data && data.list) || [];
      } catch (err) {
        if (err.code !== 401) alert('日志加载失败：' + err.message);
      } finally {
        state.opLogModal.loading = false;
      }
    }
    function onOpLogSearch() { debounceSearch('oplog', loadFactoryOpLogs); }
    function closeFactoryOpLogs() { state.opLogModal.open = false; }

    // ===== 027 设备图文审核：弹窗展示该厂全部图文（含待审/驳回），支持通过/驳回 =====
    const MEDIA_TYPE_TEXT = { equipment: '设备', workshop: '车间', product: '样品' };
    const mediaTypeLabel = (t) => MEDIA_TYPE_TEXT[t] || t;
    function openFactoryMedia(f) {
      state.mediaModal.factoryId = f.id;
      state.mediaModal.factoryName = f.name;
      state.mediaModal.open = true;
      loadFactoryMedia();
    }
    async function loadFactoryMedia() {
      if (!state.mediaModal.factoryId) return;
      state.mediaModal.loading = true;
      try {
        const data = await api.factoryMedia(state.mediaModal.factoryId);
        state.mediaModal.list = (data && data.list) || [];
      } catch (err) {
        if (err.code !== 401) alert('图文加载失败：' + err.message);
      } finally {
        state.mediaModal.loading = false;
      }
    }
    async function auditMedia(m, action) {
      const label = action === 'approve' ? '通过' : '驳回';
      const tip = action === 'reject' ? '\n驳回将删除该图片文件，不可恢复。' : '';
      if (!(await ui.confirm(`确认${label}这张${mediaTypeLabel(m.media_type)}图片？${tip}`))) return;
      try {
        await api.factoryMediaAudit(m.id, action);
        await loadFactoryMedia();
      } catch (err) {
        if (err.code !== 401) alert(label + '失败：' + err.message);
      }
    }
    function closeFactoryMedia() { state.mediaModal.open = false; }

    // F-147/F-173：登出所有设备（logout-all 按请求头识别身份，api.request 自动携带）
    async function logoutAllDevices() {
      if (!(await ui.confirm('确认登出所有设备？所有设备的登录态都将失效，本机需重新登录。'))) return;
      try { await api.request('/api/auth/logout-all', { method: 'POST', body: {} }); } catch (e) { /* 会话已失效也照常本地清理 */ }
      api.clearFactoryAuth();
      api.clearToken();
      api.setLoginType('');
      location.reload();
    }

    async function logoutAdmin() {
      if (!(await ui.confirm('确认退出登录？'))) return;
      // stage14 SaaS：工厂视图清除工厂会话
      if (state.isFactoryMode) {
        api.clearFactoryAuth();
        api.setLoginType('');
        location.reload();
        return;
      }
      try { await api.adminLogout(); } catch (e) { /* 令牌已失效也照常退出 */ }
      api.clearToken();
      location.reload();
    }

    // 029：进入数据概览时实时重拉看板统计（loadAll 只在登录时拉一次，停用工厂后数字会旧）
    async function loadDashStats() {
      try {
        state.stats = await api.dashboardStats();
      } catch (err) {
        if (err.code !== 401) console.error('看板统计刷新失败:', err);
      }
    }

    async function loadAll() {
      try {
        const [catalog, catalogAll, factories, dashStats, me, adminUsers] = await Promise.all([
          api.catalog(),
          api.catalogAll(),
          api.factories(true),
          api.dashboardStats(),
          api.adminMe(),
          api.users(),
        ]);
        state.catalog = catalog;
        state.catalogAll = catalogAll;
        state.factories = factories;
        // 看板统计统一来自统计接口（含金额 / 状态分布 / 趋势）
        state.stats = dashStats;
        state.currentUser = me;
        state.adminUsers = adminUsers || [];
        // stage16：业务列表按第 1 页分页加载（每页 20 条，总量大时不再一次拉全表）
        await Promise.all([loadQuotesPage(1), loadOrdersPage(1), loadInquiriesPage(1), loadCustomersPage(1)]);
      } catch (err) {
        console.error(err);
        // 401 时登录遮罩会自动弹出，不再额外弹窗打断
        if (err.code !== 401) alert('加载失败：' + err.message + '\n请确认后端服务已启动');
      }
    }

    // 计算器参数组装：材料类型按目录判定（含塑料薄膜），并携带 Stage7 扩展参数
    function buildCalcBody() {
      const f = state.calcForm;
      const code = f.materialCode;
      const catalogMap = calcCatalog.value || {};
      const materialType =
        (catalogMap.plasticFilm && catalogMap.plasticFilm[code]) ? 'plasticFilm' :
        (catalogMap.boardPaper && catalogMap.boardPaper[code]) ? 'boardPaper' : 'cardPaper';
      // 020 印刷配置 → 引擎色数/专色（与小程序 quote 页同口径）
      const pc = f.printConfig || 'cmyk';
      let spotN = Math.max(0, Math.min(6, parseInt(f.spotColors, 10) || 0));
      if (pc !== 'cmyk' && spotN < 1) spotN = 1;
      const body = {
        factoryId: state.currentFactoryId,
        productType: f.productType,
        printMode: f.printMode,
        lengthM: f.lengthMm / 1000,
        widthM: f.widthMm / 1000,
        heightM: f.heightMm / 1000,
        quantity: f.quantity,
        materialType,
        materialCode: code,
        colorCount: pc === 'spot' ? spotN : 4,
        processes: f.processes,
        boxType: f.boxType || 'normal',
        nUp: f.nUp > 1 ? parseInt(f.nUp, 10) : 1,
        // 016 印刷参数：图案覆盖率/油墨类型/专色数量
        patternCover: f.patternCover || 'mid',
        inkType: f.inkType || 'NORMAL',
        spotColors: pc === 'cmyk+spot' ? spotN : 0,
      };
      if (f.productType === 'flexiblePackaging') {
        body.filmLayers = f.filmLayers || 1;
        body.filmCodes = [code];
        body.moldFee = f.moldFee || 0;
        body.knifeFee = f.knifeFee || 0;
      }
      // 025 客户折扣：预览与保存都带 customerId，后端按客户档案折扣计价
      body.customerId = f.customerId || 0;
      return body;
    }

    async function doQuote() {
      state.calculating = true;
      try {
        state.calcResult = await api.quote(buildCalcBody());
      } catch (err) {
        alert('报价失败：' + err.message);
      } finally {
        state.calculating = false;
      }
    }

    // ===== 025 客户折扣：计算器选客户后，预览与保存均按客户档案折扣比例计价 =====
    // 025b 客户按工厂隔离：客户下拉只显示「平台公共客户（factory_id=0）+ 当前计价工厂的客户」
    // 026：工厂模式计价工厂锁定本厂（服务端按令牌强制），作用域取 factoryAuth.factoryId
    const calcFactoryScopeId = computed(() =>
      state.isFactoryMode ? ((state.factoryAuth || {}).factoryId || 0) : (state.currentFactoryId || 0));
    const calcCustomers = computed(() => {
      const fid = calcFactoryScopeId.value;
      return state.customers.filter((c) => {
        const cfid = Number(c.factory_id) || 0;
        return cfid === 0 || cfid === fid;
      });
    });
    const calcCustomer = computed(() =>
      state.customers.find((c) => c.id === state.calcForm.customerId) || null);
    function onCalcCustomerChange() {
      // 已有计算结果时切换客户，立即按新折扣刷新预览，避免「看到牌价、保存变折后价」
      if (state.calcResult) doQuote();
    }

    async function saveQuote() {
      if (!state.calcResult) return;
      try {
        await api.saveQuote(buildCalcBody());
        alert('保存成功');
        loadAll();
      } catch (err) {
        alert('保存失败：' + err.message);
      }
    }

    async function viewOverrides(factoryId) {
      state.activeFactory = state.factories.find((f) => f.id === factoryId);
      state.activeOverrides = await api.overrides(factoryId);
    }

    // ===== stage14 工厂邀请码：弹窗列表 + 生成 =====
    async function openInviteCodes(f) {
      state.inviteCodeModal.factoryId = f.id;
      state.inviteCodeModal.factoryName = f.name;
      state.inviteCodeModal.open = true;
      await loadInviteCodes();
    }
    async function loadInviteCodes() {
      try {
        const res = await api.factoryInviteCodes(state.inviteCodeModal.factoryId);
        state.inviteCodeModal.list = (res && res.list) || [];
      } catch (err) {
        if (err.code !== 401) alert('加载邀请码失败：' + err.message);
      }
    }
    async function createInviteCode() {
      try {
        const res = await api.factoryCreateInviteCode(state.inviteCodeModal.factoryId);
        alert('已生成邀请码：' + res.code + '（微信用户「我的 → 我是工厂」输码绑定）');
        await loadInviteCodes();
      } catch (err) {
        alert('生成失败：' + err.message);
      }
    }

    async function addOverride() {
      if (!state.activeFactory) return alert('请先选择工厂');
      const o = state.newOverride;
      if (!o.targetCode || !o.fieldName) return alert('请填写编码和字段');
      try {
        await api.addOverride({
          factoryId: state.activeFactory.id,
          targetType: o.targetType,
          targetCode: o.targetCode,
          fieldName: o.fieldName,
          fieldValue: o.fieldValue,
        });
        state.activeOverrides = await api.overrides(state.activeFactory.id);
        state.newOverride.targetCode = '';
        state.newOverride.fieldValue = 0;
      } catch (err) {
        alert('新增失败：' + err.message);
      }
    }

    async function removeOverride(targetType, targetCode, fieldName) {
      if (!(await ui.confirm('确认删除此覆盖？'))) return;
      try {
        await api.deleteOverride({
          factoryId: state.activeFactory.id,
          targetType, targetCode, fieldName,
        });
        state.activeOverrides = await api.overrides(state.activeFactory.id);
      } catch (err) {
        alert('删除失败：' + err.message);
      }
    }

    function onFactoryChange() {
      // 工厂变化时刷新目录（可选）
    }

    // ===== stage16 计价工厂搜索选择器（工厂多时长列表难翻，支持按名称/编码搜索） =====
    const currentFactoryLabel = computed(() => {
      if (!state.currentFactoryId) return '系统默认价（平台统一价格）';
      const f = state.factories.find((x) => x.id === state.currentFactoryId);
      return f ? f.name : '系统默认价（平台统一价格）';
    });
    const filteredFactoryOptions = computed(() => {
      const list = activeFactories.value;
      const kw = (state.factoryKeyword || '').trim().toLowerCase();
      if (!kw) return list;
      return list.filter((f) =>
        (f.name || '').toLowerCase().includes(kw) ||
        (f.code || '').toLowerCase().includes(kw) ||
        String(f.id) === kw
      );
    });
    function toggleFactoryPicker() {
      state.factoryPickerOpen = !state.factoryPickerOpen;
      if (state.factoryPickerOpen) {
        state.factoryKeyword = '';
        // 打开后聚焦搜索框，直接打字即可过滤
        setTimeout(() => {
          const el = document.querySelector('.factory-picker-search');
          if (el && el.focus) el.focus();
        }, 0);
      }
    }
    function pickFactory(id) {
      state.currentFactoryId = id;
      state.factoryPickerOpen = false;
      onFactoryChange();
      // 025b：切换计价工厂后，已选客户若不属于「该工厂 + 平台公共」范围则重置，并按新口径刷新预览
      if (state.calcForm.customerId && !calcCustomers.value.some((c) => c.id === state.calcForm.customerId)) {
        state.calcForm.customerId = 0;
        if (state.calcResult) doQuote();
      }
    }

    // ===== stage16 目录数据页顶部分组标签（点标签只看该组，不再一路下划） =====
    function setCatalogTab(key) {
      state.catalogTab = key;
      setTimeout(() => {
        const el = document.querySelector('.catalog-page');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
      }, 0);
    }

    // stage14 SaaS：按登录身份分流初始化（工厂视图不加载任何 admin 数据，天然隔离）
    onMounted(() => {
      // stage16：点页面其他位置时收起工厂选择器（选择器内部已阻止冒泡）
      document.addEventListener('click', () => { state.factoryPickerOpen = false; });
      if (api.getLoginType() === 'factory' && api.getFactoryAuth()) {
        state.isFactoryMode = true;
        state.factoryAuth = api.getFactoryAuth();
        state.page = 'dashboard'; // 工厂模式首页=我的数据
        loadFactoryData();
        loadFactoryStats();
      } else {
        loadAll();
      }
    });

    return {
      ...toRefs(state), pageTitle, materialCount, recentQuotes, activeFactories, hasOverrides, catalogGroups,
      NAV_MENU, visibleMenu, menuGroups, menuTitle, hasPerm, toggleSidebar,
      // stage15c 多标签页 + 分组折叠 + 设备/IP 可读化
      tabTitle, closeTab, toggleGroup, isGroupCollapsed, formatDevice, formatIp,
      goto, getCell, extractTotal, factoryName, doQuote, saveQuote, viewOverrides, addOverride,
      removeOverride, onFactoryChange, productTypeLabel, statusLabel, finishingModeLabel,
      // 025 客户折扣
      calcCustomer, calcCustomers, onCalcCustomerChange,
      // 026 工厂端计算器目录来源
      calcCatalog,
      printModeLabel, rateModeLabel, targetTypeLabel, fieldNameLabel, currentOverrideFields, formatTime,
      productConfig, isPrintModeAllowed, isMaterialAllowed, isProcessAllowed, materialGroups,
      catalogEditor, catalogEditorColumns, catalogEditorKeyCol, openCatalogEditor, saveCatalogItem, toggleCatalogItem, refreshCatalog,
      capabilityEditor, CAP_OPTIONS, editCapability, toggleCapability, saveCapability,
      factoryEditor, openFactoryEditor, saveFactory, toggleFactoryStatus,
      factoryAudit, auditStatusLabel, auditStatusStyle, pendingCount,
      openInviteCodes, loadInviteCodes, createInviteCode,
      customerEditor, openCustomerEditor, onCustomerLevelChange, saveCustomer, removeCustomer,
      removeQuote, removeInquiry, exportQuotes, exportInquiries, exportCustomers,
      ORDER_STATUS_TEXT, orderStatusLabel, orderStatusStyle, orderActions, filteredOrders, adminOrderAction,
      ORDER_STATUS_KEYS, recentOrders, formatMoney, barHeight, distPct, distColor,
      isSuper, userEditor, openUserEditor, saveUser, toggleUserStatus, resetUserPassword,
      // F-152~F-160 工厂多账号 + F-173 顶部角色信息
      FACTORY_ROLE_TEXT, canManageStaff, staffEditor, loadStaffs, openStaffEditor, saveStaff,
      toggleStaffStatus, resetStaffPwd, removeStaff,
      roleBadge, displayName, factoryStats, loadFactoryStats, factoryAcceptRate, factoryAvgResponse, factoryPendingInquiries,
      changeMyPassword, logoutAdmin, logoutAllDevices,
      // F-148/150 在线设备 + F-57 服务费台账 + F-158 工厂操作日志
      SESSION_TYPE_TEXT, loadSessions, onSessionSearch, revokeSession,
      loadFeeLedger, settleLedgerItem,
      OP_LOG_ACTIONS, opLogActionLabel, openFactoryOpLogs, loadFactoryOpLogs, onOpLogSearch, closeFactoryOpLogs,
      // 027 设备图文审核 + 验真徽章
      mediaTypeLabel, openFactoryMedia, loadFactoryMedia, auditMedia, closeFactoryMedia,
      // Stage13 物流履约
      EXPRESS_COMPANIES, SHIPPING_MODE_TEXT, openShipModal, submitShip, openLogisticsViewer,
      shippingRuleText, openShippingEditor, saveShipping, toggleShipping, setDefaultShipping,
      // stage14 SaaS 工厂视图 + 列表搜索
      // （isFactoryMode/factoryAuth/factoryPricing/pricingForm/factoryNewOverride/factoryCatalogOpts
      //   均为 state 属性，由上方 toRefs 暴露；此处只补方法与计算属性）
      doOrderAction, adminConfirmRefund, factoryMarkOfflinePaid,
      factoryOverrideFields,
      overrideRowCount, overrideItemName, saveFactoryPricing, addFactoryOverride, removeFactoryOverride,
      onOrderSearch, onQuoteSearch, onInquirySearch, onCustomerSearch,
      // stage16 列表分页 + 计价工厂搜索选择器 + 目录页分组标签
      LIST_PAGE_SIZE, loadQuotesPage, loadOrdersPage, loadInquiriesPage, loadCustomersPage,
      quotePages, orderPages, inquiryPages, customerPages, onOrderFilterChange,
      currentFactoryLabel, filteredFactoryOptions, toggleFactoryPicker, pickFactory, setCatalogTab,
      // 021/022 设计稿展示
      designImgs, designBadge, openDesignImg, designPdf,
    };
  },
});

app.mount('#app');