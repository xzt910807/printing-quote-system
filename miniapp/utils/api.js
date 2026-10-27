// BASE_URL 分流（F-183）：开发者工具/真机预览走本地后端，体验版与正式版自动走线上 HTTPS
// 注意：真机预览时 localhost 指向手机自身，必须写电脑局域网 IP（与手机同 WiFi）
let envVersion = '';
try {
  const info = wx.getAccountInfoSync();
  envVersion = info && info.miniProgram && info.miniProgram.envVersion;
} catch (e) { /* 基础库异常时按线上处理 */ }
// ===== 本地调试后端地址 =====
// 模拟器调试：localhost 即可（指向电脑自身）。
// 真机调试/预览：localhost 指向手机自身，必须写电脑的局域网 IP，且要与手机处于同一网段：
//   本机有线 192.168.1.248 / WLAN 192.168.110.52（DHCP 可能变）——手机走 Wi-Fi，
//   一般应与电脑的 WLAN IP 同网段；电脑换网络后需同步修改这里。
// 注意：真机调试还需在开发者工具勾选「不校验合法域名」（本地设置 + 真机调试面板）。
const DEV_BASE_URL = 'http://192.168.110.134:6001';
const BASE_URL = envVersion === 'develop' ? DEV_BASE_URL : 'https://api.aiwts.me';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    // 自动携带C端用户登录态（登录后存于 userAuth）
    let userAuth = null;
    try { userAuth = wx.getStorageSync('userAuth'); } catch (e) { userAuth = null; }

    wx.request({
      url: BASE_URL + path,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'Content-Type': 'application/json',
        ...(userAuth && userAuth.userId
          ? { 'X-User-Id': String(userAuth.userId), 'X-User-Token': userAuth.token }
          : {}),
        ...(options.factoryId ? { 'X-Factory-Id': options.factoryId } : {}),
        ...(options.headers || {}),
      },
      success: (res) => {
        if (res.data && res.data.success) resolve(res.data);
        else {
          const err = new Error((res.data && res.data.error) || '请求失败');
          err.statusCode = res.statusCode;
          reject(err);
        }
      },
      fail: (err) => reject(err),
    });
  });
}

module.exports = { request, BASE_URL };
