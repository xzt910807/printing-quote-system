const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const catalog = require('../services/catalogService');
const capabilityService = require('../services/capabilityService');
const { ok, fail } = require('../utils/helpers');
const { requireFactory } = require('../middlewares/auth');
const guard = require('../services/contentGuard');
const { requirePermission } = require('../config/permissions');
const sessionService = require('../services/sessionService');
const opLog = require('../services/opLogService');
const QRCode = require('qrcode');
const { hashPassword, verifyPassword } = require('../utils/password');

// 设备图文上传目录（静态托管 /uploads，与头像/设计图同机制，base64 落盘）
const MEDIA_DIR = path.join(__dirname, '..', '..', 'uploads', 'factory-media');
const MAX_MEDIA_BYTES = 2 * 1024 * 1024; // 单图 2MB
const MEDIA_TYPES = ['equipment', 'workshop', 'product'];
const MAX_MEDIA_COUNT = 9;              // 每厂图集上限（防滥用膨胀）
const CAPACITY_STATUS = ['idle', 'normal', 'busy'];

/**
 * B端工厂自助管理（工厂端登录后使用）
 * 鉴权：X-Factory-Id + X-Factory-Token（requireFactory）
 * 所有操作仅作用于 req.factory.id 自己的工厂，无需传 factoryId
 */

// 允许自助覆盖的字段白名单（与报价引擎字段对应）
// 020：printingRate 补图案覆盖率三档系数；新增 inkType（油墨类型加价系数）与 plateType.SPOT_COLOR（专色版价）一样走覆盖
const OVERRIDE_FIELDS = {
  rawPaper:     ['price_per_ton', 'grammage'],
  boardPaper:   ['price_per_sqm', 'layers'],
  cardPaper:    ['price_per_sqm', 'grammage'],
  plateType:    ['unit_price'],
  printingRate: ['start_fee', 'extra_per_1000', 'color_rate', 'min_charge', 'ink_factor_low', 'ink_factor_mid', 'ink_factor_high'],
  finishing:    ['rate', 'plate_fee', 'waste_rate'],
  inkType:      ['price_factor'],
};

const CAP_TYPES = ['productType', 'printMode', 'process', 'material'];

// ===== 基本资料 =====

// GET /api/factory/me/profile 工厂资料
router.get('/me/profile', requireFactory, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, code, name, username, contact, phone, address, intro, c_end_enabled, audit_status, created_at,
              rating, rating_count, total_pushes, total_accepts, avg_response_hours, last_login_at,
              license_verified, capacity_status, capacity_note, capacity_updated_at
       FROM factory WHERE id = ?`,
      [req.factory.id]
    );
    if (!rows.length) throw new Error('工厂不存在');
    res.json(ok(rows[0]));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// PUT /api/factory/me/profile 更新资料（名称需联系平台修改，避免审核信息被篡改）
router.put('/me/profile', requireFactory, async (req, res) => {
  try {
    const { contact, phone, address, intro } = req.body || {};
    await pool.query(
      'UPDATE factory SET contact = ?, phone = ?, address = ?, intro = ? WHERE id = ?',
      [contact || null, phone || null, address || null, intro || null, req.factory.id]
    );
    res.json(ok({ updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== 闲置产能（融合印查查：工厂自报产能，撮合优先推空闲厂） =====

// PUT /api/factory/me/capacity 填报产能 { status: idle|normal|busy, note? }
router.put('/me/capacity', requireFactory, async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!CAPACITY_STATUS.includes(status)) throw new Error('产能状态无效（idle/normal/busy）');
    const cleanNote = String(note || '').trim().slice(0, 100) || null;
    await pool.query(
      'UPDATE factory SET capacity_status = ?, capacity_note = ?, capacity_updated_at = NOW() WHERE id = ?',
      [status, cleanNote, req.factory.id]
    );
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'capacity',
      detail: '填报产能：' + status + (cleanNote ? '（' + cleanNote + '）' : ''), req,
    });
    res.json(ok({ status, note: cleanNote }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== 设备图文画像（工厂自助上传设备/车间实拍，C 端详情页图集） =====

// GET /api/factory/me/media 本厂图集（含待审，供业主自查）
router.get('/me/media', requireFactory, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, media_type, url, caption, sort, audit_status, created_at FROM factory_media WHERE factory_id = ? ORDER BY sort ASC, id ASC',
      [req.factory.id]
    );
    res.json(ok({ total: rows.length, list: rows }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/factory/me/media 新增一张 { dataUrl, mediaType?, caption? }（base64 落盘，与头像同机制）
router.post('/me/media', requireFactory, async (req, res) => {
  try {
    const { dataUrl, mediaType, caption } = req.body || {};
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('图片格式不正确（仅支持 png/jpg/gif/webp）');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) throw new Error('图片内容为空');
    if (buf.length > MAX_MEDIA_BYTES) throw new Error('图片不能超过 2MB');
    const [[cnt]] = await pool.query('SELECT COUNT(*) AS c FROM factory_media WHERE factory_id = ?', [req.factory.id]);
    if (cnt.c >= MAX_MEDIA_COUNT) throw new Error('图集最多 ' + MAX_MEDIA_COUNT + ' 张，请先删除旧图');

    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const fname = 'fm' + req.factory.id + '_' + Date.now() + '.' + ext;
    fs.writeFileSync(path.join(MEDIA_DIR, fname), buf);
    const url = '/uploads/factory-media/' + fname;
    const type = MEDIA_TYPES.includes(mediaType) ? mediaType : 'equipment';
    const cleanCap = String(caption || '').trim().slice(0, 100) || null;
    // 内容安全：图注会随工厂主页对外展示（图片本体走后台人工审核，见 audit_status）
    await guard.assertTextAllowed(
      [{ label: '图注', value: cleanCap }],
      { openid: await guard.factoryOpenid(req.factoryUser.id), scene: 'media' }
    );
    const [ret] = await pool.query(
      'INSERT INTO factory_media (factory_id, media_type, url, caption) VALUES (?,?,?,?)',
      [req.factory.id, type, url, cleanCap]
    );
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'media_add',
      detail: '新增设备图文 #'+ret.insertId+'（'+type+'）', req,
    });
    res.json(ok({ id: ret.insertId, url, mediaType: type, caption: cleanCap }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// DELETE /api/factory/me/media/:id 删除本厂一张图（连带清理磁盘文件）
router.delete('/me/media/:id', requireFactory, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[row]] = await pool.query('SELECT id, url FROM factory_media WHERE id = ? AND factory_id = ?', [id, req.factory.id]);
    if (!row) throw new Error('图片不存在');
    await pool.query('DELETE FROM factory_media WHERE id = ?', [id]);
    if (row.url && row.url.startsWith('/uploads/factory-media/')) {
      try { fs.unlinkSync(path.join(MEDIA_DIR, path.basename(row.url))); } catch (e) { /* 文件不存在忽略 */ }
    }
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'media_delete',
      detail: '删除设备图文 #' + id, req,
    });
    res.json(ok({ deleted: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/factory/me/password 修改密码 { oldPassword, newPassword }
router.post('/me/password', requireFactory, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) throw new Error('请输入原密码和新密码');
    if (String(newPassword).length < 6) throw new Error('新密码至少 6 位');
    const [rows] = await pool.query('SELECT password_hash FROM factory WHERE id = ?', [req.factory.id]);
    if (!rows.length || !verifyPassword(oldPassword, rows[0].password_hash)) throw new Error('原密码错误');
    await pool.query('UPDATE factory SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), req.factory.id]);
    res.json(ok({ updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== 价格体系 =====

// GET /api/factory/me/pricing 定价参数 + 价格覆盖清单
router.get('/me/pricing', requireFactory, requirePermission('price:view'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT default_margin, default_tax_rate, default_waste_rate FROM factory WHERE id = ?',
      [req.factory.id]
    );
    if (!rows.length) throw new Error('工厂不存在');
    res.json(ok({
      defaultMargin: Number(rows[0].default_margin),
      defaultTaxRate: Number(rows[0].default_tax_rate),
      defaultWasteRate: Number(rows[0].default_waste_rate),
      overrides: catalog.getOverrides(req.factory.id),
    }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// PUT /api/factory/me/pricing 更新定价参数（比例值 0~1）
router.put('/me/pricing', requireFactory, requirePermission('price:edit'), async (req, res) => {
  try {
    const { defaultMargin, defaultTaxRate, defaultWasteRate } = req.body || {};
    const num = (v, name, max) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${name}需在 0 ~ ${max} 之间`);
      return n;
    };
    const margin = num(defaultMargin, '毛利率', 0.9);
    const tax = num(defaultTaxRate, '税率', 0.5);
    const waste = num(defaultWasteRate, '损耗率', 0.5);
    await pool.query(
      'UPDATE factory SET default_margin = ?, default_tax_rate = ?, default_waste_rate = ? WHERE id = ?',
      [margin, tax, waste, req.factory.id]
    );
    await catalog.loadAll();  // 刷新缓存，报价立即生效
    // F-158：改价落操作日志
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'pricing',
      detail: `定价参数：毛利率=${margin} 税率=${tax} 损耗率=${waste}`, req,
    });
    res.json(ok({ updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// GET /api/factory/me/catalog-options 价格覆盖可选项（材料/印版/印刷方式/工艺，供前端下拉选择）
router.get('/me/catalog-options', requireFactory, (req, res) => {
  const options = {};
  for (const type of Object.keys(OVERRIDE_FIELDS)) {
    options[type] = Object.values(catalog.baseData[type] || {}).map((r) => ({
      code: type === 'printingRate' ? r.print_mode : r.code,
      name: r.name,
    }));
  }
  // 026：工厂计算器材料下拉需要薄膜（薄膜无覆盖机制，仅给 code/name，不含价格）
  options.plasticFilm = Object.values(catalog.baseData.plasticFilm || {}).map((r) => ({ code: r.code, name: r.name }));
  res.json(ok(options));
});

// POST /api/factory/me/override 新增/更新价格覆盖 { targetType, targetCode, fieldName, fieldValue }
router.post('/me/override', requireFactory, requirePermission('price:edit'), async (req, res) => {
  try {
    const { targetType, targetCode, fieldName, fieldValue } = req.body || {};
    const fields = OVERRIDE_FIELDS[targetType];
    if (!fields) throw new Error('覆盖类型无效');
    if (!fields.includes(fieldName)) throw new Error('覆盖字段无效：' + fieldName);
    if (!targetCode) throw new Error('请填写材料/工艺编码');
    // 编码必须存在于对应目录，避免覆盖静默不生效
    if (!catalog.baseData[targetType] || !catalog.baseData[targetType][targetCode]) {
      throw new Error('编码不存在：' + targetCode + '（请先从下拉中选择目录内的材料/工艺）');
    }
    const v = Number(fieldValue);
    if (!Number.isFinite(v) || v < 0) throw new Error('值必须是不小于 0 的数字');
    await pool.query(
      `INSERT INTO factory_price_override (factory_id, target_type, target_code, field_name, field_value)
       VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE field_value = VALUES(field_value)`,
      [req.factory.id, targetType, targetCode, fieldName, v]
    );
    await catalog.loadAll();
    // F-158：价格覆盖落操作日志
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'override',
      detail: `新增覆盖 ${targetType}/${targetCode}.${fieldName} = ${v}`, req,
    });
    res.json(ok({ targetType, targetCode, fieldName, fieldValue: v }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// DELETE /api/factory/me/override 删除价格覆盖 { targetType, targetCode, fieldName }
router.delete('/me/override', requireFactory, requirePermission('price:edit'), async (req, res) => {
  try {
    const { targetType, targetCode, fieldName } = req.body || {};
    if (!targetType || !targetCode || !fieldName) throw new Error('参数不完整');
    await pool.query(
      'DELETE FROM factory_price_override WHERE factory_id = ? AND target_type = ? AND target_code = ? AND field_name = ?',
      [req.factory.id, targetType, targetCode, fieldName]
    );
    await catalog.loadAll();
    // F-158：删除覆盖落操作日志
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'override',
      detail: `删除覆盖 ${targetType}/${targetCode}.${fieldName}`, req,
    });
    res.json(ok({ deleted: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== 员工管理（F-152~F-160，owner 专属 staff:manage） =====

// 可创建的下属角色（owner 唯一：随工厂开户/注册产生，不在员工管理内新增）
const STAFF_ROLES = ['manager', 'sales', 'finance', 'designer', 'viewer'];
const USERNAME_RE = /^[a-zA-Z0-9_]{4,50}$/;

// GET /api/factory/me/staff 员工列表
router.get('/me/staff', requireFactory, requirePermission('staff:manage'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, real_name, phone, role, status, last_login_at, created_at
       FROM factory_user WHERE factory_id = ? ORDER BY (role = 'owner') DESC, id ASC`,
      [req.factory.id]
    );
    res.json(ok(rows));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/factory/me/staff 新增员工 { username, password, realName, phone, role }
router.post('/me/staff', requireFactory, requirePermission('staff:manage'), async (req, res) => {
  try {
    const { username, password, realName, phone, role } = req.body || {};
    if (!USERNAME_RE.test(String(username || ''))) throw new Error('账号需为 4-50 位字母、数字或下划线');
    if (!password || String(password).length < 6) throw new Error('初始密码至少 6 位');
    if (!STAFF_ROLES.includes(role)) throw new Error('角色无效：可选 ' + STAFF_ROLES.join('/'));
    const [[dup]] = await pool.query('SELECT id FROM factory_user WHERE username = ?', [username]);
    if (dup) throw new Error('该账号已被占用，请更换');
    const [ret] = await pool.query(
      `INSERT INTO factory_user (factory_id, username, password_hash, real_name, phone, role, status, created_by)
       VALUES (?,?,?,?,?,?,1,?)`,
      [req.factory.id, username, hashPassword(password), realName || null, phone || null, role, req.factoryUser.id]
    );
    // F-158：新增员工落操作日志
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'staff_add',
      detail: `新增员工 ${username}（${role}）`, req,
    });
    res.json(ok({ id: ret.insertId, username, role }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// PUT /api/factory/me/staff/:id 编辑员工 { realName, phone, role, newPassword? }
router.put('/me/staff/:id', requireFactory, requirePermission('staff:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[target]] = await pool.query(
      'SELECT id, role FROM factory_user WHERE id = ? AND factory_id = ?', [id, req.factory.id]
    );
    if (!target) throw new Error('员工不存在');
    if (target.role === 'owner') throw new Error('老板账号请在「我的资料」中维护');
    const { realName, phone, role, newPassword } = req.body || {};
    if (role !== undefined && !STAFF_ROLES.includes(role)) {
      throw new Error('角色无效：可选 ' + STAFF_ROLES.join('/'));
    }
    // 仅更新传入的字段（重置密码场景只带 newPassword，避免清空姓名/手机）
    const sets = [], params = [];
    if (realName !== undefined) { sets.push('real_name = ?'); params.push(realName || null); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone || null); }
    if (role !== undefined) { sets.push('role = ?'); params.push(role); }
    if (sets.length) {
      params.push(id);
      await pool.query('UPDATE factory_user SET ' + sets.join(', ') + ' WHERE id = ?', params);
    }
    if (newPassword) {
      if (String(newPassword).length < 6) throw new Error('新密码至少 6 位');
      await pool.query('UPDATE factory_user SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), id]);
      await sessionService.destroyByFactoryUser(id);  // 重置密码即踢全部会话（F-157）
    }
    // F-158：编辑员工落操作日志
    const changed = [];
    if (realName !== undefined) changed.push('姓名');
    if (phone !== undefined) changed.push('手机');
    if (role !== undefined) changed.push('角色→' + role);
    if (newPassword) changed.push('重置密码');
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'staff_edit',
      detail: `编辑员工 #${id}${changed.length ? '：' + changed.join('、') : ''}`, req,
    });
    res.json(ok({ updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/factory/me/staff/:id/toggle 禁用/启用（F-159），禁用即失效其全部会话
router.post('/me/staff/:id/toggle', requireFactory, requirePermission('staff:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.factoryUser.id) throw new Error('不能停用自己的账号');
    const [[target]] = await pool.query(
      'SELECT id, role, status FROM factory_user WHERE id = ? AND factory_id = ?', [id, req.factory.id]
    );
    if (!target) throw new Error('员工不存在');
    if (target.role === 'owner') throw new Error('不能停用老板账号');
    const next = target.status ? 0 : 1;
    await pool.query('UPDATE factory_user SET status = ? WHERE id = ?', [next, id]);
    if (!next) await sessionService.destroyByFactoryUser(id);
    // F-158：禁用/启用落操作日志
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'staff_toggle',
      detail: `员工 #${id} ${next ? '启用' : '禁用'}`, req,
    });
    res.json(ok({ id, status: next }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// DELETE /api/factory/me/staff/:id 删除员工（F-160，P1 提前），删除即清会话
router.delete('/me/staff/:id', requireFactory, requirePermission('staff:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.factoryUser.id) throw new Error('不能删除自己的账号');
    const [[target]] = await pool.query(
      'SELECT id, role FROM factory_user WHERE id = ? AND factory_id = ?', [id, req.factory.id]
    );
    if (!target) throw new Error('员工不存在');
    if (target.role === 'owner') throw new Error('不能删除老板账号');
    await sessionService.destroyByFactoryUser(id);
    await pool.query('DELETE FROM factory_user WHERE id = ?', [id]);
    // F-158：删除员工落操作日志
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'staff_delete',
      detail: `删除员工 #${id}`, req,
    });
    res.json(ok({ deleted: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== 生产能力 =====

// ===== F-158：员工操作日志（本厂） =====

// GET /api/factory/me/op-logs 操作日志查询：?username=&action=&page=&pageSize=
router.get('/me/op-logs', requireFactory, requirePermission('staff:view'), async (req, res) => {
  try {
    const data = await opLog.listOps({
      factoryId: req.factory.id,
      username: req.query.username,
      action: req.query.action,
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 30,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== F-102：工厂二维码名片 =====

// GET /api/factory/me/qrcode 生成指向工厂公开名片页（/f/:code）的二维码（PNG dataURL）
router.get('/me/qrcode', requireFactory, async (req, res) => {
  try {
    const [[fac]] = await pool.query('SELECT code FROM factory WHERE id = ?', [req.factory.id]);
    if (!fac || !fac.code) throw new Error('工厂编码缺失，请联系平台');
    const baseUrl = (process.env.H5_BASE_URL || ('http://localhost:' + (process.env.PORT || 6001))).replace(/\/$/, '');
    const url = baseUrl + '/f/' + encodeURIComponent(fac.code);
    const qr = await QRCode.toDataURL(url, { width: 360, margin: 1 });
    res.json(ok({ url, qr }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/factory/me/miniprogram-qrcode（F-102 小程序码）
 * 微信 getwxacodeunlimit：scene=f_{factoryId}，扫码直达 pages/quote/quote 并锁定本厂询价。
 * 小程序码永久有效，生成一次落盘 uploads/qrcode/ 复用，不重复调微信；
 * 未配置 WX_APPID/WX_SECRET（开发模式）返回 503，前端引导「平台未配置微信密钥」。
 */
router.get('/me/miniprogram-qrcode', requireFactory, async (req, res) => {
  try {
    const wxService = require('../services/wxService');
    if (!wxService.isWxConfigured()) {
      return res.status(503).json(fail('平台未配置微信密钥，小程序码暂不可用（当前为开发模式）', 503));
    }
    const scene = 'f_' + req.factory.id;
    const dir = path.join(__dirname, '..', '..', 'uploads', 'qrcode');
    const file = path.join(dir, 'factory_' + req.factory.id + '.png');
    if (!fs.existsSync(file)) {
      const buf = await wxService.getWxacodeUnlimit(scene, 'pages/quote/quote');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, buf);
    }
    opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser, action: 'qrcode',
      detail: '获取专属小程序码（scene=' + scene + '）', req,
    });
    res.json(ok({
      scene,
      page: 'pages/quote/quote',
      qrcodeUrl: '/uploads/qrcode/factory_' + req.factory.id + '.png?v=' + fs.statSync(file).mtimeMs,
      tip: '客户微信扫码后直接进入向你厂询价的页面，不走平台撮合',
    }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

// GET /api/factory/me/capabilities
router.get('/me/capabilities', requireFactory, (req, res) => {
  res.json(ok(capabilityService.getByFactory(req.factory.id)));
});

// POST /api/factory/me/capabilities 整体覆盖式保存
router.post('/me/capabilities', requireFactory, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const body = req.body || {};
    await conn.beginTransaction();
    await conn.query('DELETE FROM factory_capability WHERE factory_id = ?', [req.factory.id]);
    const rows = [];
    for (const type of CAP_TYPES) {
      const codes = Array.isArray(body[type]) ? body[type] : [];
      for (const code of codes) {
        if (typeof code === 'string' && code.length > 0 && code.length <= 50) rows.push([req.factory.id, type, code]);
      }
    }
    if (rows.length) {
      await conn.query(
        'INSERT INTO factory_capability (factory_id, capability_type, capability_code) VALUES ?',
        [rows]
      );
    }
    await conn.commit();
    await capabilityService.loadAll();  // 刷新缓存，工厂匹配立即生效
    res.json(ok({ factoryId: req.factory.id, count: rows.length }));
  } catch (err) {
    await conn.rollback();
    res.status(400).json(fail(err.message));
  } finally {
    conn.release();
  }
});

module.exports = router;
