const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const guard = require('../src/services/contentGuard');
const { pool } = require('../src/config/db');

/**
 * 内容安全护栏测试
 *
 * 只覆盖不触网的降级分支：真实的 risky 判定依赖微信接口，无法离线断言，
 * 因此这里要死死守住的是「微信侧不可用绝不阻断业务」这条契约——
 * 一旦有人把降级改成抛错，询价、IM 与下单会被整体拖死，这些用例立刻红。
 */

const ENV_KEYS = ['WX_APPID', 'WX_SECRET', 'SEC_TEXT_ENABLED'];
const ORIG = {};
for (const k of ENV_KEYS) ORIG[k] = process.env[k];

function setEnv(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

after(async () => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k]; else process.env[k] = ORIG[k];
  }
  await pool.end(); // 连接池是惰性的，此处只为确保测试进程干净退出
});

test('空内容直接放行，不触网也不查库', async () => {
  for (const v of ['', '   ', null, undefined]) {
    const r = await guard.checkText(v, { openid: 'o_real', scene: 'chat' });
    assert.equal(r.pass, true);
    assert.equal(r.reason, 'empty');
  }
});

test('未配置微信密钥时整体降级放行', async () => {
  setEnv({ WX_APPID: undefined, WX_SECRET: undefined });
  const r = await guard.checkText('任何内容', { openid: 'o_real', scene: 'inquiry' });
  assert.equal(r.pass, true);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'not-configured');
});

test('开发身份与匿名请求（无有效 openid）跳过检测', async () => {
  setEnv({ WX_APPID: 'wx_placeholder', WX_SECRET: 'secret_placeholder' });
  // dev_ 前缀是本地开发身份，微信侧无法据此判定用户
  const dev = await guard.checkText('内容', { openid: 'dev_1790348690', scene: 'chat' });
  assert.equal(dev.pass, true);
  assert.equal(dev.reason, 'no-openid');
  // 匿名询价没有 openid
  const anon = await guard.checkText('内容', { scene: 'inquiry' });
  assert.equal(anon.pass, true);
  assert.equal(anon.reason, 'no-openid');
});

test('SEC_TEXT_ENABLED=0 一键停用优先于其他判断', async () => {
  setEnv({ WX_APPID: undefined, WX_SECRET: undefined, SEC_TEXT_ENABLED: '0' });
  const r = await guard.checkText('内容', { openid: 'o_real', scene: 'chat' });
  assert.equal(r.reason, 'disabled', '开关停用应最先命中，而不是落到未配置分支');
});

test('多字段检测：空数组与纯空白字段不计入、不抛错', async () => {
  setEnv({ SEC_TEXT_ENABLED: undefined });
  const empty = await guard.assertTextAllowed([], { openid: 'o_real', scene: 'chat' });
  assert.deepEqual(empty, { checked: 0 });

  const blank = await guard.assertTextAllowed(
    [{ label: '昵称', value: '   ' }, { label: '公司', value: null }, { label: '备注', value: undefined }],
    { openid: 'o_real', scene: 'profile' }
  );
  assert.deepEqual(blank, { checked: 0 }, '全空字段不应产生任何检测调用');
});

test('未配置密钥时多字段全部放行且计数正确（业务不受阻断）', async () => {
  setEnv({ WX_APPID: undefined, WX_SECRET: undefined });
  const r = await guard.assertTextAllowed(
    [{ label: '收货人', value: '张三' }, { label: '详细地址', value: '龙港镇XX路1号' }],
    { openid: null, scene: 'profile' }
  );
  assert.deepEqual(r, { checked: 2 });
});

test('openid 查询对空 id 短路，不产生数据库访问', async () => {
  assert.equal(await guard.userOpenid(null), null);
  assert.equal(await guard.userOpenid(undefined), null);
  assert.equal(await guard.factoryOpenid(0), null);
});
