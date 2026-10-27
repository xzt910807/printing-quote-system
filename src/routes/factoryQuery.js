const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { pool } = require('../config/db');
const capabilityService = require('../services/capabilityService');
const catalog = require('../services/catalogService');
const { ok, fail, maskPhone, capacityOf } = require('../utils/helpers');
const { requireAdmin } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');
const { hashPassword } = require('../utils/password');

/**
 * GET /api/factory/list
 * 查询工厂列表，支持按能力筛选 + 名称/地址关键词搜索 + 排序（F-99/100）
 * 查询参数（都可选）：
 *   productType=carton     只看做纸箱的
 *   printMode=offset       只看有胶印的
 *   process=HOT_STAMP      只看有烫金的（多个用逗号分隔）
 *   materialCode=B_BC5     只看有这种材料的
 *   keyword=鑫             按工厂名称/地址模糊搜索
 *   sort=rating|accepts|response  排序：评分/接单量/响应速度（缺省综合：接单量+评分）
 */
router.get('/list', async (req, res) => {
  try {
    const { productType, printMode, process, materialCode, keyword, sort } = req.query;

    const filter = {
      productType: productType || null,
      printMode: printMode || null,
      materialCode: materialCode || null,
      processes: process ? process.split(',').filter(Boolean) : [],
    };

    // 找出所有匹配的工厂ID
    const matchedIds = capabilityService.findFactories(filter);

    if (!matchedIds.length) {
      return res.json(ok({ total: 0, list: [], names: buildNames() }));
    }

    const kw = (keyword || '').trim();
    // F-100 排序白名单（防注入：只接受预置键，其余回落综合排序）
    // capacity：闲置产能优先（印查查式“推空闲厂”，基于产能权重二级排）
    const SORTS = {
      rating: 'rating DESC, rating_count DESC',
      accepts: 'total_accepts DESC',
      response: 'avg_response_hours IS NULL, avg_response_hours ASC',
    };
    const orderBy = SORTS[sort] || 'total_accepts DESC, rating DESC';
    const [rows] = await pool.query(
      'SELECT id, code, name, contact, phone, address, intro, rating, rating_count, total_accepts, avg_response_hours, license_verified, capacity_status, capacity_note, capacity_updated_at FROM factory WHERE status = 1 AND id IN (?)'
        + (kw ? ' AND (name LIKE ? OR address LIKE ?)' : '')
        + ' ORDER BY ' + orderBy,
      kw ? [matchedIds, '%' + kw + '%', '%' + kw + '%'] : [matchedIds]
    );

    // 附上每家工厂的完整能力 + 产能/验真画像；F-30：找厂列表态工厂联系人脱敏（询价看价流程中才对归属者下发全文）
    let list = rows.map((f) => {
      const cap = capacityOf(f);
      return {
        ...f,
        phone: maskPhone(f.phone),
        capabilities: capabilityService.getByFactory(f.id),
        capacityStatus: cap.status,
        capacityLabel: cap.label,
        capacityNote: cap.note,
        capacityWeight: cap.weight,
        verified: !!f.license_verified,
      };
    });
    // 产能优先排序：空闲 > 正常 > 饱和/未填报，同级再按评分降序、接单量降序
    if (sort === 'capacity') {
      list.sort((a, b) =>
        b.capacityWeight - a.capacityWeight ||
        (Number(b.rating) || 0) - (Number(a.rating) || 0) ||
        (Number(b.total_accepts) || 0) - (Number(a.total_accepts) || 0)
      );
    }

    res.json(ok({ total: list.length, list, names: buildNames() }));
  } catch (err) {
    console.error(err);
    res.status(500).json(fail(err.message, 500));
  }
});

// 能力编码 → 中文名映射（品类名取 product_config，工艺名取后道目录），
// 小程序端据此渲染标签，避免新编码（paperBag/LAMINATE 等）露出英文
function buildNames() {
  const bd = catalog.baseData || {};
  return {
    productType: Object.fromEntries(
      Object.values(bd.productConfig || {}).map((c) => [c.productType, c.productName])
    ),
    process: Object.fromEntries(
      Object.entries(bd.finishing || {}).map(([code, p]) => [code, p.name])
    ),
  };
}

/**
 * GET /api/factory/public/:id
 * C端公开工厂详情：仅对外可见字段（无 api_token 等敏感字段），无需鉴权
 * 供找厂列表 → 工厂详情页使用
 */
router.get('/public/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new Error('参数错误');
    const [rows] = await pool.query(
      'SELECT id, code, name, contact, phone, address, intro, rating, rating_count, total_accepts, avg_response_hours, audit_status, license_verified, capacity_status, capacity_note, capacity_updated_at FROM factory WHERE id = ? AND status = 1', [id]
    );
    if (!rows.length) throw new Error('工厂不存在或已停用');

    // 设备图文：仅下发审核通过的图（驳回/待审不对外）
    const [media] = await pool.query(
      "SELECT media_type, url, caption FROM factory_media WHERE factory_id = ? AND audit_status = 'approved' ORDER BY sort ASC, id ASC LIMIT 18",
      [id]
    );

    const cap = capacityOf(rows[0]);
    res.json(ok({
      ...rows[0],
      phone: maskPhone(rows[0].phone),
      capabilities: capabilityService.getByFactory(id),
      capacityStatus: cap.status,
      capacityLabel: cap.label,
      capacityNote: cap.note,
      // 验真徽章：平台显式核验（license_verified）或注册审核通过（audit_status=approved）均算已核验
      verified: !!rows[0].license_verified || rows[0].audit_status === 'approved',
      media,
      names: buildNames(),
    }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/factory/detail/:id
 * 某工厂的详细信息 + 能力（含内部定价参数，仅管理后台可用）
 */
router.get('/detail/:id', requireAdmin, requirePermission('factory:view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // 显式列名，避免把 api_token 等敏感字段暴露给公开接口
    const [rows] = await pool.query(
      'SELECT id, code, name, contact, phone, address, default_margin, default_tax_rate, default_waste_rate, c_end_enabled, status, created_at, updated_at FROM factory WHERE id = ? AND status = 1', [id]
    );
    if (!rows.length) throw new Error('工厂不存在');

    res.json(ok({
      ...rows[0],
      capabilities: capabilityService.getByFactory(id),
    }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/factory/capabilities/:id
 * 更新某工厂的能力（整体覆盖式更新）
 */
router.post('/capabilities/:id', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = parseInt(req.params.id);
    const { productType = [], printMode = [], process = [], material = [] } = req.body;

    await conn.beginTransaction();
    await conn.query('DELETE FROM factory_capability WHERE factory_id = ?', [id]);

    const rows = [];
    for (const type of ['productType', 'printMode', 'process', 'material']) {
      const codes = { productType, printMode, process, material }[type];
      for (const code of codes) {
        rows.push([id, type, code]);
      }
    }
    if (rows.length) {
      await conn.query(
        'INSERT INTO factory_capability (factory_id, capability_type, capability_code) VALUES ?',
        [rows]
      );
    }
    await conn.commit();

    await capabilityService.loadAll();  // 刷新缓存
    res.json(ok({ factoryId: id, count: rows.length }));
  } catch (err) {
    await conn.rollback();
    res.status(400).json(fail(err.message));
  } finally {
    conn.release();
  }
});

/**
 * POST /api/factory/create
 * 管理端开户：新建工厂（可直接设置登录账号，工厂无需自助注册）
 */
router.post('/create', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  try {
    const { code, name, contact, phone, address, username, password,
      defaultMargin, defaultTaxRate, defaultWasteRate, cEndEnabled } = req.body;
    if (!code) throw new Error('工厂编码不能为空');
    if (!name) throw new Error('工厂名称不能为空');
    if (username && !/^[a-zA-Z0-9_]{4,50}$/.test(username)) throw new Error('账号需为 4-50 位字母、数字或下划线');
    // 开户密码缺省为 000000（首次登录后可在工厂端修改）；显式传密码仍要求 ≥6 位
    const pwd = String(password || '000000');
    if (username && pwd.length < 6) throw new Error('请设置至少 6 位的登录密码');
    const [ret] = await pool.query(
      `INSERT INTO factory (code, username, password_hash, name, contact, phone, address, default_margin, default_tax_rate, default_waste_rate, c_end_enabled, status, audit_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'approved')`,
      [code, username || null, username ? hashPassword(pwd) : null, name, contact || null, phone || null, address || null,
        defaultMargin ?? 0.15, defaultTaxRate ?? 0.10, defaultWasteRate ?? 0.04,
        cEndEnabled === undefined ? 1 : (cEndEnabled ? 1 : 0)]
    );
    // 014 之后登录走 factory_user：同步创建 owner 账号（全局唯一由表约束兜底）
    if (username) {
      await pool.query(
        'INSERT INTO factory_user (factory_id, username, password_hash, real_name, phone, role, status) VALUES (?,?,?,?,?,?,1)',
        [ret.insertId, username, hashPassword(pwd), contact || null, phone || null, 'owner']
      );
    }
    await catalog.loadAll();  // 新工厂立即进入缓存（定价参数 / 报价可用）
    res.json(ok({ id: ret.insertId, code, name }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json(fail('工厂编码或账号已存在'));
    res.status(400).json(fail(err.message));
  }
});

/**
 * PUT /api/factory/:id
 * 编辑工厂基本信息 / 启用停用（status=0 即软删除）
 */
router.put('/:id', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, contact, phone, address,
      defaultMargin, defaultTaxRate, defaultWasteRate, cEndEnabled, status, licenseVerified } = req.body;
    if (!name) throw new Error('工厂名称不能为空');
    const [ret] = await pool.query(
      `UPDATE factory SET name=?, contact=?, phone=?, address=?, default_margin=?, default_tax_rate=?,
              default_waste_rate=?, c_end_enabled=?, status=? WHERE id=?`,
      [name, contact || null, phone || null, address || null,
        defaultMargin ?? 0.15, defaultTaxRate ?? 0.10, defaultWasteRate ?? 0.04,
        cEndEnabled === undefined ? 1 : (cEndEnabled ? 1 : 0),
        status === undefined ? 1 : (status ? 1 : 0), id]
    );
    if (!ret.affectedRows) throw new Error('工厂不存在');
    // 验真徽章开关（仅当显式传入时更新，不影响未携带该字段的旧编辑请求）
    if (licenseVerified !== undefined) {
      await pool.query('UPDATE factory SET license_verified = ? WHERE id = ?', [licenseVerified ? 1 : 0, id]);
    }
    // 029：停用工厂不再连带禁用员工账号——factory.status=0 本身已全链路拦截
    // （登录 auth.js 报「工厂已被停用」，中间件拒绝对话，C 端不展示），
    // 而旧逻辑把全部 factory_user.status 清零后，重新启用只恢复工厂态，
    // 老板自己的账号仍被禁用且无人能登进去恢复，工厂等于永久锁死。
    // 员工账号的启停保留给老板在「员工管理」自行处理。
    await catalog.loadAll();  // 定价参数变更后刷新缓存，报价立即生效
    res.json(ok({ id, updated: true }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/**
 * GET /:id/invite-codes（同时经 /api/admin/factory/:id/invite-codes 可达，见 app.js 挂载）
 * 该厂邀请码列表（含使用状态），管理后台邀请码弹窗用
 */
router.get('/:id/invite-codes', requireAdmin, requirePermission('factory:view'), async (req, res) => {
  try {
    const factoryId = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      'SELECT id, code, used, created_at FROM factory_invite_code WHERE factory_id = ? ORDER BY id DESC',
      [factoryId]
    );
    res.json(ok({
      total: rows.length,
      list: rows.map((r) => ({ ...r, used: !!r.used })),
    }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /:id/invite-codes（同时经 /api/admin/factory/:id/invite-codes 可达）
 * 生成 8 位随机邀请码（去掉 I/O/0/1 防混淆），码唯一由表 UNIQUE 约束兜底
 */
router.post('/:id/invite-codes', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  try {
    const factoryId = parseInt(req.params.id, 10);
    const [factories] = await pool.query('SELECT id FROM factory WHERE id = ?', [factoryId]);
    if (!factories.length) throw new Error('工厂不存在');

    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    // 碰撞则重生成（UNIQUE 约束兜底最后一道）
    do {
      code = Array.from({ length: 8 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    } while ((await pool.query('SELECT 1 FROM factory_invite_code WHERE code = ?', [code]))[0].length);

    const [ret] = await pool.query(
      'INSERT INTO factory_invite_code (code, factory_id) VALUES (?, ?)', [code, factoryId]
    );
    res.json(ok({ id: ret.insertId, code, factoryId }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/factory/:id/media（管理端）
 * 查该厂全部图文（含待审/驳回），供审核与排查
 */
router.get('/:id/media', requireAdmin, requirePermission('factory:view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      'SELECT id, media_type, url, caption, sort, audit_status, created_at FROM factory_media WHERE factory_id = ? ORDER BY sort ASC, id ASC',
      [id]
    );
    res.json(ok({ total: rows.length, list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/**
 * POST /api/factory/media/:mediaId/audit（管理端）
 * 审核工厂设备图文：{ action: 'approve' | 'reject' }，驳回同时清磁盘文件
 */
router.post('/media/:mediaId/audit', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  try {
    const mediaId = parseInt(req.params.mediaId, 10);
    const action = (req.body || {}).action;
    if (!['approve', 'reject'].includes(action)) throw new Error('action 必须为 approve 或 reject');
    const [[row]] = await pool.query('SELECT id, url, factory_id FROM factory_media WHERE id = ?', [mediaId]);
    if (!row) throw new Error('图片不存在');
    if (action === 'approve') {
      await pool.query("UPDATE factory_media SET audit_status = 'approved' WHERE id = ?", [mediaId]);
    } else {
      await pool.query('DELETE FROM factory_media WHERE id = ?', [mediaId]);
      // 驳回即清理文件（限定本服务上传目录内）
      if (row.url && row.url.startsWith('/uploads/factory-media/')) {
        try { require('fs').unlinkSync(require('path').join(__dirname, '..', '..', 'uploads', 'factory-media', require('path').basename(row.url))); } catch (e) { /* 忽略 */ }
      }
    }
    res.json(ok({ id: mediaId, action }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;