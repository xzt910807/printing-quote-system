const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, toCsv, sendCsv } = require('../utils/helpers');
const { requirePermission } = require('../config/permissions');

// 026：工厂身份访问时返回本厂 ID，null 表示管理端（看全部）
function actorFactoryId(req) {
  return req.factoryUser ? req.factoryUser.factoryId : null;
}

router.get('/', requirePermission('customer:manage'), async (req, res) => {
  try {
    const { factoryId, keyword, page, pageSize } = req.query;
    const conditions = [];
    const params = [];
    // 026：工厂端强制只看本厂客户（平台公共客户由平台管理，不对工厂开放编辑）
    const ownFid = actorFactoryId(req);
    if (ownFid) { conditions.push('factory_id = ?'); params.push(ownFid); }
    else if (factoryId) { conditions.push('factory_id = ?'); params.push(factoryId); }
    // stage14 列表搜索：客户名 / 联系人 / 电话 模糊匹配
    if (keyword && String(keyword).trim()) {
      const like = '%' + String(keyword).trim() + '%';
      conditions.push('(name LIKE ? OR contact LIKE ? OR phone LIKE ?)');
      params.push(like, like, like);
    }
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    // stage16 分页：带 page/pageSize 时返回 {list,total,page,pageSize}，否则保持旧数组结构兼容
    if (page || pageSize) {
      const p = parseInt(page, 10) || 1;
      const ps = parseInt(pageSize, 10) || 20;
      // 027：VIP 客户排前面，同等级内按 id 倒序
      const [rows] = await pool.query(
        'SELECT * FROM customer' + where + ' ORDER BY (level = \'vip\') DESC, id DESC LIMIT ? OFFSET ?',
        [...params, ps, (p - 1) * ps]
      );
      const [cnt] = await pool.query('SELECT COUNT(*) AS total FROM customer' + where, params);
      return res.json(ok({ list: rows, total: cnt[0].total, page: p, pageSize: ps }));
    }
    let sql = 'SELECT * FROM customer';
    if (conditions.length) sql += where;
    sql += ' ORDER BY (level = \'vip\') DESC, id DESC';
    const [rows] = await pool.query(sql, params);
    res.json(ok(rows));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

router.post('/', requirePermission('customer:manage'), async (req, res) => {
  try {
    // 026：工厂端新建客户强制归属本厂
    const factoryId = actorFactoryId(req) || parseInt(req.body.factoryId, 10) || 0;
    const { name, contact, phone, address, level = 'normal', discount = 0 } = req.body;
    if (!name) throw new Error('客户名称不能为空');
    const [ret] = await pool.query('INSERT INTO customer (factory_id, name, contact, phone, address, level, discount) VALUES (?,?,?,?,?,?,?)', [factoryId, name, contact, phone, address, level, discount]);
    res.json(ok({ id: ret.insertId, name }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/**
 * GET /api/customer/export
 * 导出客户列表 CSV（需在动态路由之前定义）
 */
router.get('/export', requirePermission('customer:manage'), async (req, res) => {
  try {
    // 026：工厂端导出仅限本厂客户
    const ownFid = actorFactoryId(req);
    const where = ownFid ? ' WHERE factory_id = ?' : '';
    const [rows] = await pool.query(
      'SELECT id, factory_id, name, contact, phone, address, level, discount, created_at FROM customer' + where + ' ORDER BY id DESC',
      ownFid ? [ownFid] : []
    );
    // 客户等级导出转中文（level 取值 normal/vip, 直接落 CSV 会露英文）
    const csvRows = rows.map((r) => Object.assign({}, r, {
      level: r.level === 'vip' ? 'VIP' : (r.level === 'normal' ? '普通' : (r.level || '')),
    }));
    const csv = toCsv([
      { key: 'id', label: 'ID' },
      { key: 'name', label: '客户名称' },
      { key: 'contact', label: '联系人' },
      { key: 'phone', label: '电话' },
      { key: 'address', label: '地址' },
      { key: 'level', label: '等级' },
      { key: 'discount', label: '折扣' },
      { key: 'factory_id', label: '工厂ID' },
      { key: 'created_at', label: '创建时间' },
    ], csvRows);
    sendCsv(res, 'customers.csv', csv);
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

/**
 * PUT /api/customer/:id
 * 编辑客户
 */
router.put('/:id', requirePermission('customer:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, contact, phone, address, level = 'normal', discount = 0 } = req.body;
    if (!name) throw new Error('客户名称不能为空');
    // 026：工厂端只能改本厂客户（factory_id 带条件更新，越权时 affectedRows=0）
    const ownFid = actorFactoryId(req);
    const factoryId = ownFid || parseInt(req.body.factoryId, 10) || 0;
    const [ret] = await pool.query(
      'UPDATE customer SET factory_id=?, name=?, contact=?, phone=?, address=?, level=?, discount=? WHERE id=?' + (ownFid ? ' AND factory_id=?' : ''),
      ownFid
        ? [factoryId, name, contact || null, phone || null, address || null, level, discount, id, ownFid]
        : [factoryId, name, contact || null, phone || null, address || null, level, discount, id]
    );
    if (!ret.affectedRows) throw new Error(ownFid ? '客户不存在或不属于本厂' : '客户不存在');
    res.json(ok({ id, name }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

/**
 * DELETE /api/customer/:id
 * 删除客户（已被报价单引用的不允许删除，保护历史数据）
 */
router.delete('/:id', requirePermission('customer:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // 026：工厂端只能删本厂客户
    const ownFid = actorFactoryId(req);
    if (ownFid) {
      const [rows] = await pool.query('SELECT factory_id FROM customer WHERE id = ?', [id]);
      if (!rows.length) throw new Error('客户不存在');
      if (Number(rows[0].factory_id) !== Number(ownFid)) throw new Error('该客户不属于本厂，无权删除');
    }
    const [refs] = await pool.query('SELECT COUNT(*) AS n FROM quote_order WHERE customer_id = ?', [id]);
    if (refs[0].n > 0) throw new Error('该客户已有 ' + refs[0].n + ' 张报价单，不能删除');
    const [ret] = await pool.query('DELETE FROM customer WHERE id = ?', [id]);
    if (!ret.affectedRows) throw new Error('客户不存在');
    res.json(ok({ id, deleted: true }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;
