const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireSuper } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');
const { hashPassword } = require('../utils/password');
const feeService = require('../services/feeService');
const opLog = require('../services/opLogService');

/**
 * 管理后台账户管理（挂载层已统一 requireAdmin）
 * 权限：全部端点仅超级管理员（account:manage，F-27）
 */

// GET /api/admin/users 账户列表
router.get('/users', requirePermission('account:manage'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, nickname, role, status, last_login_at, created_at
       FROM admin_user ORDER BY id`
    );
    res.json(ok(rows));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

// POST /api/admin/users 新增管理员 { username, password, nickname, role }
router.post('/users', requireSuper, async (req, res) => {
  try {
    const { username, password, nickname, role } = req.body || {};
    if (!username || !password) throw new Error('请输入用户名和密码');
    if (String(password).length < 6) throw new Error('密码至少 6 位');
    const r = role === 'super' ? 'super' : 'admin';
    const [ret] = await pool.query(
      'INSERT INTO admin_user (username, password_hash, nickname, role, status) VALUES (?,?,?,?,1)',
      [username, hashPassword(password), nickname || null, r]
    );
    res.json(ok({ id: ret.insertId, username, role: r }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json(fail('用户名已存在'));
    res.status(400).json(fail(err.message));
  }
});

// PUT /api/admin/users/:id 修改账户 { nickname, role, status }（仅传需要修改的字段）
router.put('/users/:id', requireSuper, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.admin.id) throw new Error('不能修改自己的角色或启停状态');

    const { nickname, role, status } = req.body || {};
    const sets = [];
    const params = [];
    if (nickname !== undefined) { sets.push('nickname = ?'); params.push(nickname || null); }
    if (role !== undefined) {
      if (!['super', 'admin'].includes(role)) throw new Error('角色只能是 super 或 admin');
      sets.push('role = ?'); params.push(role);
    }
    if (status !== undefined) { sets.push('status = ?'); params.push(status ? 1 : 0); }
    if (!sets.length) throw new Error('没有要修改的字段');

    params.push(id);
    const [ret] = await pool.query(`UPDATE admin_user SET ${sets.join(', ')} WHERE id = ?`, params);
    if (!ret.affectedRows) throw new Error('账户不存在');

    // 被禁用的账户立即作废其会话令牌
    if (status !== undefined && !status) {
      await pool.query('UPDATE admin_user SET token = NULL WHERE id = ?', [id]);
    }
    res.json(ok({ id, updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/admin/users/:id/reset-password 重置密码 { newPassword }
router.post('/users/:id/reset-password', requireSuper, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) throw new Error('新密码至少 6 位');
    // 重置后作废该账户当前会话，强制重新登录
    const [ret] = await pool.query(
      'UPDATE admin_user SET password_hash = ?, token = NULL WHERE id = ?',
      [hashPassword(newPassword), id]
    );
    if (!ret.affectedRows) throw new Error('账户不存在');
    res.json(ok({ id, updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// ===== F-57：平台服务费台账（finance:view，财务对账用） =====

// GET /api/admin/fee-ledger 台账列表 ?status=pending|settled&page=&pageSize=
router.get('/fee-ledger', requirePermission('finance:view'), async (req, res) => {
  try {
    const data = await feeService.listLedger({
      status: req.query.status,
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 50,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

// POST /api/admin/fee-ledger/:id/settle 标记结算（pending → settled，幂等）
router.post('/fee-ledger/:id/settle', requirePermission('finance:view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [ret] = await pool.query(
      "UPDATE platform_fee_ledger SET status = 'settled', settled_at = NOW() WHERE id = ? AND status = 'pending'",
      [id]
    );
    if (!ret.affectedRows) throw new Error('台账不存在或已结算');
    res.json(ok({ id, status: 'settled' }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// GET /api/admin/factory/:id/op-logs 管理端查看指定工厂员工操作日志（F-158）
// 查询参数：username（账号模糊）、action（动作编码）、page、pageSize
router.get('/factory/:id/op-logs', requirePermission('factory:manage'), async (req, res) => {
  try {
    const factoryId = parseInt(req.params.id, 10);
    if (!factoryId) throw new Error('工厂 ID 不合法');
    const data = await opLog.listOps({
      factoryId,
      username: req.query.username || undefined,
      action: req.query.action || undefined,
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 30,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
