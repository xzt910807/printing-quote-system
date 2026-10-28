const api = require('../../utils/api');
const { productName } = require('../../utils/productText');
const {
  ORDER_STATUS_TEXT, PAY_STATUS_TEXT, ORDER_STEPS, ORDER_STEP_INDEX,
  badgeClass, formatTime,
} = require('../../utils/orderText');

// 金额格式化（保留两位; null/空按 0.00）
const money = (v) => (v == null || v === '' ? '0.00' : Number(v).toFixed(2));

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    apiBase: api.BASE_URL,
    orderId: 0,
    loading: false,
    order: null,
    orderSteps: ORDER_STEPS,
  },

  onLoad(options) {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      this.setData({
        statusBarHeight: info.statusBarHeight,
        navBarHeight: (menu.top - info.statusBarHeight) * 2 + menu.height,
      });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
    const orderId = parseInt((options && options.id) || '0', 10) || 0;
    this.setData({ orderId });
  },

  // 首次进入与从支付/物流/地址页返回均重拉, 保证状态与金额最新
  onShow() {
    if (this.data.orderId) this.loadDetail();
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  async loadDetail() {
    if (!this.data.orderId) return;
    this.setData({ loading: true });
    try {
      const res = await api.request(`/api/c/order/${this.data.orderId}`);
      const o = res.data || {};
      const total = Number(o.total_price) || 0;
      const ship = Number(o.shipping_fee) || 0;
      const sample = Number(o.sample_fee) || 0;
      const order = Object.assign({}, o, {
        statusText: ORDER_STATUS_TEXT[o.status] || o.status,
        badgeClass: badgeClass(o.status),
        stepIndex: ORDER_STEP_INDEX[o.status] || 0,
        payText: PAY_STATUS_TEXT[o.pay_status] || '未支付',
        productText: productName(o.product_type) || '-',
        // 生产参数标签（印刷方式/尺寸/材质/色数）, 后端已解析中文, 空项过滤
        specTags: [o.printModeText, o.sizeText, o.materialText, o.colorText].filter(Boolean),
        totalPriceText: money(o.total_price),
        shippingFeeText: money(o.shipping_fee),
        sampleFeeText: money(o.sample_fee),
        grandTotalText: money(total + ship + sample),
        createdText: formatTime(o.created_at),
        paidText: formatTime(o.paid_at),
        shippedText: formatTime(o.shipped_at),
        rated: !!o.rating,
        ratingText: o.rating ? '★'.repeat(Math.max(1, Math.round(Number(o.rating)))) : '',
        // 操作可见性（与 mine 列表卡同一套判定口径）
        canPay: o.pay_status !== 'paid' && o.status !== 'cancelled' && !['refunding', 'refunded'].includes(o.pay_status),
        canCancel: ['pending', 'confirmed'].includes(o.status),
        canConfirmSample: o.status === 'sampling',
        canComplete: o.status === 'shipped',
        canRefund: o.pay_status === 'paid' && ['pending', 'confirmed'].includes(o.status),
        canRate: o.status === 'completed' && !o.rating,
        canLogistics: ['shipped', 'completed'].includes(o.status),
      });
      this.setData({ order });
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
  },

  copyNo() {
    const no = this.data.order && this.data.order.order_no;
    if (no) wx.setClipboardData({ data: String(no), success: () => wx.showToast({ title: '单号已复制', icon: 'success' }) });
  },

  // 设计参考图大图预览
  previewDesignImg(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  // 设计稿 PDF：下载后打开文档（失败回落图片预览）
  openPdf(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.downloadFile({
      url,
      success: (r) => wx.openDocument({ filePath: r.tempFilePath, showMenu: true, fail: () => wx.previewImage({ urls: [url] }) }),
      fail: () => wx.showToast({ title: '文件打开失败', icon: 'none' }),
    });
  },

  goFactoryDetail() {
    const o = this.data.order || {};
    const id = o.factory_id || o.matched_factory_id;
    if (id) wx.navigateTo({ url: '/pages/factory-detail/factory-detail?id=' + id });
  },

  callFactory() {
    const p = this.data.order && this.data.order.factory_phone;
    if (p) wx.makePhoneCall({ phoneNumber: String(p) });
    else wx.showToast({ title: '暂无工厂电话', icon: 'none' });
  },

  goLogistics() {
    wx.navigateTo({ url: '/pages/logistics/logistics?orderId=' + this.data.orderId });
  },

  // 支付：确认地址与金额明细 → 选支付方式（微信 JSAPI / 线下转账 / 模拟）
  async payOrder() {
    const order = this.data.order || {};
    let addresses = [];
    try {
      const res = await api.request('/api/c/my-addresses');
      addresses = res.data.list || [];
    } catch (err) {
      return wx.showToast({ title: err.message, icon: 'none' });
    }
    if (!addresses.length) {
      const r = await new Promise((resolve) => wx.showModal({
        title: '请先添加收货地址', content: '支付前需要确认收货地址，现在去添加？', confirmText: '去添加', success: resolve,
      }));
      if (r.confirm) wx.navigateTo({ url: '/pages/address/address' });
      return;
    }
    const addr = addresses.find((a) => a.is_default) || addresses[0];
    const addrText = (addr.province || '') + (addr.city || '') + (addr.district || '') + (addr.detail_address || '');
    let content = '货款：¥' + order.totalPriceText + '\n运费：¥' + order.shippingFeeText
      + '\n打样费：¥' + order.sampleFeeText + '\n合计：¥' + order.grandTotalText
      + '\n\n收货：' + addr.contact_name + ' ' + addr.contact_phone + '\n' + addrText;
    const res = await new Promise((resolve) => wx.showModal({ title: '确认金额与收货', content, success: resolve }));
    if (!res.confirm) return;
    const sheet = await new Promise((resolve) => wx.showActionSheet({
      itemList: ['微信支付', '线下转账', '模拟支付（测试）'],
      success: (r) => resolve(r.tapIndex), fail: () => resolve(-1),
    }));
    if (sheet < 0) return;
    try {
      if (sheet === 0) {
        const payRes = await api.request(`/api/c/order/${this.data.orderId}/pay`, {
          method: 'POST', data: { payMethod: 'wechat', addressId: addr.id },
        });
        const wp = payRes.data.wxPay;
        await new Promise((resolve, reject) => wx.requestPayment({ ...wp, success: resolve, fail: reject }));
        wx.showToast({ title: '支付成功', icon: 'success' });
      } else if (sheet === 1) {
        await api.request(`/api/c/order/${this.data.orderId}/pay`, {
          method: 'POST', data: { payMethod: 'offline', addressId: addr.id },
        });
        wx.showModal({ title: '已选择线下转账', content: '请与工厂沟通付款方式，工厂确认收款后订单正式生效。', showCancel: false });
      } else {
        await api.request(`/api/c/order/${this.data.orderId}/pay`, {
          method: 'POST', data: { payMethod: 'mock', addressId: addr.id },
        });
        wx.showToast({ title: '支付成功', icon: 'success' });
      }
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 取消订单 / 确认样品 / 确认收货
  async orderAction(e) {
    const { action } = e.currentTarget.dataset;
    const titleMap = { cancel: '取消订单', complete: '确认收货', confirmSample: '确认样品' };
    const contentMap = {
      cancel: '确认取消该订单？',
      complete: '确认已收到货物并完成订单？',
      confirmSample: '确认样品符合要求？确认后工厂将安排生产。',
    };
    const r = await new Promise((resolve) => wx.showModal({
      title: titleMap[action] || '操作确认', content: contentMap[action] || '确认执行该操作？', success: resolve,
    }));
    if (!r.confirm) return;
    try {
      await api.request(`/api/c/order/${this.data.orderId}/status`, { method: 'POST', data: { action } });
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 申请退款（已支付未生产）
  async onApplyRefund() {
    const r = await new Promise((resolve) => wx.showModal({
      title: '申请退款', content: '确认申请退款？提交后需工厂确认，款项将原路退回。',
      confirmText: '申请退款', confirmColor: '#e64340', success: resolve,
    }));
    if (!r.confirm) return;
    try {
      await api.request(`/api/c/order/${this.data.orderId}/refund`, { method: 'POST', data: {} });
      wx.showToast({ title: '已提交退款申请', icon: 'success' });
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  // 订单评分（1-5 星）
  async onRateOrder() {
    const idx = await new Promise((resolve) => wx.showActionSheet({
      itemList: ['1 星（很不满意）', '2 星（不满意）', '3 星（一般）', '4 星（满意）', '5 星（非常满意）'],
      success: (r) => resolve(r.tapIndex), fail: () => resolve(-1),
    }));
    if (idx < 0) return;
    try {
      await api.request(`/api/c/order/${this.data.orderId}/rate`, { method: 'POST', data: { rating: idx + 1 } });
      wx.showToast({ title: '评价成功', icon: 'success' });
      this.loadDetail();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },
});
