const express = require('express');
const router = express.Router();
const { ok, fail } = require('../utils/helpers');
const shippingService = require('../services/shippingService');
const { requirePermission } = require('../config/permissions');

/**
 * 管理端：运费模板维护（stage13）
 * 挂载在 /api/admin 下（requireAdmin 由 app.js 统一挂）
 */

// 模板列表（含停用）
router.get('/shipping-templates', requirePermission('shipping:manage'), async (req, res) => {
  try {
    const list = await shippingService.listTemplates({ includeInactive: true });
    res.json(ok({ total: list.length, list }));
  } catch (err) {
    res.status(500).json(fail(err.message, 500));
  }
});

// 新增/保存模板 body 对应 saveTemplate 字段（camelCase）；isDefault 时清其他默认
router.post('/shipping-templates', requirePermission('shipping:manage'), async (req, res) => {
  try {
    const data = await shippingService.saveTemplate(req.body || {});
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

// 启用/停用模板
router.post('/shipping-templates/:id/toggle', requirePermission('shipping:manage'), async (req, res) => {
  try {
    const data = await shippingService.toggleTemplate(req.params.id, !!(req.body && req.body.isActive));
    res.json(ok(data));
  } catch (err) {
    res.status(400).json(fail(err.message));
  }
});

module.exports = router;
