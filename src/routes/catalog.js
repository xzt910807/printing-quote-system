const express = require('express');
const router = express.Router();
const catalog = require('../services/catalogService');
const { pool } = require('../config/db');
const { ok, fail, parseJsonField } = require('../utils/helpers');
const { requirePermission } = require('../config/permissions');

// Stage10 目录维护白名单：后台「目录数据」页可编辑的目录表
// 表名/主键/可写字段全部显式声明，杜绝 SQL 注入面；hasActive=false 的表（printing_rate）
// 无 is_active 列，停用即物理删除
const CATALOG_TABLES = {
  rawPaper:     { table: 'raw_paper',         key: 'code',       hasActive: true,
    fields: ['code', 'name', 'grammage', 'price_per_ton', 'paper_type', 'supplier', 'is_local', 'is_active'] },
  boardPaper:   { table: 'board_paper',       key: 'code',       hasActive: true,
    fields: ['code', 'name', 'flute', 'layers', 'price_per_sqm', 'supplier', 'is_local', 'is_active'] },
  cardPaper:    { table: 'card_paper',        key: 'code',       hasActive: true,
    fields: ['code', 'name', 'grammage', 'price_per_sqm', 'supplier', 'is_active'] },
  plasticFilm:  { table: 'plastic_film',      key: 'code',       hasActive: true,
    fields: ['code', 'name', 'material', 'thickness_um', 'density', 'price_per_kg', 'supplier', 'is_active'] },
  plateType:    { table: 'plate_type',        key: 'code',       hasActive: true,
    fields: ['code', 'name', 'unit_price', 'unit', 'print_mode', 'is_active'] },
  printingRate: { table: 'printing_rate',     key: 'print_mode', hasActive: false,
    fields: ['print_mode', 'name', 'mode', 'color_rate', 'start_fee', 'extra_per_1000', 'min_charge', 'ink_factor_low', 'ink_factor_mid', 'ink_factor_high', 'description'] },
  finishing:    { table: 'finishing_process', key: 'code',       hasActive: true,
    fields: ['code', 'name', 'mode', 'rate', 'plate_fee', 'waste_rate', 'print_mode', 'is_active', 'small_qty_threshold', 'small_qty_factor'] },
  // 020 油墨类型目录：图案/油墨/专色三参数的系数源开放后台维护（016 建表后首次纳入白名单）
  inkType:      { table: 'ink_type',          key: 'code',       hasActive: true,
    fields: ['code', 'name', 'price_factor', 'is_active'] },
};

// 工厂对外可见字段（显式列出，避免 api_token / password_hash 等敏感字段泄漏）
const FACTORY_PUBLIC_COLS = 'id, code, username, name, contact, phone, address, intro, default_margin, default_tax_rate, default_waste_rate, c_end_enabled, status, audit_status, license_verified, applied_at, created_at, updated_at';

/**
 * GET /api/catalog/factories
 * 默认：仅返回正常工厂；?all=1：返回全部（含停用），管理后台用
 * 注：/api/catalog 整体在挂载层已要求管理员令牌（见 src/app.js），此处无需重复校验
 */
router.get('/factories', requirePermission('factory:view'), async (req, res) => {
  try {
    const sql = req.query.all === '1'
      ? `SELECT ${FACTORY_PUBLIC_COLS} FROM factory ORDER BY id`
      : `SELECT ${FACTORY_PUBLIC_COLS} FROM factory WHERE status = 1 ORDER BY id`;
    const [rows] = await pool.query(sql);
    res.json(ok(rows));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

router.get('/product-config/:productType', requirePermission('catalog:view'), (req, res) => {
  try {
    const cfg = catalog.getProductConfig(req.params.productType);
    if (!cfg) return res.status(404).json(fail('未找到该产品类型的配置'));
    res.json(ok(cfg));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

router.get('/product-types', requirePermission('catalog:view'), (req, res) => {
  try {
    const list = Object.values(catalog.baseData.productConfig || {})
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((c) => ({ productType: c.productType, productName: c.productName }));
    res.json(ok(list));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

router.get('/factory/:id', requirePermission('catalog:view'), (req, res) => {
  try { res.json(ok(catalog.getFullCatalog(parseInt(req.params.id)))); }
  catch (err) { res.status(500).json(fail(err.message, 500)); }
});

router.get('/factory/:id/overrides', requirePermission('catalog:view'), (req, res) => {
  res.json(ok(catalog.getOverrides(parseInt(req.params.id))));
});

router.post('/override', requirePermission('catalog:edit'), async (req, res) => {
  try {
    const { factoryId, targetType, targetCode, fieldName, fieldValue, remark } = req.body;
    if (!factoryId || !targetType || !targetCode || !fieldName) throw new Error('缺少必要参数');
    await pool.query(
      'INSERT INTO factory_price_override (factory_id, target_type, target_code, field_name, field_value, remark) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE field_value = VALUES(field_value), remark = VALUES(remark)',
      [factoryId, targetType, targetCode, fieldName, fieldValue, remark || null]
    );
    await catalog.loadAll();
    res.json(ok({ factoryId, targetType, targetCode, fieldName, fieldValue }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

router.delete('/override', requirePermission('catalog:edit'), async (req, res) => {
  try {
    const { factoryId, targetType, targetCode, fieldName } = req.body;
    await pool.query('DELETE FROM factory_price_override WHERE factory_id=? AND target_type=? AND target_code=? AND field_name=?', [factoryId, targetType, targetCode, fieldName]);
    await catalog.loadAll();
    res.json(ok({ deleted: true }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

router.post('/reload', requirePermission('catalog:edit'), async (req, res) => {
  try { await catalog.loadAll(); res.json(ok({ loadedAt: catalog.loadedAt })); }
  catch (err) { res.status(500).json(fail(err.message, 500)); }
});

/**
 * PUT /api/catalog/item
 * 目录行新增/更新（upsert）。body: { group, key, data }
 *   有 key：按主键 UPDATE；无 key：按唯一键 INSERT ... ON DUPLICATE KEY UPDATE
 * 写库后刷新目录缓存，报价立即生效
 */
router.put('/item', requirePermission('catalog:edit'), async (req, res) => {
  try {
    const { group, key, data } = req.body || {};
    const meta = CATALOG_TABLES[group];
    if (!meta) throw new Error('不支持的目录分组：' + group);
    if (!data || typeof data !== 'object') throw new Error('缺少 data');
    const clean = {};
    for (const f of meta.fields) if (data[f] !== undefined) clean[f] = data[f];
    if (!Object.keys(clean).length) throw new Error('没有可写字段');
    if (key) {
      const [ret] = await pool.query(`UPDATE ${meta.table} SET ? WHERE ${meta.key} = ?`, [clean, String(key)]);
      if (!ret.affectedRows) throw new Error('记录不存在：' + key);
    } else {
      if (clean[meta.key] === undefined || clean[meta.key] === null || clean[meta.key] === '') {
        throw new Error('新增缺少主键字段 ' + meta.key);
      }
      const ks = Object.keys(clean);
      await pool.query(
        `INSERT INTO ${meta.table} (${ks.join(',')}) VALUES (?) ON DUPLICATE KEY UPDATE ${ks.map((k) => `${k} = VALUES(${k})`).join(', ')}`,
        [ks.map((k) => clean[k])]
      );
    }
    await catalog.loadAll();
    // 028：新增后道工艺自动并入全部品类白名单——引擎对非白名单工艺严格拒绝
    // （engine.js validateInput），若无这一步，目录加了新工艺还得手改 product_config 表才能计价。
    // 仅新增路径执行；编辑/停用不触碰白名单，管理员按品类裁剪后不会被保存动作回写覆盖
    if (!key && group === 'finishing' && clean.is_active !== 0) {
      const newCode = String(clean[meta.key]);
      const [pconfigs] = await pool.query('SELECT id, allowed_processes FROM product_config WHERE is_active = 1');
      for (const pc of pconfigs) {
        const list = parseJsonField(pc.allowed_processes, []);
        if (!Array.isArray(list) || list.includes(newCode)) continue;
        list.push(newCode);
        await pool.query('UPDATE product_config SET allowed_processes = ? WHERE id = ?', [JSON.stringify(list), pc.id]);
      }
      await catalog.loadAll(); // 白名单变更同步进内存缓存
    }
    res.json(ok({ saved: true, group, key: key || clean[meta.key] }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/**
 * POST /api/catalog/item/toggle
 * 启停目录行。有 is_active 列的表软停（可再启用）；printing_rate 无该列，停用即删除
 */
router.post('/item/toggle', requirePermission('catalog:edit'), async (req, res) => {
  try {
    const { group, key, active } = req.body || {};
    const meta = CATALOG_TABLES[group];
    if (!meta) throw new Error('不支持的目录分组：' + group);
    if (!key) throw new Error('缺少主键');
    if (meta.hasActive) {
      await pool.query(`UPDATE ${meta.table} SET is_active = ? WHERE ${meta.key} = ?`, [active ? 1 : 0, String(key)]);
    } else if (!active) {
      await pool.query(`DELETE FROM ${meta.table} WHERE ${meta.key} = ?`, [String(key)]);
    } else {
      throw new Error('该目录不支持停用恢复，请直接编辑保存');
    }
    await catalog.loadAll();
    res.json(ok({ toggled: true, group, key, active: !!active }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

router.get('/', requirePermission('catalog:view'), async (req, res) => {
  try {
    // 默认：仅启用行（供报价链路使用）；?all=1：含停用行，供后台目录维护页展示与启停
    if (req.query.all !== '1') return res.json(ok(catalog.baseData));
    const bd = {
      fluteFactor: catalog.baseData.fluteFactor,
      productConfig: catalog.baseData.productConfig,
    };
    for (const [group, meta] of Object.entries(CATALOG_TABLES)) {
      const [rows] = await pool.query(`SELECT * FROM ${meta.table} ORDER BY ${meta.key}`);
      bd[group] = Object.fromEntries(rows.map((r) => [r[meta.key], r]));
    }
    res.json(ok(bd));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

module.exports = router;
