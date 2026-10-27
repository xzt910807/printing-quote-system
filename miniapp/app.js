const api = require('./utils/api');

App({
  globalData: {
    factoryId: 1,       // 当前工厂ID（工厂端使用）
    userAuth: null,     // C端用户登录态 { userId, openid, nickname, avatarUrl, phone, token, devMode, role, factoryId }
    role: 'customer',   // stage14 身份分流：customer=普通客户 factory=工厂（tabBar 过滤依据）
    subscribeTmplIds: [], // 订阅消息模板ID（启动时从 /api/c/config 拉取，未配置时为空）
    newsSubscribeTmplId: '', // 032 资讯订阅消息模板 ID（news 页订阅后弹授权）
    tabBadge: {},        // tabBar 徽标 { inquiry: 待接单数, mine: 未读消息数 }
    agreed: false,       // F-85：是否已同意用户协议+隐私政策（未同意不发起登录）
  },

  onLaunch(options) {
    console.log('印刷报价小程序启动');
    // F-102 工厂专属小程序码：scene=f_{factoryId}，扫码直达报价页并锁定该厂询价
    const scene = options && options.query && options.query.scene;
    if (scene) {
      const m = String(decodeURIComponent(scene)).match(/^f_(\d+)$/);
      if (m) {
        wx.setStorageSync('entryFactoryId', parseInt(m[1], 10));
        console.log('[F-102] 扫码进入，锁定工厂 id=' + m[1]);
      }
    }
    this.globalData.agreed = !!wx.getStorageSync('termsAgreedAt');
    this.loadPublicConfig();
    if (this.globalData.agreed) {
      this.ensureLogin();
    } else {
      // F-85：未同意协议前静默启动不登录；由首页协议弹窗勾选后调用 agreeTerms() 补发登录
      console.log('未同意用户协议，等待用户勾选');
    }
  },

  /** F-85：用户勾选同意协议后调用——记录同意时间并补发登录 */
  agreeTerms() {
    wx.setStorageSync('termsAgreedAt', Date.now());
    this.globalData.agreed = true;
    return this.ensureLogin();
  },

  /** 拉取后端公开配置（订阅消息模板ID等；失败静默，不阻塞启动） */
  loadPublicConfig() {
    api.request('/api/c/config')
      .then((res) => {
        this.globalData.subscribeTmplIds = (res.data && res.data.subscribeTmplIds) || [];
        this.globalData.newsSubscribeTmplId = (res.data && res.data.newsSubscribeTmplId) || '';
      })
      .catch(() => { /* 后端未启动等情况：保持空数组 */ });
  },

  /**
   * 静默登录：优先复用本地登录态；否则 wx.login 换后端凭证。
   * 后端未配置微信密钥时自动降级为开发身份（devMode=true，便于本地调试）。
   */
  ensureLogin() {
    return new Promise((resolve) => {
      const cached = wx.getStorageSync('userAuth');
      if (cached && cached.token) {
        this.globalData.userAuth = cached;
        // stage14：缓存的老数据可能无 role 字段，兜底 customer
        const role = cached.role || wx.getStorageSync('role') || 'customer';
        wx.setStorageSync('role', role);
        // 新登录的缓存带绑定厂名：顺手自愈 storage（老缓存无此字段则保持现状，由 mine 页 /me 兜底刷新）
        if (cached.factoryName !== undefined) wx.setStorageSync('factoryName', cached.factoryName);
        this.globalData.role = role;
        this.bindAnonymousInquiries(); // 认领登录前本地记录的匿名询价
        return resolve(cached);
      }
      wx.login({
        success: async (r) => {
          try {
            const res = await api.request('/api/auth/user-login', {
              method: 'POST',
              data: { code: r.code, devId: 'dev-default' },
            });
            wx.setStorageSync('userAuth', res.data);
            this.globalData.userAuth = res.data;
            // stage14 身份分流：role/factoryId/factoryName 落 storage（tabBar/mine 依据），user-login 已返回
            const role = res.data.role || 'customer';
            wx.setStorageSync('role', role);
            if (res.data.factoryId) {
              wx.setStorageSync('factoryId', res.data.factoryId);
              wx.setStorageSync('factoryName', res.data.factoryName || '');
            } else {
              // 服务端已无绑定（解绑/驳回）：清除本地残留，防 mine 页显示陈旧厂名
              wx.removeStorageSync('factoryId');
              wx.removeStorageSync('factoryName');
            }
            this.globalData.role = role;
            this.bindAnonymousInquiries(); // 认领登录前本地记录的匿名询价
            resolve(res.data);
          } catch (e) {
            console.error('登录失败:', e.message || e);
            resolve(null);
          }
        },
        fail: () => resolve(null),
      });
    });
  },

  /** 登录成功后认领本地记录的匿名询价（登录前的匿名报价单并入「我的」列表） */
  bindAnonymousInquiries() {
    const ids = wx.getStorageSync('anonInquiryIds');
    if (!ids || !ids.length) return;
    api.request('/api/c/bind-inquiries', { method: 'POST', data: { ids } })
      .then(() => wx.removeStorageSync('anonInquiryIds'))
      .catch(() => { /* 网络失败：保留记录，下次登录再认领 */ });
  },

  /** 退出登录（先作废服务端会话，再清除本地登录态） */
  async logout() {
    try {
      const auth = wx.getStorageSync('userAuth');
      if (auth && auth.token) {
        await api.request('/api/auth/user-logout', { method: 'POST', data: {} });
      }
    } catch (e) {
      // 服务端登出失败（网络异常等）不影响本地退出
    }
    wx.removeStorageSync('userAuth');
    this.globalData.userAuth = null;
  },
});
