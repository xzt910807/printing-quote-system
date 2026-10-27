const express = require('express');
const router = express.Router();
const { ok, fail } = require('../utils/helpers');
const { requireUser, requireFactory } = require('../middlewares/auth');
const chat = require('../services/inquiryChatService');

/**
 * 询价会话消息（融合印查查「IM 在线沟通」）
 * 同一用户既是客户也可能是工厂身份，按请求头分流鉴权：
 *   X-User-Id + X-User-Token          → 客户视角（req.user）
 *   X-Factory-Id + X-Factory-Token    → 工厂视角（req.factory / req.factoryUser）
 * 会话键：inquiry_id + factory_id；小程序轮询刷新（30s），无长连接依赖
 */

// 身份解析：工厂头优先（工厂模式小程序不带用户头）
function byIdentity(req, res, next) {
  if (req.headers['x-factory-id'] && req.headers['x-factory-token']) return requireFactory(req, res, next);
  if (req.headers['x-user-id'] && req.headers['x-user-token']) return requireUser(req, res, next);
  return res.status(401).json(fail('请先登录后使用消息功能', 401));
}

// 当前会话对家工厂ID（客户发起会话时必须显式携带；工厂侧由令牌推导防冒充）
function resolveFactoryId(req) {
  return req.factory
    ? req.factory.id
    : parseInt((req.query.factoryId != null ? req.query.factoryId : (req.body || {}).factoryId), 10) || 0;
}

// GET /api/messages/threads 我的会话列表（双方通用）
router.get('/threads', byIdentity, async (req, res) => {
  try {
    const list = req.factory
      ? await chat.listFactoryThreads(req.factory.id)
      : await chat.listUserThreads(req.user.id);
    const unread = req.factory
      ? await chat.factoryUnread(req.factory.id)
      : await chat.userUnread(req.user.id);
    res.json(ok({ total: list.length, unread, list }));
  } catch (err) {
    res.status(err.status || 500).json(fail(err.message, err.status || 500));
  }
});

// GET /api/messages/thread/:inquiryId 读取会话消息并标记已读（对方消息）
router.get('/thread/:inquiryId', byIdentity, async (req, res) => {
  try {
    const factoryId = resolveFactoryId(req);
    if (!factoryId) throw Object.assign(new Error('缺少 factoryId'), { status: 400 });
    const data = await chat.listThread({
      inquiryId: parseInt(req.params.inquiryId, 10),
      factoryId,
      viewerType: req.factory ? 'factory' : 'user',
      viewerId: req.factory ? req.factoryUser.id : req.user.id,
    });
    res.json(ok(data));
  } catch (err) {
    res.status(err.status || 500).json(fail(err.message, err.status || 500));
  }
});

// POST /api/messages/send 发送消息 { inquiryId, factoryId?, content }
router.post('/send', byIdentity, async (req, res) => {
  try {
    const body = req.body || {};
    const factoryId = req.factory ? req.factory.id : parseInt(body.factoryId, 10) || 0;
    if (!factoryId) throw Object.assign(new Error('缺少 factoryId'), { status: 400 });
    const msg = await chat.sendMessage({
      inquiryId: parseInt(body.inquiryId, 10) || 0,
      factoryId,
      senderType: req.factory ? 'factory' : 'user',
      senderId: req.factory ? req.factoryUser.id : req.user.id,
      content: body.content,
    });
    res.json(ok(msg));
  } catch (err) {
    res.status(err.status || 400).json(fail(err.message, err.status || 400));
  }
});

// GET /api/messages/unread 未读总数（tab 角标轮询用，轻量）
router.get('/unread', byIdentity, async (req, res) => {
  try {
    const unread = req.factory
      ? await chat.factoryUnread(req.factory.id)
      : await chat.userUnread(req.user.id);
    res.json(ok({ unread }));
  } catch (err) {
    res.status(err.status || 500).json(fail(err.message, err.status || 500));
  }
});

module.exports = router;
