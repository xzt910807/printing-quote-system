/**
 * 微信支付回调验签链自测（P0，本地无需商户号/无需数据库即可运行）
 * 运行：npm run pay:selftest   或   node scripts/pay-notify-selftest.js
 *
 * 原理：公钥模式（2024 后新商户默认）验签只依赖一对 RSA 公私钥，因此本地
 * 自生成密钥对即可完整跑通 wxpay.js 的 P0 安全链：
 *   verifyNotify（验签 + 时间戳防重放 + 序列号匹配）
 *   → decryptNotify（AES-256-GCM，apiV3Key 原文作密钥，验证「不 hash」修复）
 *   → assertNotifyMchid（跨商户核对）
 *   → 金额核对（复刻 orderService.markPaidByTradeNo 的 expectFen 公式，生产需 DB+订单，此处离线演示）
 * 说明：平台证书模式需联网向 api.mch.weixin.qq.com 下载真证书，本地不可测，故本脚本走公钥模式。
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const wxpay = require('../src/services/wxpay');

// ===== 自生成商户侧 RSA 密钥对（模拟「微信支付公钥」）=====
const { publicKey: PUB_PEM, privateKey: PRIV_PEM } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
// 攻击者密钥对：用它的私钥签名 → 我们公钥验签必失败（模拟伪造回调）
const { privateKey: ATTACKER_PRIV } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const PUB_PATH = path.join(os.tmpdir(), 'pay-selftest-pub-' + process.pid + '.pem');
fs.writeFileSync(PUB_PATH, PUB_PEM);

// ===== 注入公钥模式验签所需的 env（config() 每次调用即时读取 process.env）=====
const APIV3_KEY = crypto.randomBytes(16).toString('hex'); // 恰好 32 位原文
const MCHID = '1900000101';
const PUB_KEY_ID = 'PUB_KEY_ID_SELFTEST_0001';
process.env.WXPAY_MCHID = MCHID;
process.env.WXPAY_APIV3_KEY = APIV3_KEY;
process.env.WXPAY_PUBLIC_KEY_ID = PUB_KEY_ID;
process.env.WXPAY_PUBLIC_KEY_PATH = PUB_PATH;

// 离线演示用的订单（金额核对的「应付」基准；生产取自 order_main 三费用列）
const ORDER = { total_price: 50.0, shipping_fee: 8.0, sample_fee: 0 };

/** AES-256-GCM 加密（与 wxpay.aesGcmDecrypt 对称：密文尾 16 字节为 authTag）*/
function gcmEncrypt(nonceStr, aad, plain, keyStr) {
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyStr), Buffer.from(nonceStr));
  cipher.setAAD(Buffer.from(aad || ''));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([enc, cipher.getAuthTag()]).toString('base64');
}

/** 解密后的回调业务明文（内层）*/
function innerPlain(amountFen, mchid) {
  return {
    mchid: mchid || MCHID,
    out_trade_no: 'ORD_SELFTEST_0001',
    transaction_id: '4200' + Date.now(),
    trade_state: 'SUCCESS',
    success_time: new Date().toISOString(),
    amount: { total: amountFen, currency: 'CNY', payer_total: amountFen },
    payer: { openid: 'o_selftest_openid' },
  };
}

/**
 * 构造一个「微信风格」的 express 请求对象（含 rawBody + 验签头）。
 * @param {object} o inner 明文 / 签名私钥 / serial / 时间戳秒 / 是否去掉签名头
 */
function buildReq(o) {
  const rnonce = crypto.randomBytes(6).toString('hex'); // 12 字符 GCM nonce
  const aad = 'transaction';
  const ciphertext = gcmEncrypt(rnonce, aad, JSON.stringify(o.inner), APIV3_KEY);
  const envelope = {
    id: 'notif-' + Date.now(),
    create_time: new Date().toISOString(),
    resource_type: 'encrypt-resource',
    event_type: 'TRANSACTION.SUCCESS',
    summary: '支付成功',
    resource: { original_type: 'transaction', algorithm: 'AEAD_AES_256_GCM', ciphertext, associated_data: aad, nonce: rnonce },
  };
  const body = JSON.stringify(envelope);
  const ts = (o.tsSeconds != null ? o.tsSeconds : Math.floor(Date.now() / 1000)).toString();
  const hnonce = crypto.randomBytes(8).toString('hex');
  const signature = crypto.createSign('RSA-SHA256')
    .update(ts + '\n' + hnonce + '\n' + body + '\n')
    .sign(o.signPrivateKey, 'base64');
  const headers = { 'wechatpay-timestamp': ts, 'wechatpay-nonce': hnonce };
  if (!o.dropSignatureHeader) headers['wechatpay-signature'] = signature;
  if (o.serial !== null) headers['wechatpay-serial'] = (o.serial == null ? PUB_KEY_ID : o.serial);
  return { rawBody: Buffer.from(body, 'utf8'), body: envelope, headers };
}

/** 复刻 orderService.markPaidByTradeNo 的金额核对（三费用求和取「分」）*/
function amountCheck(paidFen) {
  const expectFen = Math.round((ORDER.total_price + ORDER.shipping_fee + ORDER.sample_fee) * 100);
  if (paidFen != null && Number.isFinite(Number(paidFen))) {
    return { expectFen, mismatch: Number(paidFen) !== expectFen };
  }
  return { expectFen, mismatch: false };
}

async function runCase(name, fn) {
  try {
    const r = await fn();
    console.log((r.pass ? '  [✓] ' : '  [✗] ') + name + (r.note ? '  —— ' + r.note : ''));
    return r.pass;
  } catch (e) {
    console.log('  [✗] ' + name + '  —— 用例执行异常：' + e.message);
    return false;
  }
}

/** 断言：应抛出包含 substr 的错误 */
async function expectThrow(fn, substr) {
  try {
    await fn();
    return { pass: false, note: '未抛错（期望抛「' + substr + '」）' };
  } catch (e) {
    const hit = String(e.message).indexOf(substr) >= 0;
    return { pass: hit, note: hit ? '拦截：' + e.message : '抛错但信息不符，期望含「' + substr + '」，实为：' + e.message };
  }
}

async function main() {
  const vs = wxpay.verifyStatus();
  console.log('=== 微信支付回调验签链自测（公钥模式 · 无需商户号 / 无需数据库）===');
  console.log('verifyStatus: mode=' + vs.mode + '  verifyReady=' + vs.verifyReady + '  configured=' + vs.configured);
  console.log('应付基准（ORDER 三费用）expectFen=' + amountCheck(0).expectFen + ' 分\n');

  if (vs.mode !== 'public_key' || !vs.verifyReady) {
    console.log('✗ 验签模式未就绪（应为 public_key），中止。');
    process.exitCode = 1;
    return;
  }

  let pass = 0;
  const total = 7;

  // A 正常回调：验签通过 → 解密 → mchid 一致 → 金额一致 → 可落库
  pass += await runCase('A 正常回调：全链通过，金额一致', async () => {
    const req = buildReq({ inner: innerPlain(amountCheck(0).expectFen), signPrivateKey: PRIV_PEM });
    const v = await wxpay.verifyNotify(req);
    const plain = wxpay.decryptNotify(req.body.resource);
    wxpay.assertNotifyMchid(plain);
    const chk = amountCheck(plain.amount.total);
    return { pass: v.mode === 'public_key' && !chk.mismatch, note: 'mode=' + v.mode + ' 实付' + plain.amount.total + '=应付' + chk.expectFen };
  });

  // B 篡改签名（攻击者私钥签）：verifyNotify 应拒
  pass += await runCase('B 篡改签名：验签拒绝', () =>
    expectThrow(() => wxpay.verifyNotify(buildReq({ inner: innerPlain(5800), signPrivateKey: ATTACKER_PRIV })), '签名验证不通过'));

  // C 缺少验签头：verifyNotify 应拒
  pass += await runCase('C 缺少验签头：验签拒绝', () =>
    expectThrow(() => wxpay.verifyNotify(buildReq({ inner: innerPlain(5800), signPrivateKey: PRIV_PEM, dropSignatureHeader: true })), '缺少验签头'));

  // D 重放（时间戳偏差 >300s）：verifyNotify 应拒
  pass += await runCase('D 过期时间戳（重放）：验签拒绝', () =>
    expectThrow(() => wxpay.verifyNotify(buildReq({ inner: innerPlain(5800), signPrivateKey: PRIV_PEM, tsSeconds: Math.floor(Date.now() / 1000) - 400 })), '时间戳异常'));

  // E 序列号与配置公钥 ID 不符（证书/公钥错配）：verifyNotify 应拒
  pass += await runCase('E 序列号与公钥 ID 不符：验签拒绝', () =>
    expectThrow(() => wxpay.verifyNotify(buildReq({ inner: innerPlain(5800), signPrivateKey: PRIV_PEM, serial: 'PUB_KEY_ID_WRONG' })), 'WXPAY_PUBLIC_KEY_ID'));

  // F 跨商户串单：mchid 不一致，assertNotifyMchid 应拒（验签本身会通过）
  pass += await runCase('F 跨商户串单：商户号核对拒绝', async () => {
    const req = buildReq({ inner: innerPlain(5800, '9999999999'), signPrivateKey: PRIV_PEM });
    await wxpay.verifyNotify(req); // 通过
    const plain = wxpay.decryptNotify(req.body.resource);
    return expectThrow(() => wxpay.assertNotifyMchid(plain), '不一致');
  });

  // G 金额不符：全链验签/解密/mchid 通过，但金额核对拦截（防刷单少付）
  pass += await runCase('G 金额不符：金额核对拦截（不落库）', async () => {
    const req = buildReq({ inner: innerPlain(1), signPrivateKey: PRIV_PEM }); // 实付 1 分
    await wxpay.verifyNotify(req);
    const plain = wxpay.decryptNotify(req.body.resource);
    wxpay.assertNotifyMchid(plain);
    const chk = amountCheck(plain.amount.total);
    return { pass: chk.mismatch, note: '实付' + plain.amount.total + '分 ≠ 应付' + chk.expectFen + '分 → 已拦截' };
  });

  console.log('\n结果：' + pass + '/' + total + (pass === total ? ' 全部通过 ✅' : ' 存在失败 ❌'));
  process.exitCode = pass === total ? 0 : 1;
}

main().catch((e) => {
  console.error('[selftest] 运行失败:', e);
  process.exitCode = 1;
}).finally(() => {
  try { fs.unlinkSync(PUB_PATH); } catch (e) { /* 临时公钥文件清理失败忽略 */ }
});
