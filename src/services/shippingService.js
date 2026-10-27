const { pool } = require('../config/db');
const { round } = require('../utils/helpers');

/**
 * 运费模板服务（stage13）
 * 三种计费方式：weight 按重（首重+续重）、piece 按件、fixed 固定；
 * 均支持 free_threshold 满额包邮（0=不包邮）。
 * 订单在工厂「确认订单」时按默认模板计算运费；按重模式需工厂填写重量。
 */
const MODES = ['weight', 'piece', 'fixed'];

async function listTemplates({ includeInactive = true } = {}) {
  let sql = 'SELECT * FROM shipping_template';
  if (!includeInactive) sql += ' WHERE is_active = 1';
  sql += ' ORDER BY is_default DESC, id ASC';
  const [rows] = await pool.query(sql);
  return rows;
}

async function getDefaultTemplate() {
  const [rows] = await pool.query(
    'SELECT * FROM shipping_template WHERE is_default = 1 AND is_active = 1 LIMIT 1'
  );
  return rows[0] || null;
}

/**
 * 计算运费
 * @returns {{fee:number, freeShipping:boolean}}
 */
function calcShippingFee(template, { totalPrice = 0, quantity = 0, weightKg } = {}) {
  if (!template) return { fee: 0, freeShipping: false };
  const threshold = Number(template.free_threshold) || 0;
  if (threshold > 0 && Number(totalPrice) >= threshold) {
    return { fee: 0, freeShipping: true };
  }
  let fee = 0;
  if (template.mode === 'weight') {
    const w = Number(weightKg);
    if (!(w > 0)) throw new Error('按重计费的模板需要填写货物重量（kg）');
    const firstW = Number(template.first_weight_kg) || 1;
    const firstFee = Number(template.first_fee) || 0;
    const extraW = Number(template.extra_weight_kg) || 1;
    const extraFee = Number(template.extra_fee) || 0;
    const extraUnits = w <= firstW ? 0 : Math.ceil((w - firstW) / extraW);
    fee = firstFee + extraUnits * extraFee;
  } else if (template.mode === 'piece') {
    fee = (Number(template.piece_fee) || 0) * (parseInt(quantity, 10) || 0);
  } else {
    fee = Number(template.fixed_fee) || 0;
  }
  return { fee: round(fee, 2), freeShipping: false };
}

/**
 * 新增/更新模板；isDefault 时事务内清除其他默认（全表至多一个默认模板）。
 * 更新为 merge 语义：未传字段保留原值（设默认等局部更新不会重置参数）。
 */
async function saveTemplate(t) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let id = parseInt(t.id, 10) || null;
    if (id) {
      const [rows] = await conn.query('SELECT * FROM shipping_template WHERE id = ?', [id]);
      if (!rows.length) throw new Error('模板不存在');
      const old = rows[0];
      const name = t.name !== undefined ? String(t.name).trim() : old.name;
      const mode = t.mode !== undefined ? String(t.mode) : old.mode;
      if (!MODES.includes(mode)) throw new Error('计费方式必须是 weight/piece/fixed');
      const fields = [
        name, mode,
        t.firstWeightKg !== undefined ? Number(t.firstWeightKg) : Number(old.first_weight_kg),
        t.firstFee !== undefined ? Number(t.firstFee) : Number(old.first_fee),
        t.extraWeightKg !== undefined ? Number(t.extraWeightKg) : Number(old.extra_weight_kg),
        t.extraFee !== undefined ? Number(t.extraFee) : Number(old.extra_fee),
        t.pieceFee !== undefined ? Number(t.pieceFee) : Number(old.piece_fee),
        t.fixedFee !== undefined ? Number(t.fixedFee) : Number(old.fixed_fee),
        t.freeThreshold !== undefined ? Number(t.freeThreshold) : Number(old.free_threshold),
        t.isActive === undefined ? old.is_active : (t.isActive ? 1 : 0),
      ];
      await conn.query(
        `UPDATE shipping_template SET name=?, mode=?, first_weight_kg=?, first_fee=?,
           extra_weight_kg=?, extra_fee=?, piece_fee=?, fixed_fee=?, free_threshold=?, is_active=?
         WHERE id=?`,
        [...fields, id]
      );
    } else {
      const mode = String(t.mode || '');
      if (!t.name || !String(t.name).trim()) throw new Error('模板名称不能为空');
      if (!MODES.includes(mode)) throw new Error('计费方式必须是 weight/piece/fixed');
      const fields = [
        String(t.name).trim(), mode,
        Number(t.firstWeightKg) || 1, Number(t.firstFee) || 0,
        Number(t.extraWeightKg) || 1, Number(t.extraFee) || 0,
        Number(t.pieceFee) || 0, Number(t.fixedFee) || 0,
        Number(t.freeThreshold) || 0,
        t.isActive === undefined ? 1 : (t.isActive ? 1 : 0),
      ];
      const [ret] = await conn.query(
        `INSERT INTO shipping_template
           (name, mode, first_weight_kg, first_fee, extra_weight_kg, extra_fee,
            piece_fee, fixed_fee, free_threshold, is_active)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        fields
      );
      id = ret.insertId;
    }
    if (t.isDefault) {
      await conn.query('UPDATE shipping_template SET is_default = 0 WHERE id != ?', [id]);
      await conn.query('UPDATE shipping_template SET is_default = 1 WHERE id = ?', [id]);
    }
    await conn.commit();
    return { id };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function toggleTemplate(id, isActive) {
  const [ret] = await pool.query(
    'UPDATE shipping_template SET is_active = ? WHERE id = ?',
    [isActive ? 1 : 0, parseInt(id, 10)]
  );
  if (!ret.affectedRows) throw new Error('模板不存在');
  return { id: parseInt(id, 10), isActive: !!isActive };
}

module.exports = { MODES, listTemplates, getDefaultTemplate, calcShippingFee, saveTemplate, toggleTemplate };
