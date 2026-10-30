/**
 * 管理端站内消息（c_message）只读视图：/api/admin/messages
 * 小程序「我的消息」早已上线, 但后台此前一条都看不到——运营只能听用户说「我没收到通知」,
 * 无法核实是系统没发、发给了 user_id=0 的工厂侧留痕、还是用户自己没读。
 * 只做读：写已读属于用户行为, 平台代点会污染用户的未读状态。
 */
const express = require('express');
const { pool } = require('../config/db');
const { ok, fail } = require('../utils/helpers');
const { requireAdmin } = require('../middlewares/auth');
const { requirePermission } = require('../config/permissions');

const router = express.Router();
router.use(requireAdmin);
router.use(requirePermission('message:view'));

/**
 * GET /api/admin/messages?page=&size=&type=&keyword=&unreadOnly=&target=
 * target=user 只看发给真实客户的, target=system 只看 user_id=0 的平台/工厂侧留痕
 * （新工单、工单超时未处理这类就是写给工厂侧的, 库里占比很高, 混在列表里会让人误以为
 * 「几百条消息没人读」, 所以必须能分开看, 并在行内如实标出接收方）
 * 类型码不做白名单拦截：各业务各自写死（quote_rematch/issue_stale/chat_message…）,
 * 历史种子里还出现过 note_accepted 这种拼错的码, 后端原样下发、前端兜底显示原文
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const size = Math.min(Math.max(parseInt(req.query.size, 10) || 20, 1), 100);
    const offset = (page - 1) * size;
    const type = String(req.query.type || '').trim();
    const keyword = String(req.query.keyword || '').trim().slice(0, 50);
    const target = String(req.query.target || '').trim();

    const where = [];
    const params = [];
    if (type) { where.push('m.type = ?'); params.push(type); }
    if (req.query.unreadOnly === '1') where.push('m.is_read = 0');
    if (target === 'user') where.push('m.user_id > 0');
    else if (target === 'system') where.push('m.user_id = 0');
    if (keyword) {
      const like = `%${keyword}%`;
      // 标题/正文/收件人昵称/收件人手机号：运营拿到一句用户原话就能反查有没有发过通知
      where.push('(m.title LIKE ? OR m.content LIKE ? OR eu.nickname LIKE ? OR eu.phone LIKE ?)');
      params.push(like, like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const joins = ' LEFT JOIN c_end_user eu ON eu.id = m.user_id';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM c_message m${joins} ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT m.id, m.user_id, m.type, m.title, m.content, m.ref_type, m.ref_id,
              m.is_read, m.created_at, eu.nickname AS user_nickname, eu.phone AS user_phone
       FROM c_message m${joins} ${whereSql}
       ORDER BY m.id DESC LIMIT ? OFFSET ?`,
      [...params, size, offset]);
    rows.forEach((r) => { r.is_read = !!r.is_read; });

    // 类型分布：忽略 type 条件、其余条件照常生效, 供筛选下拉直接展示各类型条数
    const statWhere = where.filter((w) => !w.startsWith('m.type = ?'));
    const statParams = params.slice(type ? 1 : 0);
    const [[unreadAll]] = await pool.query('SELECT COUNT(*) c FROM c_message WHERE is_read = 0');
    const [typeCounts] = await pool.query(
      `SELECT m.type, COUNT(*) c FROM c_message m${joins} ${statWhere.length ? 'WHERE ' + statWhere.join(' AND ') : ''} GROUP BY m.type ORDER BY c DESC`,
      statParams
    );

    res.json(ok({
      list: rows,
      total,
      page,
      size,
      unreadTotal: Number(unreadAll.c) || 0,
      typeCounts: typeCounts.map((t) => ({ type: t.type, count: Number(t.c) || 0 })),
    }));
  } catch (err) {
    res.status(500).json(fail(err.message));
  }
});

module.exports = router;
