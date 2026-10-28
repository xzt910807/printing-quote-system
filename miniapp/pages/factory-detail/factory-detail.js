const api = require('../../utils/api');
const { getAvatarConfig } = require('../../utils/avatar');

// 印刷方式编码 → 中文（与 factory-me CAP_OPTIONS 一致）
const PRINT_MODE_TEXT = {
  offset: '胶印', flexo: '柔印', gravure: '凹印', digital: '数码印', screen: '丝印',
};

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
    media: [],           // 设备/车间图文图集
    avatarText: '厂',
    avatarColor: '#94a3b8',
    // 033 供应商关注：工厂详情页是"关注"的唯一主动入口（供应商列表里只有取关）
    followed: false,
    followLoading: false,
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
    if (this.data.factoryId && !this.data.loading) this.loadFollowState(this.data.factoryId);
  },

  async loadDetail(id) {
    this.setData({ loading: true });
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
        avatarText: avatar.text,
        avatarColor: avatar.color,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 拨打工厂电话（F-30：找厂公开详情电话已脱敏，引导走询价看价流程获取全文）
  callFactory() {
    const phone = this.data.info && this.data.info.phone;
    if (!phone) {
      wx.showToast({ title: '暂无联系电话', icon: 'none' });
      return;
    }
    if (String(phone).indexOf('*') >= 0) {
      wx.showModal({
        title: '联系方式已保护',
        content: '向该工厂发起询价、查看报价后即可获取完整联系方式',
        confirmText: '去询价',
        cancelText: '知道了',
        success: (r) => { if (r.confirm) this.quoteToFactory(); },
      });
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

  // 图集大图预览
  previewMedia(e) {
    const index = parseInt(e.currentTarget.dataset.index, 10) || 0;
    const urls = this.data.media.map((m) => this.data.apiBase + m.url);
    if (!urls.length) return;
    wx.previewImage({ current: urls[index], urls });
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
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/factories/factories' }) });
  },
});
