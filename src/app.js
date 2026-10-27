require('dotenv').config();
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { testConnection } = require('./config/db');
const catalog = require('./services/catalogService');
const cronService = require('./services/cronService');

const quoteRoutes = require('./routes/quote');
const catalogRoutes = require('./routes/catalog');
const customerRoutes = require('./routes/customer');
const cQuoteRoutes = require('./routes/cQuote');
const cUserRoutes = require('./routes/cUser');
const designRoutes = require('./routes/design');
const factoryPushRoutes = require('./routes/factoryPush');
const capabilityService = require('./services/capabilityService');
const factoryQueryRoutes = require('./routes/factoryQuery');
const factoryRegisterRoutes = require('./routes/factoryRegister');
const factorySelfRoutes = require('./routes/factorySelf');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const adminUsersRoutes = require('./routes/adminUsers');
const adminLogisticsRoutes = require('./routes/adminLogistics');
const voiceRoutes = require('./routes/voice');
const opsRoutes = require('./routes/ops');
const messagesRoutes = require('./routes/messages');
const fileTransferRoutes = require('./routes/fileTransfer');
const issuesRoutes = require('./routes/issues');
const newsRoutes = require('./routes/news');
const factoryDashboardRoutes = require('./routes/factoryDashboard');
const suppliersRoutes = require('./routes/suppliers');
const logisticsCallbackRoutes = require('./routes/logisticsCallback');
const wxpay = require('./services/wxpay');
const { requireAdmin, requireAdminOrFactory, requireUser, requireFactory } = require('./middlewares/auth');
const { ok, fail } = require('./utils/helpers');

const app = express();
app.use(cors());
// rawBody：仅为微信支付回调保留原始报文（v3 验签必须用字节级原文，重序列化会破坏签名）
app.use(bodyParser.json({
  limit: '2mb',
  verify: (req, res, buf) => {
    if (req.originalUrl && req.originalUrl.indexOf('/pay/notify') >= 0) req.rawBody = buf;
  },
}));

// ===== 请求日志（放在静态托管之前：/admin 与 API 请求全部可见；finish 事件补记状态码） =====
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.url + ' -> ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
  });
  next();
});

// ===== 托管管理后台静态文件 =====
// no-store：防止浏览器缓存旧 HTML/JS（旧版引用 unpkg CDN，缓存会导致离线白屏）
app.use('/admin', express.static(path.join(__dirname, '..', 'admin'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// ===== 托管上传文件（C端口像等）=====
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ===== 根路由：直接跳到管理后台（改动1）=====
app.get('/', (req, res) => {
  res.redirect('/admin/');
});

// ===== 健康检查接口（P1 监控：带 cron 心跳状态，HEALTH_STRICT=1 时 cron 异常直接返 503，供外部拨测报警）=====
app.get('/health', async (req, res) => {
  let cron = { ok: true, state: 'unchecked' };
  try { cron = await cronService.getCronHealth(); } catch (e) { cron = { ok: false, state: 'check_failed', error: e.message }; }
  const strict = process.env.HEALTH_STRICT === '1';
  const degraded = cron.state !== 'ok' && cron.state !== 'unchecked';
  res.status(strict && degraded ? 503 : 200).json({
    status: strict && degraded ? 'degraded' : 'ok',
    name: '龙港印刷智能报价系统',
    version: '2.0.0',
    catalogLoadedAt: catalog.loadedAt,
    cron,
  });
});

// ===== F-81/82/85：协议静态页（no-store，运营直接改 legal/*.html 保存即生效）=====
const LEGAL_PAGES = {
  'user-agreement': 'user-agreement.html',
  privacy: 'privacy.html',
};
for (const [slug, file] of Object.entries(LEGAL_PAGES)) {
  app.get(['/legal/' + slug + '.html', '/legal/' + slug], (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'legal', file));
  });
}

// ===== F-102：工厂二维码名片落地页（微信扫码直达） =====
// GET /f/:code → 工厂公开名片 H5（手机浏览器/微信内打开），展示公开信息并引导回小程序询价
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderFactoryCard(f) {
  if (!f) {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="font-family:-apple-system,\'PingFang SC\',sans-serif;text-align:center;padding:60px 20px;color:#666">'
      + '<p style="font-size:17px">工厂不存在或已停用</p></body></html>';
  }
  const rating = Number(f.rating) || 0;
  const stars = rating > 0 ? '★'.repeat(Math.round(rating)) + ' ' + rating.toFixed(1) : '暂无评分';
  // 印查查式信任元素：已核验徽章 + 闲置产能标签
  const verifiedBadge = f.verified
    ? '<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;background:#e8f4ff;color:#1677ff;font-size:12px;vertical-align:2px">✓ 已核验</span>' : '';
  const { capacityOf } = require('./utils/helpers');
  const cap = capacityOf(f);
  const capBadge = cap.status === 'idle'
    ? '<span style="display:inline-block;margin-top:10px;padding:3px 10px;border-radius:12px;background:#e7f7ee;color:#16a34a;font-size:13px">⚡ 产能空闲' + (cap.note ? ' · ' + escHtml(cap.note) : '') + '</span>'
    : (cap.status === 'busy'
      ? '<span style="display:inline-block;margin-top:10px;padding:3px 10px;border-radius:12px;background:#fff1f0;color:#dc2626;font-size:13px">排单饱和</span>'
      : '');
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + escHtml(f.name) + ' - 工厂名片</title></head>'
    + '<body style="margin:0;font-family:-apple-system,\'PingFang SC\',sans-serif;background:#f5f6fa">'
    + '<div style="max-width:480px;margin:0 auto;padding:20px 16px 40px">'
    + '<div style="background:#fff;border-radius:12px;padding:24px 20px;box-shadow:0 2px 12px rgba(0,0,0,.06)">'
    + '<div style="font-size:20px;font-weight:600;color:#222">' + escHtml(f.name) + verifiedBadge + '</div>'
    + '<div style="margin-top:10px;font-size:14px;color:#f5a623">' + escHtml(stars)
    + (f.rating_count ? '<span style="color:#999;font-size:12px">（' + f.rating_count + ' 人评价）</span>' : '') + '</div>'
    + (capBadge ? '<div>' + capBadge + '</div>' : '')
    + (f.address ? '<div style="margin-top:12px;font-size:14px;color:#555">地址：' + escHtml(f.address) + '</div>' : '')
    + (f.contact ? '<div style="margin-top:8px;font-size:14px;color:#555">联系人：' + escHtml(f.contact) + '</div>' : '')
    + (f.intro ? '<div style="margin-top:14px;font-size:14px;color:#666;line-height:1.7;border-top:1px solid #f0f0f0;padding-top:14px">' + escHtml(f.intro) + '</div>' : '')
    + '</div>'
    + '<div style="margin-top:20px;font-size:13px;color:#999;text-align:center;line-height:1.8">'
    + '打开微信小程序「龙港印刷报价」<br>扫描工厂二维码或搜索厂名，即可在线询价下单'
    + (f.total_accepts ? '<br><span style="color:#4a7dff">该工厂已接单 ' + f.total_accepts + ' 次</span>' : '')
    + '</div></div></body></html>';
}

app.get('/f/:code', async (req, res) => {
  try {
    const { pool } = require('./config/db');
    const [rows] = await pool.query(
      `SELECT code, name, contact, address, intro, rating, rating_count, total_accepts,
              audit_status, license_verified, capacity_status, capacity_note, capacity_updated_at
       FROM factory WHERE code = ? AND status = 1`,
      [String(req.params.code).slice(0, 50)]
    );
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!rows.length) return res.status(404).send(renderFactoryCard(null));
    const f = rows[0];
    f.verified = !!f.license_verified || f.audit_status === 'approved';
    res.send(renderFactoryCard(f));
  } catch (e) {
    res.status(500).send(renderFactoryCard(null));
  }
});

// ===== API 路由注册 =====
// 鉴权说明：
//   requireAdmin    管理后台会话令牌（登录 admin_user 表校验，请求头 X-Admin-Token）
//   工厂端路由内部挂 requireFactory（X-Factory-Id + X-Factory-Token）
//   /api/c/* 与 /api/auth/* 为 C 端公开接口（/api/c/user/* 需 C 端登录）
app.use('/api/auth', authRoutes);
// 026：报价与客户接口对管理端+工厂端开放（requireAdminOrFactory 按请求头识别身份，
// 路由内部再按 req.factoryUser 强制本厂数据，工厂看不到平台与其他工厂的数据）
app.use('/api/quote', requireAdminOrFactory, quoteRoutes);
app.use('/api/customer', requireAdminOrFactory, customerRoutes);

// 公开只读目录端点：产品类型配置（报价页切换产品用，admin/工厂/C端三端共用）。
// 必须先于 requireAdmin 挂载：该接口不含敏感数据，若走管理员鉴权，
// 工厂模式下的报价页调用会收 401 → 前端全局 401 处理清掉工厂凭证 → 登录后被弹回登录框
const publicCatalog = express.Router();
publicCatalog.get('/product-config/:productType', (req, res) => {
  try {
    const cfg = catalog.getProductConfig(req.params.productType);
    if (!cfg) return res.status(404).json(fail('未找到该产品类型的配置'));
    res.json(ok(cfg));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});
publicCatalog.get('/product-types', (req, res) => {
  try {
    const list = Object.values(catalog.baseData.productConfig || {})
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((c) => ({ productType: c.productType, productName: c.productName }));
    res.json(ok(list));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});
app.use('/api/catalog', publicCatalog);
app.use('/api/catalog', requireAdmin, catalogRoutes);
app.use('/api/dashboard', requireAdmin, dashboardRoutes);
app.use('/api/admin', requireAdmin, adminUsersRoutes);
app.use('/api/admin', requireAdmin, adminLogisticsRoutes);
// P1 运维诊断：支付/验签/物流/告警配置状态 + 订阅消息实测（仅管理端）
app.use('/api/admin/ops', requireAdmin, opsRoutes);
// stage14：工厂邀请码管理走 /api/admin/factory/:id/invite-codes（requireAdmin，工厂 token 天然 401）
app.use('/api/admin/factory', requireAdmin, factoryQueryRoutes);
app.use('/api/c/user', requireUser, cUserRoutes);
app.use('/api/c', cQuoteRoutes);
// 021 设计辅助（模板列表/渲染/参考图上传；匿名可用 + IP 限流，挂在 /api/c 下）
app.use('/api/c', designRoutes);
// F-105 语音识别（第三方 ASR 通道，个人主体小程序的语音报价方案；匿名可用）
app.use('/api/voice', voiceRoutes);
// 035 快递100 主动推送回调（公开，靠签名验证 + 建议 IP 白名单）
app.use('/api/logistics', logisticsCallbackRoutes);
// 027 询价会话 IM（客户/工厂双视角，按请求头鉴权分流，路由内部强制归属校验）
app.use('/api/messages', messagesRoutes);
app.use('/api/factory', factoryPushRoutes);
app.use('/api/factory', factoryQueryRoutes);
app.use('/api/factory', factoryRegisterRoutes);
app.use('/api/factory', factorySelfRoutes);

// ===== 026-030 新七大功能后端路由 =====
// 026 协同文件传输：/api/c/file（用户端 requireUser）与 /api/factory/file（工厂端 requireFactory）
app.use('/api/c/file', requireUser, fileTransferRoutes);
app.use('/api/factory/file', requireFactory, fileTransferRoutes); // 路由内部按头鉴权，工厂端自带 requireFactory
// 027 异常工单：/api/c/issue 与 /api/factory/issue + /api/admin/issue
app.use('/api/c/issue', requireUser, issuesRoutes);
// 工厂/管理端子路由另需内部鉴权，当行入口在 routes/issues.js 内部注册
app.use('/api/factory/issue', issuesRoutes.factoryRouter);
app.use('/api/admin/issue', issuesRoutes.adminRouter);
// 028 行业资讯：/api/c/news 与 /api/admin/news/crawl（管理端手动触发）
app.use('/api/c/news', newsRoutes);
const newsService = require('./services/newsService');
const adminNews = express.Router();
adminNews.use(requireAdmin);
adminNews.post('/crawl', async (req, res) => {
  try { res.json(ok(await newsService.crawlAll())); }
  catch (err) { res.status(500).json(fail(err.message)); }
});
app.use('/api/admin/news', adminNews);
// 031 资讯编辑推荐面板：/api/admin/news/:id/feature
const adminNewsFeature = express.Router();
adminNewsFeature.use(requireAdmin);
adminNewsFeature.use(newsRoutes.adminRouter);
app.use('/api/admin/news', adminNewsFeature);
// 029 仲裁接口（管理端）：/api/admin/order/:id/arbitrate
const escrowService = require('./services/escrowService');
const adminEscrow = express.Router();
adminEscrow.use(requireAdmin);
adminEscrow.post('/order/:id/arbitrate', async (req, res) => {
  try {
    const ret = await escrowService.arbitrate(parseInt(req.params.id, 10), req.body || {});
    res.json(ok(ret || { arbitrated: true }));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});
app.use('/api/admin', adminEscrow);
// 030 工厂经营报表：/api/factory/dashboard（工厂内部看板，路由内部 requireFactory）
app.use('/api/factory/dashboard', factoryDashboardRoutes);
// 031 供应商管理（历史合作聚合）：/api/c/user/suppliers，已在 requireUser 后面挂接
app.use('/api/c/user', requireUser, suppliersRoutes);

// ===== 404 兜底：所有未匹配的 /api/* 请求返回 JSON（改动2，关键！）=====
// 这个中间件必须放在所有路由之后、错误处理之前
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `接口不存在：${req.method} ${req.originalUrl}`,
    hint: '请检查路由路径是否拼写正确，或该接口是否已在 routes/ 中实现',
  });
});

// ===== 全局错误处理 =====
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ success: false, error: err.message });
});

const PORT = process.env.PORT || 6001;

async function bootstrap() {
  try {
    await testConnection();
    // P1 防环境漂移：迁移版本自检（未执行/未登记的迁移记告警日志 + 推运维告警）
    try {
      const migrate = require('../scripts/migrate');
      const pend = await migrate.pendingMigrations();
      if (pend && pend.length) {
        console.warn('[MIGRATE] ⚠️ 有 ' + pend.length + ' 个迁移未登记执行：' + pend.join(', ') + '（请跑 node scripts/migrate.js apply）');
        require('./services/alertService').send('migrate_pending', '⚠️ 数据库迁移未执行：' + pend.join(', '));
      }
    } catch (e) { /* schema_migrations 表尚未建立（bootstrap 前）不阻断启动 */ }
    await catalog.loadAll();
    await capabilityService.loadAll();
    cronService.start();  // F-33/F-55/F-78：失效标记 / 超时回滚 / 每日统计
    // P0 支付就绪提醒：配了商户号但验签材料不齐 → 回调会被验签拦截，提前告警而不是等丢单
    try {
      const vs = wxpay.verifyStatus();
      if (vs.configured && !vs.verifyReady) {
        console.warn('[PAY] ⚠️ 微信支付已配置但回调验签不可用（平台证书下载失败/公钥未配），真实回调将被拦截');
        require('./services/alertService').send('pay_verify_unready', '⚠️ 微信支付验签未就绪：配齐 WXPAY_PUBLIC_KEY_ID/PATH 或检查平台证书下载');
      }
    } catch (e) { /* 诊断失败不影响启动 */ }
    console.log('[Catalog] 已加载材料：原纸' + Object.keys(catalog.baseData.rawPaper).length + ' / 纸板' + Object.keys(catalog.baseData.boardPaper).length + ' / 卡纸' + Object.keys(catalog.baseData.cardPaper).length);
    app.listen(PORT, () => {
      console.log('\n✅ 报价系统已启动: http://localhost:' + PORT);
      console.log('   管理后台: http://localhost:' + PORT + '/admin/');
      console.log('   健康检查: http://localhost:' + PORT + '/health\n');
    });
  } catch (err) {
    console.error('❌ 启动失败:', err.message);
    process.exit(1);
  }
}

bootstrap();