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

/**
 * multipart 文件上传（wx.uploadFile 的 Promise 封装）
 *
 * wx.uploadFile 不走 request(), 身份头与响应协议得各写一遍, 026 协同文件上线时就因为
 * 各页面各写一份出过三种错法：按后端根本没有的 code 字段判成功（文件已落库仍弹「上传失败」）、
 * C 端只带 X-User-Token 漏 X-User-Id（requireUser 两个头缺一即 401）、读了从未写入过的
 * storage 键 user_token（token 恒空）。统一到这里, 页面只处理结果。
 *
 * options.headers 传工厂端凭证（X-Factory-Id/Token）; Content-Type 不手写,
 * wx.uploadFile 会自己带 boundary, 手写反而把 multipart 头覆盖坏。
 * @returns {Promise<any>} resolve 后端 data 载荷, reject Error(error 文案)
 */
function upload(path, filePath, formData = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let userAuth = null;
    try { userAuth = wx.getStorageSync('userAuth'); } catch (e) { userAuth = null; }
    wx.uploadFile({
      url: BASE_URL + path,
      filePath,
      name: options.field || 'file',
      formData,
      header: {
        ...(userAuth && userAuth.userId
          ? { 'X-User-Id': String(userAuth.userId), 'X-User-Token': userAuth.token }
          : {}),
        ...(options.headers || {}),
      },
      success: (res) => {
        let body = null;
        try { body = JSON.parse(res.data); } catch (e) { body = null; }
        if (body && body.success) return resolve(body.data);
        // 非 JSON 响应一般是网关或进程层拦下的（413 体积超限 / 502）, 带上状态码才好定位
        const msg = (body && body.error)
          ? body.error
          : ('上传失败' + (res.statusCode ? '（' + res.statusCode + '）' : ''));
        const err = new Error(msg);
        err.statusCode = res.statusCode;
        reject(err);
      },
      fail: () => reject(new Error('网络异常，上传失败')),
    });
  });
}

module.exports = { request, upload, BASE_URL };
