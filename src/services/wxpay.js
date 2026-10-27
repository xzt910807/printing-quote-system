/**
 * 微信支付 v3（JSAPI）服务
 * 配置项（.env，全部配齐才启用真实支付，否则接口返回「未配置」提示）：
 *   WXPAY_APPID          小程序 AppID
 *   WXPAY_MCHID          商户号
 *   WXPAY_APIV3_KEY      APIv3 密钥（回调解密用）
 *   WXPAY_SERIAL_NO      商户证书序列号
 *   WXPAY_PRIVATE_KEY_PATH  商户私钥文件路径（apiclient_key.pem）
 *   WXPAY_NOTIFY_URL     支付回调公网地址，如 https://your.domain/api/c/pay/notify
 * 回调验签（P0 补全，两种模式二选一，商户平台按主体类型选择）：
 *   平台证书模式：无需额外配置，自动下载平台证书（内存缓存 + 过期/未知序列号时轮换重下）；
 *   公钥模式（2024 后新商户默认）：WXPAY_PUBLIC_KEY_ID（PUB_KEY_ID_***）+
 *     WXPAY_PUBLIC_KEY_PATH（微信支付公钥.pem 文件路径）。
 *   两种模式都未就绪时 verifyNotify 抛错，回调不落库（防伪造回调刷单）。
 */
const crypto = require('crypto');
const fs = require('fs');
const { pool } = require('../config/db');
const { round } = require('../utils/helpers');

function config() {
  return {
    appid: process.env.WXPAY_APPID || '',
    mchid: process.env.WXPAY_MCHID || '',
    apiV3Key: process.env.WXPAY_APIV3_KEY || '',
    serialNo: process.env.WXPAY_SERIAL_NO || '',
    privateKeyPath: process.env.WXPAY_PRIVATE_KEY_PATH || '',
    notifyUrl: process.env.WXPAY_NOTIFY_URL || '',
    publicKeyId: process.env.WXPAY_PUBLIC_KEY_ID || '',
    publicKeyPath: process.env.WXPAY_PUBLIC_KEY_PATH || '',
  };
}

/** 是否已配齐微信支付（未配齐时 pay 接口优雅降级提示） */
function isConfigured() {
  const c = config();
  if (!(c.appid && c.mchid && c.apiV3Key && c.serialNo && c.privateKeyPath && c.notifyUrl)) return false;
  try { fs.accessSync(c.privateKeyPath); return true; } catch { return false; }
}

function privateKey() {
  return fs.readFileSync(config().privateKeyPath, 'utf8');
}

function sha256RsaSign(message) {
  return crypto.createSign('RSA-SHA256').update(message).sign(privateKey(), 'base64');
}

async function wxApi(method, path, bodyObj) {
  const c = config();
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const ts = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = sha256RsaSign(`${method}\n${path}\n${ts}\n${nonce}\n${body}\n`);
  const res = await fetch('https://api.mch.weixin.qq.com' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${ts}",serial_no="${c.serialNo}"`,
    },
    body: body || undefined,
  });
  const data = await res.json();
  if (!res.ok || (data.code && data.message)) {
    throw new Error('微信支付请求失败：' + (data.message || data.code || ('HTTP ' + res.status)));
  }
  return data;
}

/**
 * JSAPI 统一下单：返回小程序 wx.requestPayment 所需参数
 * @param {Object} p { orderNo, amountFen, openid }
 */
async function createJsapiOrder({ orderNo, amountFen, openid }) {
  if (!isConfigured()) throw new Error('微信支付尚未配置（需商户号/证书），请先用模拟支付或线下转账');
  const c = config();
  const data = await wxApi('POST', '/v3/pay/transactions/jsapi', {
    appid: c.appid,
    mchid: c.mchid,
    description: ('印刷订单 ' + orderNo).slice(0, 60),
    out_trade_no: orderNo,
    notify_url: c.notifyUrl,
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid },
  });
  // 组装小程序支付参数（二次签名）
  const pkg = 'prepay_id=' + data.prepay_id;
  const payNonce = crypto.randomBytes(16).toString('hex');
  const payTs = Math.floor(Date.now() / 1000).toString();
  const paySign = crypto.createSign('RSA-SHA256')
    .update(`${c.appid}\n${payTs}\n${payNonce}\n${pkg}\n`)
    .sign(privateKey(), 'hex');
  return { timeStamp: payTs, nonceStr: payNonce, package: pkg, signType: 'RSA', paySign };
}

/**
 * C端发起微信支付：校验订单 → 统一下单 → 返回支付参数（不落 paid，等回调）
 */
async function createOrderPay(orderId, user) {
  const [rows] = await pool.query('SELECT * FROM order_main WHERE id = ?', [orderId]);
  if (!rows.length) throw new Error('订单不存在');
  const order = rows[0];
  if (order.user_id !== user.id) throw new Error('无权操作他人的订单');
  if (order.pay_status === 'paid') throw new Error('订单已支付，请勿重复支付');
  if (order.status === 'cancelled') throw new Error('订单已取消，无法支付');
  const [uRows] = await pool.query('SELECT openid FROM c_end_user WHERE id = ?', [user.id]);
  const openid = uRows[0] && uRows[0].openid;
  if (!openid || String(openid).indexOf('dev_') === 0) {
    throw new Error('微信支付需要真实微信身份（开发者工具请用模拟支付）');
  }
  const payAmount = round(Number(order.total_price || 0) + Number(order.shipping_fee || 0) + Number(order.sample_fee || 0), 2);
  const amountFen = Math.round(payAmount * 100);
  const wxPay = await createJsapiOrder({ orderNo: order.order_no, amountFen, openid });
  await pool.query("UPDATE order_main SET pay_method = 'wechat' WHERE id = ?", [orderId]);
  return { orderId, orderNo: order.order_no, payAmount, wxPay };
}

/** 验签配置状态（运维诊断用：告知运营当前回调验签走哪种模式、是否就绪） */
function verifyStatus() {
  const c = config();
  const publicKeyMode = !!(c.publicKeyId && c.publicKeyPath && fs.existsSync(c.publicKeyPath));
  const platformCertMode = !!(c.mchid && c.serialNo && c.privateKeyPath && fs.existsSync(c.privateKeyPath));
  return {
    configured: isConfigured(),
    verifyReady: publicKeyMode || platformCertMode,
    mode: publicKeyMode ? 'public_key' : (platformCertMode ? 'platform_cert' : 'none'),
  };
}

// ===== 回调验签（P0）：微信 v3 签名验证 = RSA-SHA256(时间戳\n随机串\n报文\n) =====

/** 公钥模式：读取微信支付公钥 PEM */
function getPublicKeyPem() {
  const c = config();
  if (!c.publicKeyId || !c.publicKeyPath) return null;
  try { return fs.readFileSync(c.publicKeyPath, 'utf8'); } catch (e) { return null; }
}

// 平台证书内存缓存 [{serial, publicKeyPem, notAfter}]；每次验签遇到未知序列号即重下（证书轮换容错），
// 超过 12 小时也强制刷新一次，避免长期部署后列表陈旧
let certCache = { list: [], fetchedAt: 0 };
const CERT_TTL_MS = 12 * 60 * 60 * 1000;

/** AES-256-GCM 通用解密（apiV3Key 直接作密钥，官方规范不 hash） */
function aesGcmDecrypt(associatedData, nonce, ciphertextB64, keyStr) {
  const buf = Buffer.from(ciphertextB64, 'base64');
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyStr), Buffer.from(nonce));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(associatedData || ''));
  return decipher.update(data, null, 'utf8') + decipher.final('utf8');
}

/** 下载并解密平台证书（/v3/certificates），X509 解析出序列号与公钥 */
async function refreshPlatformCerts() {
  const c = config();
  if (!c.mchid || !c.serialNo || !c.privateKeyPath) throw new Error('微信支付配置不全，无法下载平台证书');
  const data = await wxApi('GET', '/v3/certificates');
  const now = Date.now();
  const list = [];
  for (const item of (data.certificates || [])) {
    const enc = item.encrypt_certificate;
    const pem = aesGcmDecrypt(enc.associated_data, enc.nonce, enc.ciphertext, c.apiV3Key);
    const x509 = new crypto.X509Certificate(pem);
    list.push({
      serial: x509.serialNumber.toUpperCase(),
      publicKeyPem: x509.publicKey.export({ type: 'spki', format: 'pem' }),
      notAfter: Date.parse(x509.validTo),
    });
  }
  if (!list.length) throw new Error('平台证书列表为空');
  certCache = { list, fetchedAt: now };
  return list;
}

/** 按 Wechatpay-Serial 取验签公钥：公钥模式→本地公钥；平台证书→缓存过期或未命中则重下（证书轮换容错） */
async function resolveVerifyKey(serial) {
  const c = config();
  if (c.publicKeyId) {
    if (serial !== c.publicKeyId) throw new Error('回调 Wechatpay-Serial(' + serial + ') 与配置的 WXPAY_PUBLIC_KEY_ID 不一致');
    const pem = getPublicKeyPem();
    if (!pem) throw new Error('WXPAY_PUBLIC_KEY_PATH 指向的公钥文件不存在');
    return { publicKey: pem, mode: 'public_key' };
  }
  let list = certCache.list;
  if (!list.length || Date.now() - certCache.fetchedAt > CERT_TTL_MS
    || !list.some((x) => x.serial === String(serial).toUpperCase())) {
    list = await refreshPlatformCerts();
  }
  const hit = list.find((x) => x.serial === String(serial).toUpperCase());
  if (!hit) throw new Error('平台证书列表中无序列号 ' + serial);
  return { publicKey: hit.publicKeyPem, mode: 'platform_cert' };
}

/**
 * 回调验签入口（P0 安全补全）：验证微信应答头签名，通过后才允许解密落库。
 * @param {Object} req express 请求（需 res.rawBody，app.js bodyParser verify 捕获）
 * @returns {Promise<{mode: string}>} 验签通过的模式；失败抛 Error
 */
async function verifyNotify(req) {
  const timestamp = req.headers['wechatpay-timestamp'];
  const nonce = req.headers['wechatpay-nonce'];
  const signature = req.headers['wechatpay-signature'];
  const serial = req.headers['wechatpay-serial'] || '';
  const body = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  if (!(timestamp && nonce && signature)) throw new Error('回调缺少验签头（Wechatpay-Timestamp/Nonce/Signature）');
  // 时间戳偏差过大视为重放（微信官方要求校验 5 分钟内的时间戳）
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) throw new Error('回调时间戳异常（疑似重放），偏差 ' + Math.round(skew) + 's');
  const message = timestamp + '\n' + nonce + '\n' + body + '\n';
  const { publicKey, mode } = await resolveVerifyKey(serial);
  const okSign = crypto.createVerify('RSA-SHA256').update(message).verify(publicKey, signature, 'base64');
  if (!okSign) throw new Error('回调签名验证不通过');
  return { mode };
}

/** 商户号核对：回调报文 mchid 必须与本商户一致（防跨商户串单） */
function assertNotifyMchid(plain) {
  const c = config();
  if (c.mchid && plain && plain.mchid && plain.mchid !== c.mchid) {
    throw new Error('回调商户号与本商户不一致：' + plain.mchid);
  }
}

/**
 * 解密支付回调 resource（AES-256-GCM）
 * 注：官方规范以 APIv3 密钥原文（32 字符）作密钥，不做任何 hash（此处曾误 hash 导致真机解密必败，已修正）。
 */
function decryptNotify(resource) {
  const c = config();
  if (!c.apiV3Key) throw new Error('未配置 WXPAY_APIV3_KEY，无法解密回调');
  if (Buffer.byteLength(c.apiV3Key) !== 32) throw new Error('WXPAY_APIV3_KEY 必须为 32 位字符（微信后台生成）');
  const plain = aesGcmDecrypt(resource.associated_data, resource.nonce, resource.ciphertext, c.apiV3Key);
  return JSON.parse(plain);
}

/**
 * 退款（v3）。refundNo 需唯一（退款单号）。
 */
async function refund({ refundNo, orderNo, refundFen, totalFen, reason }) {
  if (!isConfigured()) throw new Error('微信支付尚未配置，无法发起原路退款');
  return wxApi('POST', '/v3/refund/domestic/refunds', {
    out_trade_no: orderNo,
    out_refund_no: refundNo,
    reason: (reason || '订单取消退款').slice(0, 80),
    amount: { refund: refundFen, total: totalFen, currency: 'CNY' },
  });
}

module.exports = {
  isConfigured, verifyStatus, createJsapiOrder, createOrderPay,
  verifyNotify, assertNotifyMchid, decryptNotify, refund,
};
