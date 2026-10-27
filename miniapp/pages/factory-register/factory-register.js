const api = require('../../utils/api');

Page({
  data: {
    // 自定义导航栏高度（与其他页面同一套算法）
    statusBarHeight: 20,
    navBarHeight: 44,
    form: { name: '', contact: '', phone: '', address: '', intro: '', username: '', password: '', confirm: '' },
    submitting: false,
    success: false,
    bound: false,
    code: '',
  },

  // 从「我的 → 我是工厂 → 申请入驻」进入时已登录：联系人/电话带入微信资料，减少填写
  onLoad() {
    // 自定义导航栏高度（与其他页面同一套算法）
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const navBarHeight = (menu.top - info.statusBarHeight) * 2 + menu.height;
      this.setData({ statusBarHeight: info.statusBarHeight, navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }

    try {
      const auth = wx.getStorageSync('userAuth');
      if (auth && auth.userId) {
        this.setData({
          'form.contact': auth.nickname || '',
          'form.phone': auth.phone || '',
        });
      }
    } catch (e) { /* 未登录（接单页注册入口进入）则留空 */ }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  async submit() {
    const f = this.data.form;
    if (!f.name) return wx.showToast({ title: '请填写工厂名称', icon: 'none' });
    if (!/^[a-zA-Z0-9_]{4,50}$/.test(f.username || '')) {
      return wx.showToast({ title: '账号需为 4-50 位字母、数字或下划线', icon: 'none' });
    }
    if (!f.password || f.password.length < 6) return wx.showToast({ title: '密码至少 6 位', icon: 'none' });
    if (f.password !== f.confirm) return wx.showToast({ title: '两次密码输入不一致', icon: 'none' });
    this.setData({ submitting: true });
    try {
      const res = await api.request('/api/factory/register', {
        method: 'POST',
        data: {
          name: f.name, contact: f.contact, phone: f.phone, address: f.address,
          intro: f.intro, username: f.username, password: f.password,
        },
      });
      const d = res.data || {};
      this.setData({ success: true, code: d.code, bound: !!d.bound });
      // 登录态下提交：服务端已把当前微信账号绑定为该厂（待审核），同步本地身份缓存，
      // 返回「我的」页后 tabBar 出现「接单」入口，审核通过即可微信一键登录
      if (d.bound) {
        // 清掉本地残留的其他工厂会话（旧会话指向旧厂，会造成"登录显示别的工厂"）
        wx.removeStorageSync('factoryAuth');
        wx.setStorageSync('role', 'factory');
        wx.setStorageSync('factoryId', d.id);
        wx.setStorageSync('factoryName', d.factoryName || '');
        const app = getApp();
        if (app && app.globalData) app.globalData.role = 'factory';
        const auth = wx.getStorageSync('userAuth');
        if (auth && auth.token) {
          const next = { ...auth, role: 'factory', factoryId: d.id };
          wx.setStorageSync('userAuth', next);
          if (app && app.globalData) app.globalData.userAuth = next;
        }
        if (d.wxReassigned) {
          wx.showToast({ title: '微信一键登录已切换到本厂', icon: 'none' });
        }
      }
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goLogin() {
    wx.navigateBack();
  },

  // 返回上一页（自定义导航栏无原生返回按钮）
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },
});
