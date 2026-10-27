const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireAdmin, requireFactory } = require('../middlewares/auth');
const { permsForRole, requirePermission } = require('../config/permissions');
const { hashPassword, verifyPassword } = require('../utils/password');
const { loginGuard, recordLoginFail, clearLoginFail } = require('../middlewares/rateLimit');
const sessionService = require('../services/sessionService');
const opLog = require('../services/opLogService');

/**
 * 统一账号体系（013/014 迁移后）：
 *   管理端 admin_user（role=super/admin）；工厂端 factory_user（role=owner/manager/sales/finance/designer/viewer）
 * 登录一律创建 user_session 会话（多设备最多 5 个，自动踢最旧）；令牌 64 位 hex，7 天滑动续期
 */

/**
 * F-149：异地登录提醒——新建会话后比较上一条会话 IP，不同则提醒
 * C 端发站内信；工厂端写操作日志（owner 在员工管理/日志中可见）；管理端打日志
 */
async function notifyAbnormalLogin({ userType, userId, factoryUser, req }) {
  try {
    const [rows] = await pool.query(
      'SELECT ip FROM user_session WHERE user_type = ? AND user_id = ? ORDER BY id DESC LIMIT 2',
      [userType, userId]
    );
    if (rows.length < 2 || !rows[0].ip || !rows[1].ip) return;
    // 历史会话可能带 ::ffff: 前缀（修复前入库），比较前先归一化，否则同 IP 也误报
    const norm = (v) => String(v || '').replace(/^::ffff:/i, '');
    if (norm(rows[0].ip) === norm(rows[1].ip)) return;
    const ip = norm(rows[0].ip);
    if (userType === 'customer') {
      await pool.query(
        `INSERT INTO c_message (user_id, type, title, content, ref_type, ref_id)
         VALUES (?, 'security', '异地登录提醒', ?, 'security', 0)`,
        [userId, `你的账号刚刚在新设备/新网络登录（IP：${ip}）。如非本人操作，请尽快检查账号安全。`]
      );
    } else if (userType === 'factory') {
      await opLog.logOp({
        factoryId: userId, factoryUser,
        action: 'login_abnormal',
        detail: '异地登录提醒：本次登录 IP ' + ip + ' 与上次不同',
        req,
      });
    } else {
      console.warn('[security] 管理员疑似异地登录 userId=' + userId + ' ip=' + ip);
    }
  } catch (e) {
    console.error('[security] 异地登录提醒失败:', e.message);
  }
}

/**
 * 微信 code 换 openid（user-login 与 factory-wx-login 共用）
 * 未配置 WX_APPID/SECRET 时降级为开发身份（dev_<devId>），与 user-login 行为一致
 */
async function exchangeWxOpenid(code, devId) {
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_SECRET;
  if (appid && secret && code) {
    const url = 'https://api.weixin.qq.com/sns/jscode2session'
      + '?appid=' + encodeURIComponent(appid)
      + '&secret=' + encodeURIComponent(secret)
      + '&js_code=' + encodeURIComponent(code)
      + '&grant_type=authorization_code';
    const wxRes = await fetch(url);
    const wxData = await wxRes.json();
    if (!wxData.openid) throw new Error('微信登录失败：' + (wxData.errmsg || '未知错误'));
    return wxData.openid;
  }
  return 'dev_' + String(devId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

/** 管理端登录（内部复用） */
async function loginAdmin(username, password, req) {
  const [rows] = await pool.query(
    'SELECT id, username, password_hash, nickname, role FROM admin_user WHERE username = ? AND status = 1',
    [username]
  );
  if (!rows.length || !verifyPassword(password, rows[0].password_hash)) return null;
  const a = rows[0];
  const token = await sessionService.createSession({ userType: 'admin', userId: a.id, req });
  await notifyAbnormalLogin({ userType: 'admin', userId: a.id, req });
  await pool.query('UPDATE admin_user SET last_login_at = NOW() WHERE id = ?', [a.id]);
  return {
    userType: 'admin',
    id: a.id, username: a.username, nickname: a.nickname, role: a.role, token,
    permissions: permsForRole(a.role),
  };
}

/** 工厂端登录（factory_user + factory 状态校验，内部复用） */
async function loginFactory(username, password, req) {
  const [rows] = await pool.query(
    `SELECT fu.id, fu.username, fu.password_hash, fu.real_name, fu.role, fu.status AS user_status,
            f.id AS factory_id, f.code, f.name, f.status AS factory_status, f.audit_status
     FROM factory_user fu JOIN factory f ON f.id = fu.factory_id
     WHERE fu.username = ?`,
    [username]
  );
  if (!rows.length || !verifyPassword(password, rows[0].password_hash)) return null;
  const u = rows[0];
  // 审核态优先于启停态：待审核的 owner status=0，先报"审核中"而非误报"账号已被停用"
  if (u.audit_status === 'pending') return { error: '账号正在等待管理员审核，请耐心等待' };
  if (u.audit_status === 'rejected') return { error: '注册申请未通过审核，请联系管理员' };
  if (!u.user_status) return { error: '账号已被停用，请联系管理员' };
  if (!u.factory_status) return { error: '工厂已被停用，请联系管理员' };
  const token = await sessionService.createSession({
    userType: 'factory', userId: u.factory_id, factoryUserId: u.id, req,
  });
  await notifyAbnormalLogin({
    userType: 'factory', userId: u.factory_id,
    factoryUser: { id: u.id, username: u.username }, req,
  });
  await pool.query('UPDATE factory_user SET last_login_at = NOW() WHERE id = ?', [u.id]);
  await pool.query('UPDATE factory SET last_login_at = NOW() WHERE id = ?', [u.factory_id]);
  return {
    userType: 'factory',
    factoryId: u.factory_id, code: u.code, name: u.name, token,
    // F-164：显式下发工厂名（name 为历史兼容字段，前端新代码请用 factoryName）
    factoryName: u.name,
    factoryUserId: u.id, username: u.username, realName: u.real_name, role: u.role,
    permissions: permsForRole(u.role),
  };
}

/**
 * POST /api/auth/login（统一登录，F-154）
 * 依次匹配 admin_user → factory_user（username 全局唯一）
 * body: { username, password }
 */
router.post('/login', loginGuard, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) throw new Error('请输入账号和密码');
    let result = await loginAdmin(username, password, req);
    if (!result) result = await loginFactory(username, password, req);
    if (!result) {
      recordLoginFail(req, username);
      throw new Error('账号或密码错误');
    }
    if (result.error) {
      recordLoginFail(req, username);
      throw new Error(result.error);
    }
    clearLoginFail(req);
    res.json(ok(result));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/auth/factory-login（旧端点别名，小程序工厂端在用，保留响应字段）
 */
router.post('/factory-login', loginGuard, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) throw new Error('请输入账号和密码');
    const result = await loginFactory(username, password, req);
    if (!result) {
      recordLoginFail(req, username);
      throw new Error('账号或密码错误');
    }
    if (result.error) {
      recordLoginFail(req, username);
      throw new Error(result.error);
    }
    clearLoginFail(req);
    res.json(ok(result));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/auth/factory-wx-login（021：微信一键进工厂端）
 * 链路：wx code → openid → ① factory_user.openid 命中：直接签发工厂会话；
 *       ② 未命中但该微信在 C 端绑定过工厂（输过邀请码）：自动关联到该厂 owner 账号（仅首次）后进厂。
 * 员工账号（未绑微信）不受影响，仍走 /factory-login 账号密码。
 * body: { code, devId } → 响应字段与 /factory-login 一致，另带 viaWx:true
 */
router.post('/factory-wx-login', loginGuard, async (req, res) => {
  try {
    const { code, devId } = req.body || {};
    const openid = await exchangeWxOpenid(code, devId);

    // ① 已关联工厂员工账号：直接进
    const [rows] = await pool.query(
      `SELECT fu.id, fu.username, fu.real_name, fu.role, fu.status AS user_status,
              f.id AS factory_id, f.code, f.name, f.status AS factory_status, f.audit_status
       FROM factory_user fu JOIN factory f ON f.id = fu.factory_id
       WHERE fu.openid = ?`,
      [openid]
    );
    let u = rows[0] || null;
    let justLinked = false;

    if (!u) {
      // ② 未关联员工账号：查 C 端邀请码绑定 → 关联到该厂 owner（owner 未关联其他微信时）
      const [binds] = await pool.query(
        "SELECT factory_id FROM c_end_user WHERE openid = ? AND role = 'factory' AND factory_id IS NOT NULL LIMIT 1",
        [openid]
      );
      if (!binds.length) {
        throw new Error('该微信尚未关联工厂账号。老板可在「我的 → 我是工厂」输邀请码绑定；员工请先用账号密码登录，再到「工厂设置 → 微信一键登录」绑定');
      }
      const [owners] = await pool.query(
        `SELECT fu.id, fu.username, fu.real_name, fu.role, fu.status AS user_status, fu.openid AS bound_openid,
                f.id AS factory_id, f.code, f.name, f.status AS factory_status, f.audit_status
         FROM factory_user fu JOIN factory f ON f.id = fu.factory_id
         WHERE fu.factory_id = ? AND fu.role = 'owner' ORDER BY fu.id LIMIT 1`,
        [binds[0].factory_id]
      );
      if (!owners.length) throw new Error('该工厂尚未开通员工账号，请联系平台管理员');
      if (owners[0].bound_openid && owners[0].bound_openid !== openid) {
        throw new Error('该工厂的老板微信已绑定其他账号，请使用账号密码登录');
      }
      u = owners[0];
      // 首次关联：owner.openid 为空才写；并发抢绑由 uk_factory_user_openid 唯一索引兜底
      try {
        const [upd] = await pool.query(
          'UPDATE factory_user SET openid = ? WHERE id = ? AND openid IS NULL',
          [openid, u.id]
        );
        justLinked = upd.affectedRows > 0;
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
      if (justLinked) {
        await opLog.logOp({
          factoryId: u.factory_id, factoryUser: { id: u.id, username: u.username },
          action: 'wx_link', detail: '微信一键登录：绑定微信到老板账号（邀请码绑定链路）', req,
        });
      }
    }

    // 状态校验与 factory-login 同口径（审核中/已驳回 优先于 停用：待审核的 owner status=0）
    if (u.audit_status === 'pending') throw new Error('账号正在等待管理员审核，请耐心等待');
    if (u.audit_status === 'rejected') throw new Error('注册申请未通过审核，请联系管理员');
    if (!u.user_status) throw new Error('账号已被停用，请联系管理员');
    if (!u.factory_status) throw new Error('工厂已被停用，请联系管理员');

    const token = await sessionService.createSession({
      userType: 'factory', userId: u.factory_id, factoryUserId: u.id, req,
    });
    await notifyAbnormalLogin({
      userType: 'factory', userId: u.factory_id,
      factoryUser: { id: u.id, username: u.username }, req,
    });
    await pool.query('UPDATE factory_user SET last_login_at = NOW() WHERE id = ?', [u.id]);
    await pool.query('UPDATE factory SET last_login_at = NOW() WHERE id = ?', [u.factory_id]);
    await opLog.logOp({
      factoryId: u.factory_id, factoryUser: { id: u.id, username: u.username },
      action: 'login', detail: '微信一键登录' + (justLinked ? '（首次自动关联）' : ''), req,
    });
    clearLoginFail(req);

    res.json(ok({
      userType: 'factory',
      factoryId: u.factory_id, code: u.code, name: u.name, token,
      // F-164：显式下发工厂名（name 为历史兼容字段，前端新代码请用 factoryName）
      factoryName: u.name,
      factoryUserId: u.id, username: u.username, realName: u.real_name, role: u.role,
      permissions: permsForRole(u.role),
      viaWx: true,
    }));
  } catch (err) {
    recordLoginFail(req, (req.body && req.body.devId) || 'wx-factory-code');
    res.status(400).json(fail(err.message));
  }
});

/**
 * 021 员工微信绑定：员工先用账号密码登录（持有工厂会话）后，自助把本人微信关联到
 * 自己的 factory_user 账号；之后接单页「微信一键登录」按 openid 命中即直进（见 /factory-wx-login ①）。
 * 一个微信全局只能绑一个工厂员工账号（uk_factory_user_openid 兜底）。
 */

// GET /api/auth/factory-wx-status 当前员工账号的微信绑定状态
router.get('/factory-wx-status', requireFactory, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT (openid IS NOT NULL AND openid != \'\') AS bound FROM factory_user WHERE id = ?',
      [req.factoryUser.id]
    );
    res.json(ok({ bound: !!(rows[0] && rows[0].bound) }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/auth/factory-wx-bind 绑定当前微信 { code, devId }
router.post('/factory-wx-bind', requireFactory, async (req, res) => {
  try {
    const { code, devId } = req.body || {};
    const openid = await exchangeWxOpenid(code, devId);
    const [[me]] = await pool.query('SELECT openid FROM factory_user WHERE id = ?', [req.factoryUser.id]);
    if (!me) throw new Error('员工账号不存在');
    if (me.openid === openid) return res.json(ok({ bound: true })); // 幂等：重复绑同一微信
    if (me.openid) throw new Error('当前账号已绑定其他微信，如需更换请先解绑');
    const [[dup]] = await pool.query(
      `SELECT fu.username, f.name AS factory_name FROM factory_user fu
       JOIN factory f ON f.id = fu.factory_id WHERE fu.openid = ?`,
      [openid]
    );
    if (dup) throw new Error(`该微信已绑定工厂账号「${dup.username}」（${dup.factory_name}），请先解绑后再绑定`);
    try {
      await pool.query('UPDATE factory_user SET openid = ? WHERE id = ? AND openid IS NULL', [openid, req.factoryUser.id]);
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw new Error('该微信已绑定其他工厂账号，请先解绑后再绑定');
      throw e;
    }
    await opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser,
      action: 'wx_link', detail: '员工自助绑定微信（工厂设置 → 微信一键登录）', req,
    });
    res.json(ok({ bound: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// POST /api/auth/factory-wx-unbind 解绑当前微信
router.post('/factory-wx-unbind', requireFactory, async (req, res) => {
  try {
    await pool.query('UPDATE factory_user SET openid = NULL WHERE id = ?', [req.factoryUser.id]);
    await opLog.logOp({
      factoryId: req.factory.id, factoryUser: req.factoryUser,
      action: 'wx_unlink', detail: '解绑微信一键登录', req,
    });
    res.json(ok({ bound: false }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/auth/admin-login（旧端点别名，管理后台在用，保留响应字段）
 */
router.post('/admin-login', loginGuard, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) throw new Error('请输入用户名和密码');
    const result = await loginAdmin(username, password, req);
    if (!result) {
      recordLoginFail(req, username);
      throw new Error('用户名或密码错误');
    }
    clearLoginFail(req);
    res.json(ok(result));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/auth/user-login（C端，微信 code 换 openid，未配置密钥时开发降级）
 * 每次登录创建新会话（多设备支持）；旧单会话字段不再维护，由 user_session 取代
 * body: { code, devId, nickname }
 */
router.post('/user-login', loginGuard, async (req, res) => {
  try {
    const { code, devId, nickname } = req.body;
    let openid = null;
    let devMode = false;

    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (appid && secret && code) {
      const url = 'https://api.weixin.qq.com/sns/jscode2session'
        + '?appid=' + encodeURIComponent(appid)
        + '&secret=' + encodeURIComponent(secret)
        + '&js_code=' + encodeURIComponent(code)
        + '&grant_type=authorization_code';
      const wxRes = await fetch(url);
      const wxData = await wxRes.json();
      if (!wxData.openid) throw new Error('微信登录失败：' + (wxData.errmsg || '未知错误'));
      openid = wxData.openid;
    } else {
      // 开发降级：未配置微信密钥时使用固定开发身份
      devMode = true;
      openid = 'dev_' + String(devId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.openid, u.nickname, u.avatar_url, u.phone, u.role, u.factory_id,
              f.name AS factory_name
       FROM c_end_user u LEFT JOIN factory f ON f.id = u.factory_id
       WHERE u.openid = ?`,
      [openid]
    );
    let user;
    if (rows.length) {
      user = rows[0];
      if (nickname && !user.nickname) {
        await pool.query('UPDATE c_end_user SET nickname = ? WHERE id = ?', [nickname, user.id]);
        user.nickname = nickname;
      }
    } else {
      const [ret] = await pool.query(
        'INSERT INTO c_end_user (openid, nickname, source) VALUES (?,?,?)',
        [openid, nickname || null, devMode ? 'dev' : 'miniapp']
      );
      user = { id: ret.insertId, openid, nickname: nickname || null, avatar_url: null, phone: null, role: 'customer', factory_id: null, factory_name: null };
    }
    // 新会话（多设备互踢上限 5 由 createSession 保证）
    const token = await sessionService.createSession({ userType: 'customer', userId: user.id, req });
    await notifyAbnormalLogin({ userType: 'customer', userId: user.id, req });
    clearLoginFail(req);

    res.json(ok({
      userId: user.id,
      openid: user.openid,
      nickname: user.nickname,
      avatarUrl: user.avatar_url || null,
      phone: user.phone || null,
      token,
      devMode,
      // stage14 身份分流：角色与绑定工厂（mine 页「我是工厂」/tabBar 过滤依据）
      role: user.role || 'customer',
      factoryId: user.factory_id || null,
      // 绑定厂名随登录下发：前端据此刷新本地缓存，避免 mine 页未登录态显示陈旧厂名
      factoryName: user.factory_name || null,
      permissions: permsForRole('customer'),
    }));
  } catch (err) {
    recordLoginFail(req, (req.body && req.body.devId) || 'wx-code');
    res.status(400).json(fail(err.message));
  }
});

/**
 * GET /api/auth/permissions（F-165）
 * 按请求头识别当前登录身份，返回权限列表；未登录 401
 */
router.get('/permissions', async (req, res, next) => {
  try {
    const detect = [
      { type: 'admin', token: req.headers['x-admin-token'] },
      { type: 'factory', token: req.headers['x-factory-token'] },
      { type: 'customer', token: req.headers['x-user-token'] },
    ].find((d) => d.token);
    if (!detect) return res.status(401).json(fail('未登录', 401));
    const session = await sessionService.getSession(detect.token, detect.type);
    if (!session || sessionService.isExpired(session.expires_at)) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    let role = 'customer';
    if (detect.type === 'admin') {
      const [rows] = await pool.query('SELECT role FROM admin_user WHERE id = ? AND status = 1', [session.user_id]);
      if (!rows.length) return res.status(401).json(fail('登录已过期，请重新登录', 401));
      role = rows[0].role;
    } else if (detect.type === 'factory') {
      const [rows] = await pool.query('SELECT role, status FROM factory_user WHERE id = ?', [session.factory_user_id || 0]);
      if (!rows.length || !rows[0].status) return res.status(401).json(fail('账号已被停用', 401));
      role = rows[0].role;
    }
    res.json(ok({ userType: detect.type, role, permissions: permsForRole(role) }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout-all（F-147：登出所有设备）
 * 按请求头识别身份，删除该用户全部会话
 */
router.post('/logout-all', async (req, res) => {
  try {
    const map = [
      { type: 'admin', token: req.headers['x-admin-token'] },
      { type: 'factory', token: req.headers['x-factory-token'] },
      { type: 'customer', token: req.headers['x-user-token'] },
    ].find((d) => d.token);
    if (map) {
      const session = await sessionService.getSession(map.token, map.type);
      if (session) await sessionService.destroyAllForUser(map.type, session.user_id);
    }
    res.json(ok({ loggedOut: true }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /api/auth/user-logout（只删当前会话，F-145）
 */
router.post('/user-logout', async (req, res) => {
  try {
    await sessionService.destroyByToken(req.headers['x-user-token'], 'customer');
    res.json(ok({ loggedOut: true }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * POST /api/auth/factory-logout（只删当前会话）
 */
router.post('/factory-logout', async (req, res) => {
  try {
    await sessionService.destroyByToken(req.headers['x-factory-token'], 'factory');
    res.json(ok({ loggedOut: true }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * GET /api/auth/admin-me（当前登录管理员信息）
 */
router.get('/admin-me', requireAdmin, (req, res) => {
  res.json(ok(req.admin));
});

/**
 * POST /api/auth/admin-logout（只删当前会话）
 */
router.post('/admin-logout', async (req, res) => {
  try {
    await sessionService.destroyByToken(req.headers['x-admin-token'], 'admin');
    res.json(ok({ loggedOut: true }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

/**
 * GET /api/auth/sessions（F-148：在线设备列表，仅未过期会话，管理员）
 * 查询参数：userType=customer|factory|admin、userId、keyword（账号/昵称模糊）
 */
router.get('/sessions', requireAdmin, requirePermission('session:view'), async (req, res) => {
  try {
    const { userType, userId, keyword } = req.query;
    const where = ['s.expires_at > NOW()'];
    const params = [];
    if (userType) { where.push('s.user_type = ?'); params.push(userType); }
    if (userId) { where.push('s.user_id = ?'); params.push(parseInt(userId, 10)); }
    if (keyword) {
      where.push('(au.username LIKE ? OR fu.username LIKE ? OR cu.nickname LIKE ?)');
      const like = '%' + String(keyword).trim() + '%';
      params.push(like, like, like);
    }
    const [rows] = await pool.query(
      `SELECT s.id, s.user_type, s.user_id, s.factory_user_id, s.device_info, s.ip,
              s.last_active_at, s.created_at,
              au.username AS admin_username,
              fu.username AS factory_username, fu.real_name AS factory_real_name,
              cu.nickname AS customer_name
       FROM user_session s
       LEFT JOIN admin_user au ON s.user_type = 'admin' AND au.id = s.user_id
       LEFT JOIN factory_user fu ON s.user_type = 'factory' AND fu.id = s.factory_user_id
       LEFT JOIN c_end_user cu ON s.user_type = 'customer' AND cu.id = s.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.last_active_at DESC LIMIT 200`,
      params
    );
    res.json(ok({ total: rows.length, list: rows }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * DELETE /api/auth/sessions/:id（F-150：强制下线指定会话）
 * 保护：不能下线自己当前正在用的会话
 */
router.delete('/sessions/:id', requireAdmin, requirePermission('session:revoke'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT id, token FROM user_session WHERE id = ?', [id]);
    if (!rows.length) throw new Error('会话不存在或已过期');
    if (rows[0].token === req.headers['x-admin-token']) {
      throw new Error('不能下线当前登录的会话（请使用右上角登出）');
    }
    await pool.query('DELETE FROM user_session WHERE id = ?', [id]);
    res.json(ok({ revoked: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

/**
 * POST /api/auth/admin-password（修改自己的密码，改密不踢会话，P2 可加踢）
 */
router.post('/admin-password', requireAdmin, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) throw new Error('请输入原密码和新密码');
    if (String(newPassword).length < 6) throw new Error('新密码至少 6 位');
    const [rows] = await pool.query('SELECT password_hash FROM admin_user WHERE id = ?', [req.admin.id]);
    if (!rows.length || !verifyPassword(oldPassword, rows[0].password_hash)) throw new Error('原密码错误');
    await pool.query('UPDATE admin_user SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), req.admin.id]);
    res.json(ok({ updated: true }));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
