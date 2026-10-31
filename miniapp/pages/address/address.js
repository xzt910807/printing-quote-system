const api = require('../../utils/api');

// 收货地址簿（stage13）：订单用的是支付时的地址快照，改地址簿不影响历史订单
// 省市区数据（utils/regions.js）已收进 components/region-picker，本页不再持有
Page({
  data: {
    // 自定义导航栏高度（与其他页面同一套算法）
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: false,
    addresses: [],
    showForm: false,
    form: {
      id: null, contactName: '', contactPhone: '',
      province: '', city: '', district: '', detailAddress: '',
      isDefault: false,
    },
    // stage14 省市区：弹层开关 + 回显值（交给 region-picker 组件按名字反查下标）
    regionShow: false,
    regionValue: ['', '', ''],
    regionText: '',
  },

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
  },

  // 地区弹层：三列数据与联动都在 region-picker 组件里，这里只负责开关、回显、回写表单
  openRegionPicker() {
    const f = this.data.form;
    this.setData({ regionShow: true, regionValue: [f.province || '', f.city || '', f.district || ''] });
  },

  closeRegionPicker() {
    this.setData({ regionShow: false });
  },

  onRegionConfirm(e) {
    const { province, city, district } = e.detail || {};
    const names = [province || '', city || '', district || ''];
    this.setData({
      regionShow: false,
      regionValue: names,
      regionText: names.filter(Boolean).join(' '),
      'form.province': names[0],
      'form.city': names[1],
      'form.district': names[2],
    });
  },

  // 打开表单时回显：把已存的省市区交给组件反查下标
  resetRegionPicker(item) {
    const names = item && item.province
      ? [item.province, item.city || '', item.district || '']
      : ['', '', ''];
    this.setData({
      regionValue: names,
      regionText: names.filter(Boolean).join(' '),
    });
  },

  onShow() {
    this.loadAddresses();
  },

  onPullDownRefresh() {
    this.loadAddresses().finally(() => wx.stopPullDownRefresh());
  },

  async loadAddresses() {
    this.setData({ loading: true });
    try {
      const res = await api.request('/api/c/my-addresses');
      this.setData({ addresses: res.data.list || [] });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openForm(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.addresses || []).find((a) => a.id === id);
    const form = item
      ? {
          id: item.id, contactName: item.contact_name, contactPhone: item.contact_phone,
          province: item.province || '', city: item.city || '', district: item.district || '',
          detailAddress: item.detail_address, isDefault: !!item.is_default,
        }
      // 第一条地址自动建议设为默认
      : {
          id: null, contactName: '', contactPhone: '',
          province: '', city: '', district: '', detailAddress: '',
          isDefault: !(this.data.addresses || []).length,
        };
    this.setData({ showForm: true, form });
    // stage14 回显省市区选择器
    this.resetRegionPicker(item);
  },

  closeForm() {
    this.setData({ showForm: false });
  },

  // 阻止弹层内点击冒泡到遮罩（空字符串绑定无效，需真实空函数）
  noop() {},

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onDefaultChange(e) {
    this.setData({ 'form.isDefault': !!e.detail.value });
  },

  async saveAddress() {
    const f = this.data.form;
    if (!f.contactName || !f.contactName.trim()) return wx.showToast({ title: '请填写联系人姓名', icon: 'none' });
    if (!/^1[3-9]\d{9}$/.test((f.contactPhone || '').trim())) return wx.showToast({ title: '请填写正确的手机号', icon: 'none' });
    if (!f.province || !f.city) return wx.showToast({ title: '请选择省市区', icon: 'none' });
    if (!f.detailAddress || !f.detailAddress.trim()) return wx.showToast({ title: '请填写详细地址', icon: 'none' });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      await api.request('/api/c/address', {
        method: 'POST',
        data: {
          id: f.id, contactName: f.contactName.trim(), contactPhone: f.contactPhone.trim(),
          province: f.province, city: f.city, district: f.district,
          detailAddress: f.detailAddress.trim(), isDefault: !!f.isDefault,
        },
      });
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ showForm: false });
      this.loadAddresses();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 设为默认：后端更新分支要求全字段，带上原地址字段 + setDefault 标记
  async setDefault(e) {
    const item = (this.data.addresses || []).find((a) => a.id === e.currentTarget.dataset.id);
    if (!item || item.is_default) return;
    try {
      await api.request('/api/c/address', {
        method: 'POST',
        data: {
          id: item.id, contactName: item.contact_name, contactPhone: item.contact_phone,
          province: item.province, city: item.city, district: item.district,
          detailAddress: item.detail_address, setDefault: true,
        },
      });
      wx.showToast({ title: '已设为默认', icon: 'success' });
      this.loadAddresses();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  removeAddress(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除地址',
      content: '确认删除该收货地址？历史订单的地址快照不受影响。',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await api.request('/api/c/address/' + id, { method: 'DELETE' });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadAddresses();
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },

  // 返回上一页（自定义导航栏无原生返回按钮）
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },
});
