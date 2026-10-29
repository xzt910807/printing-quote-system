/**
 * 异常反馈工单路由
 * 三端接入（C 端 / 工厂端 / 管理端），本文件导出三个 Router：
 *   userRouter    → /api/c/issue     （requireUser）
 *   factoryRouter → /api/factory/issue（requireFactory）
 *   adminRouter   → /api/admin/issue  （requireAdmin）
 */
const express = require('express');
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const issueService = require('../services/issueService');
const { requireFactory, requireAdmin } = require('../middlewares/auth');

// ========== 用户端 ==========
const userRouter = express.Router();

// POST / — 用户创建工单
userRouter.post('/', async (req, res) => {
  try {
    const { orderId, type, title, description, images } = req.body || {};
    const ret = await issueService.createTicket({
      orderId, userId: req.user.id,
      type, title, description, images,
    });
    res.json(ok(ret));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message));
  }
});

// GET / — 用户工单列表（分页+搜索+状态筛：page/pageSize/keyword/status, 返回 total/hasMore）
userRouter.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 20, 1), 50);
    const keyword = String(req.query.keyword || '').trim().slice(0, 50);
    const status = String(req.query.status || '').trim();
    const orderId = parseInt(req.query.orderId, 10) || null;
    const where = ['t.user_id = ?'];
    const params = [req.user.id];
    if (orderId) { where.push('t.order_id = ?'); params.push(orderId); }
    if (['open', 'processing', 'resolved', 'closed'].includes(status)) {
      where.push('t.status = ?'); params.push(status);
    }
    if (keyword) {
      const like = '%' + keyword + '%';
      where.push('(t.ticket_no LIKE ? OR t.title LIKE ? OR o.order_no LIKE ? OR f.name LIKE ?)');
      params.push(like, like, like, like);
    }
    const whereSql = 'WHERE ' + where.join(' AND ');
    const [rows] = await pool.query(
      `SELECT t.id, t.ticket_no, t.order_id, o.order_no, t.factory_id, f.name AS factory_name,
              t.type, t.title, t.status, t.created_at, t.updated_at
       FROM issue_ticket t
       LEFT JOIN order_main o ON o.id = t.order_id
       LEFT JOIN factory f ON f.id = t.factory_id
       ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS total FROM issue_ticket t
       LEFT JOIN order_main o ON o.id = t.order_id
       LEFT JOIN factory f ON f.id = t.factory_id ${whereSql}`,
      params
    );
    const total = Number(cnt.total);
    res.json(ok({ total, page, pageSize, hasMore: page * pageSize < total, list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// GET /:id — 工单详情
userRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[ticket]] = await pool.query(
      `SELECT t.*, o.order_no, f.name AS factory_name
       FROM issue_ticket t
       LEFT JOIN order_main o ON o.id = t.order_id
       LEFT JOIN factory f ON f.id = t.factory_id
       WHERE t.id = ? AND t.user_id = ?`, [id, req.user.id]);
    if (!ticket) return res.status(404).json(fail('工单不存在'));
    res.json(ok(ticket));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// PUT /:id/close — 用户关闭（仅 resolved 可关）
userRouter.put('/:id/close', async (req, res) => {
  try {
    await issueService.closeByUser(parseInt(req.params.id, 10), req.user.id);
    res.json(ok({ closed: true }));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// ========== 工厂端 ==========
const factoryRouter = express.Router();
factoryRouter.use(requireFactory);

// GET / — 本厂工单列表（默认 open+processing，JOIN 带出订单号）
factoryRouter.get('/', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    let sql = `SELECT t.id, t.ticket_no, t.order_id, o.order_no, t.user_id, t.type, t.title, t.description, t.images,
                      t.status, t.factory_reply, t.created_at, t.updated_at
               FROM issue_ticket t
               LEFT JOIN order_main o ON o.id = t.order_id
               WHERE t.factory_id = ?`;
    const params = [req.factory.id];
    if (status && ['open', 'processing', 'resolved', 'closed'].includes(status)) {
      sql += ' AND t.status = ?'; params.push(status);
    } else {
      sql += " AND t.status IN ('open','processing')";
    }
    sql += ' ORDER BY t.created_at DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// GET /:id — 本厂工单详情
factoryRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[ticket]] = await pool.query(
      `SELECT t.*, o.order_no FROM issue_ticket t
       LEFT JOIN order_main o ON o.id = t.order_id
       WHERE t.id = ? AND t.factory_id = ?`, [id, req.factory.id]);
    if (!ticket) return res.status(404).json(fail('工单不存在'));
    res.json(ok(ticket));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// PUT /:id/reply — 工厂回复
factoryRouter.put('/:id/reply', async (req, res) => {
  try {
    await issueService.factoryReply(parseInt(req.params.id, 10), req.factory.id, (req.body || {}).reply);
    res.json(ok({ replied: true }));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// GET /:id/files — 本厂工单证据附件列表
factoryRouter.get('/:id/files', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[tk]] = await pool.query('SELECT id FROM issue_ticket WHERE id = ? AND factory_id = ?', [id, req.factory.id]);
    if (!tk) return res.status(404).json(fail('工单不存在'));
    const [rows] = await pool.query(
      `SELECT id, sender_type, sender_id, file_name, file_url, file_size, mime_type, created_at
       FROM file_transfer WHERE ref_type = 'issue' AND ref_id = ? ORDER BY created_at ASC`, [id]);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// ========== 管理端 ==========
const adminRouter = express.Router();
adminRouter.use(requireAdmin);

// GET / — 全部工单（可按状态/类型/工厂筛, keyword 走服务端）
adminRouter.get('/', async (req, res) => {
  try {
    const { status, type, factoryId, keyword } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(parseInt(req.query.size, 10) || 30, 100);
    const conditions = [];
    const params = [];
    if (status && ['open', 'processing', 'resolved', 'closed'].includes(status)) { conditions.push('t.status = ?'); params.push(status); }
    if (type && ['quality', 'delay', 'reprint', 'other'].includes(type)) { conditions.push('t.type = ?'); params.push(type); }
    if (factoryId) { conditions.push('t.factory_id = ?'); params.push(parseInt(factoryId, 10)); }
    // 后台工单面板的搜索框就是这个口径：工单号 / 标题 / 订单号 / 工厂名
    if (keyword && String(keyword).trim()) {
      const like = '%' + String(keyword).trim() + '%';
      conditions.push('(t.ticket_no LIKE ? OR t.title LIKE ? OR o.order_no LIKE ? OR f.name LIKE ?)');
      params.push(like, like, like, like);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    // count 与列表必须共用同一套 JOIN, 否则 keyword 命中 o./f. 列时总数会算错
    const joins = ' LEFT JOIN order_main o ON o.id = t.order_id LEFT JOIN factory f ON f.id = t.factory_id';
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM issue_ticket t${joins} ${where}`, params);
    const [rows] = await pool.query(
      // description/images/factory_reply 一并选出：后台「工单详情」弹窗直接复用列表行，
      // 否则管理端只能看到标题，读不到客户描述与工厂回复，无法判断该不该介入
      `SELECT t.id, t.ticket_no, t.order_id, o.order_no, t.user_id, t.factory_id, f.name AS factory_name,
              t.type, t.title, t.description, t.images, t.factory_reply, t.factory_reply_at,
              t.status, t.admin_note, t.resolved_at, t.created_at, t.updated_at
       FROM issue_ticket t
       LEFT JOIN order_main o ON o.id = t.order_id
       LEFT JOIN factory f ON f.id = t.factory_id
       ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
      [...params, size, (page - 1) * size]);
    res.json(ok({ list: rows, total, page, size }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// PUT /:id — 管理端标注 / 推进状态
adminRouter.put('/:id', async (req, res) => {
  try {
    await issueService.adminUpdate(parseInt(req.params.id, 10), req.body || {});
    res.json(ok({ updated: true }));
  } catch (err) { res.status(err.status || 400).json(fail(err.message)); }
});

// GET /:id/files — 管理端查看证据附件
adminRouter.get('/:id/files', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      `SELECT id, sender_type, sender_id, file_name, file_url, file_size, mime_type, created_at
       FROM file_transfer WHERE ref_type = 'issue' AND ref_id = ? ORDER BY created_at ASC`, [id]);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = userRouter;
module.exports.userRouter = userRouter;
module.exports.factoryRouter = factoryRouter;
module.exports.adminRouter = adminRouter;
