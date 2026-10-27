// 通用 web-view 承载页：?url=<encodeURIComponent 后的完整地址>
// 用于展示后端托管的协议静态页（/legal/*.html）等外部文档
Page({
  data: { url: '' },

  onLoad(query) {
    const url = decodeURIComponent(query.url || '');
    if (!url) {
      wx.showToast({ title: '缺少页面地址', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ url });
  },
});
