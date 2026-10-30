const { fail } = require('../utils/helpers');
const { pool } = require('../config/db');
const { permsForRole } = require('../config/permissions');
const { getSession, slideSession, isExpired } = require('../services/sessionService');

/**
 * 统一会话鉴权（013-unified-session 之后：令牌一律查 user_session 表）
 * 请求头沿用旧命名，前端零改动：
 *   管理端 X-Admin-Token｜工厂端 X-Factory-Id + X-Factory-Token｜C 端 X-User-Id + X-User-Token
 * 多设备支持：同一账号最多 5 个会话（登录时自动踢最旧），员工禁用即其全部会话失效
 */

/**
 * 工厂端鉴权中间件
 * 验证：user_session(factory) → factory_user(status=1) + factory(status=1)
 * 通过后：req.factory = { id, name }；req.factoryUser = { id, username, role, realName, factoryId, perms }
 */
async function requireFactory(req, res, next) {
  try {
    const fid = parseInt(req.headers['x-factory-id'], 10);
    const token = req.headers['x-factory-token'];
    if (!fid || !token) {
      return res.status(401).json(fail('工厂未登录，请先验证工厂身份', 401));
    }
    const session = await getSession(token, 'factory');
    if (!session || session.user_id !== fid) {
      return res.status(401).json(fail('工厂身份验证失败，请重新登录', 401));
    }
    if (isExpired(session.expires_at)) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    const [rows] = await pool.query(
      `SELECT fu.id, fu.username, fu.role, fu.real_name, fu.status AS user_status,
              f.id AS factory_id, f.name, f.status AS factory_status
       FROM factory_user fu JOIN factory f ON f.id = fu.factory_id
       WHERE fu.id = ? AND f.id = ?`,
      [session.factory_user_id || 0, session.user_id]
    );
    if (!rows.length || !rows[0].user_status || !rows[0].factory_status) {
      return res.status(401).json(fail('工厂账号已被停用，请联系管理员', 401));
    }
    // 路由带 :factoryId 时，必须与令牌对应工厂一致（防止冒充其他工厂）
    if (req.params.factoryId && parseInt(req.params.factoryId, 10) !== rows[0].factory_id) {
      return res.status(403).json(fail('无权访问其他工厂的数据', 403));
    }
    slideSession(session.id, session.expires_at);
    req.factory = { id: rows[0].factory_id, name: rows[0].name };
    req.factoryUser = {
      id: rows[0].id,
      username: rows[0].username,
      role: rows[0].role,
      realName: rows[0].real_name,
      factoryId: rows[0].factory_id,
      perms: permsForRole(rows[0].role),
    };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * 管理后台鉴权中间件
 * 验证：user_session(admin) → admin_user(status=1)
 * 通过后：req.admin = { id, username, nickname, role, perms }
 */
async function requireAdmin(req, res, next) {
  try {
    const token = req.headers['x-admin-token'];
    if (!token) {
      return res.status(401).json(fail('管理员未登录', 401));
    }
    const session = await getSession(token, 'admin');
    if (!session) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    if (isExpired(session.expires_at)) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    const [rows] = await pool.query(
      'SELECT id, username, nickname, role FROM admin_user WHERE id = ? AND status = 1',
      [session.user_id]
    );
    if (!rows.length) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    slideSession(session.id, session.expires_at);
    req.admin = { ...rows[0], perms: permsForRole(rows[0].role) };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * 超级管理员校验（必须挂在 requireAdmin 之后）
 * 账户管理等高权限操作仅 role=super 可执行
 */
function requireSuper(req, res, next) {
  if (!req.admin || req.admin.role !== 'super') {
    return res.status(403).json(fail('仅超级管理员可执行该操作', 403));
  }
  next();
}

/**
 * C端用户：强制鉴权
 * 验证：user_session(customer) → c_end_user
 * 通过后：req.user = { id, openid, nickname, phone }
 */
async function requireUser(req, res, next) {
  try {
    const uid = parseInt(req.headers['x-user-id'], 10);
    const token = req.headers['x-user-token'];
    if (!uid || !token) {
      return res.status(401).json(fail('请先登录', 401));
    }
    const session = await getSession(token, 'customer');
    if (!session || session.user_id !== uid) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    if (isExpired(session.expires_at)) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    const [rows] = await pool.query(
      'SELECT id, openid, nickname, phone FROM c_end_user WHERE id = ?',
      [session.user_id]
    );
    if (!rows.length) {
      return res.status(401).json(fail('登录已过期，请重新登录', 401));
    }
    slideSession(session.id, session.expires_at);
    req.user = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * C端用户：可选鉴权（有凭证则校验挂 req.user；无凭证或凭证无效均放行）
 * 用于匿名也可使用的接口（如创建询价），登录后自动关联 user_id
 */
async function optionalUser(req, res, next) {
  try {
    req.user = null;
    const uid = parseInt(req.headers['x-user-id'], 10);
    const token = req.headers['x-user-token'];
    if (!uid || !token) return next();
    const session = await getSession(token, 'customer');
    if (session && session.user_id === uid && !isExpired(session.expires_at)) {
      const [rows] = await pool.query(
        'SELECT id, openid, nickname, phone FROM c_end_user WHERE id = ?',
        [session.user_id]
      );
      if (rows.length) {
        req.user = rows[0];
        slideSession(session.id, session.expires_at);
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * 管理端或工厂端二合一鉴权（026：工厂端开放报价计算器/客户管理/本厂报价单）
 * 工厂头优先：工厂模式前端不再携带 X-Admin-Token，此处按头识别身份，
 * 通过后 req.admin 或 req.factoryUser 二选一存在，路由内用 actorFactoryId() 做数据隔离
 */
async function requireAdminOrFactory(req, res, next) {
  if (req.headers['x-factory-id'] && req.headers['x-factory-token']) {
    return requireFactory(req, res, next);
  }
  if (req.headers['x-admin-token']) return requireAdmin(req, res, next);
  return res.status(401).json(fail('未登录', 401));
}

/**
 * Batch D4 社区身份判定：一次请求同时试工厂头与客户头，结果写 req.identity
 *
 * 为什么需要它：社区要按身份分级审核（工厂发→直接公开、客户发→先发后审），
 * 所以 author_type 必须由服务端从令牌推导。绝不能采信请求体里的身份字段，
 * 否则任何客户都能靠 body 伪装成工厂绕过审核。
 *
 * 工厂身份优先：小程序同一会话里工厂头是客户头的超集（登录过工厂的页面会同时带两套头）。
 * 现有 6 个中间件一行不改，这里只是把它们当探针复用：
 * 用一个占位 res 接住鉴权失败时的 401 写出，成功则从 next() 拿到放行信号。
 *
 * @returns {Promise<{ok:boolean, status?:number, body?:any, error?:Error}>}
 */
function probe(mw, req) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    const stubRes = {
      status(code) { this._code = code; return this; },
      json(body) { finish({ ok: false, status: this._code || 500, body }); return this; },
      send(body) { finish({ ok: false, status: this._code || 500, body }); return this; },
      end() { finish({ ok: false, status: this._code || 500, body: null }); return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      headersSent: false,
    };
    // 原中间件异常时会走 next(err)，这里当成服务错误向上抛，不能当成“未登录”误处理
    const next = (err) => finish(err ? { ok: false, error: err } : { ok: true });
    try {
      mw(req, stubRes, next);
    } catch (e) {
      finish({ ok: false, error: e });
    }
  });
}

/**
 * 解析身份（不拦请求）：无凭证时 req.identity = null，读接口照走匿名
 * 失败原因（带了头但校验不通过）记在 req.identityError，由 requireIdentity 统一回 401
 */
async function resolveIdentity(req, res, next) {
  req.identity = null;
  req.identityError = null;
  try {
    // 1) 工厂身份（优先）：requireFactory 成功后会挂好 req.factory / req.factoryUser
    if (req.headers['x-factory-id'] && req.headers['x-factory-token']) {
      const p = await probe(requireFactory, req);
      if (p.ok) {
        req.identity = {
          type: 'factory',
          userId: req.factoryUser.id,
          factoryId: req.factory.id,
          factoryName: req.factory.name,
          role: req.factoryUser.role,
          name: req.factoryUser.realName || req.factoryUser.username,
        };
        return next();
      }
      if (p.error) return next(p.error);
      req.identityError = { status: p.status, body: p.body };
    }
    // 2) 客户身份：requireUser 成功后挂 req.user
    if (req.headers['x-user-id'] && req.headers['x-user-token']) {
      const p = await probe(requireUser, req);
      if (p.ok) {
        req.identity = {
          type: 'user',
          userId: req.user.id,
          factoryId: null,
          name: req.user.nickname || req.user.phone || ('用户' + req.user.id),
        };
        return next();
      }
      if (p.error) return next(p.error);
      if (!req.identityError) req.identityError = { status: p.status, body: p.body };
    }
    return next();
  } catch (e) {
    next(e);
  }
}

/**
 * 写接口身份：resolveIdentity 后无身份直接 401
 * 带了无效凭证时把原中间件的 401 文案原样回出去（“登录已过期，请重新登录”比“未登录”有用）
 */
async function requireIdentity(req, res, next) {
  await resolveIdentity(req, res, () => {
    if (req.identity) return next();
    if (req.identityError && req.identityError.body) {
      return res.status(req.identityError.status || 401).json(req.identityError.body);
    }
    return res.status(401).json(fail('请先登录后再发布内容', 401));
  });
}

module.exports = { requireFactory, requireAdmin, requireAdminOrFactory, requireSuper, requireUser, optionalUser, resolveIdentity, requireIdentity };
