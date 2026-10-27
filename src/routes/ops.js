/**
 * P0/P1 运维诊断路由（挂载 /api/admin/ops，仅管理端）：
 *   GET  /status                 支付/验签/物流/语音/AI/告警/cron 心跳/迁移状态汇总（发版冒烟看这一屏）
 *   POST /notify-test            订阅消息模板字段实测（P0：验证 WX_TMPL_* 模板 ID 与 data 字段名是否匹配）
 *   GET  /migrations             迁移清单与执行状态（防环境漂移）
 *   GET  /design-templates       排版模板制版覆盖自检（PDF 链路依赖是否就绪）
 */
const express = require('express');
const router = express.Router();
const { ok, fail } = require('../utils/helpers');
const { pool } = require('../config/db');
const { requirePermission } = require('../config/permissions');
const wxpay = require('../services/wxpay');
const wxService = require('../services/wxService');
const logisticsService = require('../services/logisticsService');
const cronService = require('../services/cronService');
const designService = require('../services/designService');
const migrate = require('../../scripts/migrate');

/**
 * GET /status
 * 外部拨测/发版冒烟一屏看全：各外部依赖「配置了没有 + 用得起来没有」
 */
router.get('/status', requirePermission('dashboard:view'), async (req, res) => {
  try {
    const payVerify = wxpay.verifyStatus();
    const cronHealth = await cronService.getCronHealth();
    res.json(ok({
      wechat: { configured: wxService.isWxConfigured() },
      wxpay: {
        configured: payVerify.configured,           // 商户号六项配齐 → 真实支付可用
        verifyReady: payVerify.verifyReady,         // 回调验签就绪（P0，未就绪回调必被拦截）
        verifyMode: payVerify.mode,                 // public_key / platform_cert / none
      },
      subscribeTmpl: {
        accepted: !!process.env.WX_TMPL_ORDER_ACCEPTED,
        shipped: !!process.env.WX_TMPL_ORDER_SHIPPED,
      },
      kuaidi100: logisticsService.isKuaidi100Configured(),
      voice: !!(process.env.XF_APP_ID && process.env.XF_API_KEY && process.env.XF_API_SECRET),
      aiImage: !!process.env.AI_IMAGE_API_KEY,
      alertWebhook: !!process.env.ALERT_WEBHOOK_URL,
      cron: cronHealth,
      migrations: { pending: await migrate.pendingMigrations() },
    }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /notify-test
 * 订阅消息实测（P0）：向指定 C 端用户真发一条，回传微信原始 errcode/errmsg——
 * 47001/40037 即「模板字段名与 data 键不一致 / 模板ID错误」，据此对照代码调用点修正。
 * 注意：订阅消息为一次性授权，用户未订阅或次数已耗时会返回错误，同样能验证字段是否匹配
 *（微信先校验模板与 data，后校验订阅状态）。
 * body: { userId, scene: 'accepted'|'shipped', data? }  —— data 传则覆盖默认示例字段
 */
router.post('/notify-test', requirePermission('order:view'), async (req, res) => {
  try {
    const { userId, scene, data } = req.body || {};
    const uid = parseInt(userId, 10);
    if (!uid) throw new Error('请指定接收测试消息的 C 端用户 ID');
    const tmplId = scene === 'shipped'
      ? process.env.WX_TMPL_ORDER_SHIPPED
      : process.env.WX_TMPL_ORDER_ACCEPTED;
    if (!tmplId) throw new Error('未配置对应模板 ID（WX_TMPL_ORDER_' + (scene === 'shipped' ? 'SHIPPED' : 'ACCEPTED') + '）');

    // 默认样例与业务调用点同字段（接单：matchService 用 thing1/thing2；
    // 发货：orderService 用 character_string1/thing2），验证代码字段名是否与微信后台模板一致
    const defaultData = scene === 'shipped'
      ? {
        character_string1: { value: 'TEST' + Date.now() },
        thing2: { value: '物流模板字段测试，收到即字段正确' },
      }
      : {
        thing1: { value: 'CQ' + Date.now() },
        thing2: { value: '接单模板字段测试，收到即字段正确' },
      };

    const [users] = await pool.query('SELECT openid FROM c_end_user WHERE id = ?', [uid]);
    if (!users.length) throw new Error('用户不存在：' + uid);
    const result = await wxService.sendSubscribe(users[0].openid, tmplId, {
      page: 'pages/mine/mine',
      data: (data && typeof data === 'object') ? data : defaultData,
    });
    res.json(ok({
      scene,
      templateId: tmplId,
      openidDev: String(users[0].openid || '').indexOf('dev_') === 0, // true=开发身份会被静默跳过
      result,
      hint: result.skipped
        ? '已跳过（未配置微信密钥/dev 身份/无模板ID）'
        : (result.sent ? '发送成功：微信收到即字段与模板匹配' : '微信返回错误：47001/40037 系字段名或值与模板不符，20001=用户未订阅（字段验证仍可参照 errmsg）'),
    }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /migrations
 * 迁移执行状态清单（bootstrap/apply 由命令行 node scripts/migrate.js 执行，此处只读展示）
 */
router.get('/migrations', requirePermission('dashboard:view'), async (req, res) => {
  try {
    res.json(ok(await migrate.status()));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * GET /design-templates
 * 排版模板制版覆盖自检：可直接制版（有印刷 PDF）的模板数 + resvg/pdfkit/中文字体依赖状态
 */
router.get('/design-templates', requirePermission('dashboard:view'), async (req, res) => {
  try {
    res.json(ok(await designService.templateRenderSummary()));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

module.exports = router;
