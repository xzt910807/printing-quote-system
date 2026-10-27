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

// GET /?orderId= — 用户工单列表
userRouter.get('/', async (req, res) => {
  try {
    const orderId = parseInt(req.query.orderId, 10) || null;
    let sql = 'SELECT id, ticket_no, order_id, factory_id, type, title, status, created_at, updated_at FROM issue_ticket WHERE user_id = ?';
    const params = [req.user.id];
    if (orderId) { sql += ' AND order_id = ?'; params.push(orderId); }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const [rows] = await pool.query(sql, params);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// GET /:id — 工单详情
userRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[ticket]] = await pool.query('SELECT * FROM issue_ticket WHERE id = ? AND user_id = ?', [id, req.user.id]);
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

// GET / — 本厂工单列表（默认 open+processing）
factoryRouter.get('/', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    let sql = 'SELECT id, ticket_no, order_id, user_id, type, title, description, images, status, factory_reply, created_at, updated_at FROM issue_ticket WHERE factory_id = ?';
    const params = [req.factory.id];
    if (status && ['open', 'processing', 'resolved', 'closed'].includes(status)) {
      sql += ' AND status = ?'; params.push(status);
    } else {
      sql += " AND status IN ('open','processing')";
    }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    res.json(ok({ list: rows }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

// GET /:id — 本厂工单详情
factoryRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[ticket]] = await pool.query('SELECT * FROM issue_ticket WHERE id = ? AND factory_id = ?', [id, req.factory.id]);
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

// GET / — 全部工单（可按状态/类型/工厂筛）
adminRouter.get('/', async (req, res) => {
  try {
    const { status, type, factoryId } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(parseInt(req.query.size, 10) || 30, 100);
    const conditions = [];
    const params = [];
    if (status && ['open', 'processing', 'resolved', 'closed'].includes(status)) { conditions.push('status = ?'); params.push(status); }
    if (type && ['quality', 'delay', 'reprint', 'other'].includes(type)) { conditions.push('type = ?'); params.push(type); }
    if (factoryId) { conditions.push('factory_id = ?'); params.push(parseInt(factoryId, 10)); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM issue_ticket ${where}`, params);
    const [rows] = await pool.query(
      `SELECT id, ticket_no, order_id, user_id, factory_id, type, title, status, admin_note, resolved_at, created_at, updated_at
       FROM issue_ticket ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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
