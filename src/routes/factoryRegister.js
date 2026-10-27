const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireAdmin, optionalUser } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');
const catalog = require('../services/catalogService');
const { hashPassword } = require('../utils/password');

/**
 * 工厂自助注册 + 管理端审核
 * 注册流程：工厂提交资料与账号 → status=0 / audit_status=pending → 管理员审核 → approved 激活 / rejected 驳回
 */

/**
 * POST /api/factory/register
 * 工厂自助注册（公开接口，可选携带 C 端登录态）：创建待审核工厂 + 登录账号
 * body: { name, contact, phone, address, intro, username, password }
 * 已登录的 C 端用户提交时自动绑定工厂身份（role=factory，待审核）并把微信 openid
 * 关联到 owner 员工账号，审核通过即可微信一键登录；被驳回由 audit reject 统一解绑
 */
router.post('/register', optionalUser, async (req, res) => {
  try {
    const { name, contact, phone, address, intro, username, password } = req.body || {};
    if (!name) throw new Error('请填写工厂名称');
    if (!username || !/^[a-zA-Z0-9_]{4,50}$/.test(username)) throw new Error('账号需为 4-50 位字母、数字或下划线');
    if (!password || String(password).length < 6) throw new Error('密码至少 6 位');

    // 生成工厂编码：F + 3 位序号（自增避让已占用编码）
    const [[{ maxId }]] = await pool.query('SELECT IFNULL(MAX(id), 0) AS maxId FROM factory');
    let seq = Number(maxId) + 1;
    let code = 'F' + String(seq).padStart(3, '0');
    for (;;) {
      const [[dup]] = await pool.query('SELECT COUNT(*) AS n FROM factory WHERE code = ?', [code]);
      if (!dup.n) break;
      seq++;
      code = 'F' + String(seq).padStart(3, '0');
    }

    const [ret] = await pool.query(
      `INSERT INTO factory (code, username, password_hash, name, contact, phone, address, intro,
         status, audit_status, applied_at)
       VALUES (?,?,?,?,?,?,?,?,0,'pending',NOW())`,
      [code, username, hashPassword(password), name, contact || null, phone || null, address || null, intro || null]
    );
    // 014 之后登录走 factory_user：同步创建 owner 账号（待审核状态，通过前不可登录）
    await pool.query(
      'INSERT INTO factory_user (factory_id, username, password_hash, real_name, phone, role, status) VALUES (?,?,?,?,?,?,0)',
      [ret.insertId, username, hashPassword(password), contact || null, phone || null, 'owner']
    );
    // 双通道入驻：已登录的 C 端用户（从「我的 → 我是工厂 → 申请入驻」进入）自动绑定工厂身份，
    // 并把微信 openid 关联到 owner 账号（审核通过即微信一键登录；与 bind-factory 同一套逻辑）
    let bound = false;
    let wxReassigned = false;
    if (req.user && req.user.id) {
      const [binders] = await pool.query('SELECT role FROM c_end_user WHERE id = ?', [req.user.id]);
      if (binders.length && binders[0].role !== 'factory') {
        await pool.query(
          "UPDATE c_end_user SET role = 'factory', factory_id = ? WHERE id = ?",
          [ret.insertId, req.user.id]
        );
        if (req.user.openid) {
          // 该微信已绑定其他工厂 owner 时让位给新厂（以用户最新注册意图为准）；
          // 一个微信全局只能一键登录一个工厂（uk_factory_user_openid 兜底）
          const [prev] = await pool.query('SELECT factory_id FROM factory_user WHERE openid = ?', [req.user.openid]);
          if (prev.length && prev[0].factory_id !== ret.insertId) wxReassigned = true;
          await pool.query('UPDATE factory_user SET openid = NULL WHERE openid = ?', [req.user.openid]);
          await pool.query(
            "UPDATE factory_user SET openid = ? WHERE factory_id = ? AND role = 'owner'",
            [req.user.openid, ret.insertId]
          );
        }
        bound = true;
      }
    }
    res.json(ok({ id: ret.insertId, code, auditStatus: 'pending', factoryName: name, bound, wxReassigned }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json(fail('该账号已被注册，请更换'));
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/factory/audit/list[?status=pending|approved|rejected|all]
 * 管理端：工厂账号与审核列表（含未开通账号的存量工厂）
 */
router.get('/audit/list', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  try {
    const filter = req.query.status;
    let sql = `SELECT id, code, username, name, contact, phone, address, intro, status, audit_status, applied_at, created_at
               FROM factory`;
    const params = [];
    if (filter && filter !== 'all') {
      sql += ' WHERE audit_status = ?';
      params.push(filter);
    }
    // 待审核的排最前，其余按新→旧
    sql += " ORDER BY (audit_status = 'pending') DESC, id DESC";
    const [rows] = await pool.query(sql, params);
    res.json(ok(rows));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /api/factory/:id/audit
 * 管理端：审核工厂注册 body: { action: 'approve' | 'reject' }
 */
router.post('/:id/audit', requireAdmin, requirePermission('factory:manage'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { action } = req.body || {};
    if (!['approve', 'reject'].includes(action)) throw new Error('action 只能是 approve 或 reject');
    const approved = action === 'approve';
    const [ret] = await pool.query(
      'UPDATE factory SET audit_status = ?, status = ? WHERE id = ?',
      [approved ? 'approved' : 'rejected', approved ? 1 : 0, id]
    );
    if (!ret.affectedRows) throw new Error('工厂不存在');
    // 审核结果同步到工厂员工账号（owner 随审核启停，通过前不可登录）
    await pool.query('UPDATE factory_user SET status = ? WHERE factory_id = ? AND role = ?', [approved ? 1 : 0, id, 'owner']);
    if (!approved) {
      // 驳回自助入驻：清理注册时自动建立的绑定（C 端角色还原、员工微信解绑），
      // 避免申请人挂着"工厂身份"却对应一个未通过的工厂
      await pool.query("UPDATE c_end_user SET role = 'customer', factory_id = NULL WHERE factory_id = ? AND role = 'factory'", [id]);
      await pool.query('UPDATE factory_user SET openid = NULL WHERE factory_id = ?', [id]);
    }
    await catalog.loadAll();  // 刷新缓存：新工厂定价参数立即生效 / 驳回工厂移出缓存
    res.json(ok({ id, auditStatus: approved ? 'approved' : 'rejected' }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
