const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { ok, fail, toCsv, sendCsv } = require('../utils/helpers');
const { parseByRules, parseByAI } = require('../parser/nl-parser');
const quoteService = require('../services/quoteService');
const { requirePermission } = require('../config/permissions');

// 026：工厂身份访问时强制本厂 ID（忽略 body/header 里的 factoryId，防越权以他厂身份计价）
function actorFactoryId(req) {
  return req.factoryUser ? req.factoryUser.factoryId : null;
}

function resolveFactoryId(req) {
  const ownFid = actorFactoryId(req);
  if (ownFid) return ownFid;
  const fromBody = req.body && req.body.factoryId;
  const fromHeader = req.headers['x-factory-id'];
  const fid = parseInt(fromBody !== undefined ? fromBody : (fromHeader !== undefined ? fromHeader : 0), 10);
  return isNaN(fid) ? 0 : fid;
}

router.post('/', requirePermission('calculator:use'), async (req, res) => {
  try {
    const factoryId = resolveFactoryId(req);
    // 025：预览也应用客户折扣，保证「看到的价格 = 保存的价格」
    const { customerId, ...input } = req.body;
    const data = await quoteService.calcWithCustomer({ ...input, factoryId }, customerId);
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

router.post('/save', requirePermission('calculator:use'), async (req, res) => {
  try {
    const factoryId = resolveFactoryId(req);
    const { customerId, ...input } = req.body;
    const data = await quoteService.createQuote({ ...input, factoryId }, customerId);
    res.json(ok(data));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

router.post('/nl', requirePermission('calculator:use'), async (req, res) => {
  try {
    const factoryId = resolveFactoryId(req);
    const { text, useAI = false, save = false, customerId = null } = req.body;
    if (!text) throw new Error('缺少 text 参数');

    let parsed = parseByRules(text);
    if (useAI && (!parsed.quantity || !parsed.lengthM)) {
      const aiParsed = await parseByAI(text);
      parsed = { ...parsed, ...aiParsed };
    }

    const finalInput = {
      factoryId,
      productType: parsed.productType || 'carton',
      printMode: parsed.printMode || 'offset',
      lengthM: parsed.lengthM || 0.3,
      widthM: parsed.widthM || 0.2,
      heightM: parsed.heightM || 0.15,
      quantity: parsed.quantity || 1000,
      materialType: parsed.materialType || 'boardPaper',
      materialCode: parsed.materialCode || 'B_BC5',
      colorCount: parsed.colorCount || 4,
      plateCode: parsed.plateCode || 'CTP',
      processes: parsed.processes || [],
      // Stage7 扩展参数：盒型/拼版/软包装层数与薄膜（nl-parser 已解析）
      boxType: parsed.boxType || 'normal',
      nUp: parsed.nUp || 1,
      filmLayers: parsed.filmLayers || 1,
      filmCodes: parsed.filmCodes,
      // 016 印刷参数：图案覆盖率/油墨类型/专色数量（nl-parser 已解析）
      patternCover: parsed.patternCover || 'mid',
      inkType: parsed.inkType || 'NORMAL',
      spotColors: parsed.spotColors || 0,
    };

    if (save) {
      const data = await quoteService.createQuote(finalInput, customerId);
      return res.json(ok(data, { parsedParams: finalInput }));
    }
    const data = await quoteService.calcWithCustomer(finalInput, customerId);
    res.json(ok(data, { parsedParams: finalInput }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

router.get('/list', requirePermission('quote:view'), async (req, res) => {
  try {
    const { page, pageSize, factoryId, customerId, status, keyword } = req.query;
    const data = await quoteService.listQuotes({
      page: parseInt(page) || 1, pageSize: parseInt(pageSize) || 20,
      // 026：工厂端强制只看本厂报价单
      factoryId: actorFactoryId(req) || (factoryId ? parseInt(factoryId) : undefined),
      customerId: customerId ? parseInt(customerId) : undefined,
      status,
      keyword,
    });
    res.json(ok(data));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

/**
 * GET /api/quote/export
 * 导出报价单 CSV
 * ⚠️ 必须写在 /:id 之前，否则 'export' 会被当成 :id 捕获
 */
router.get('/export', requirePermission('quote:view'), async (req, res) => {
  try {
    // 026：工厂端导出仅限本厂报价单
    const ownFid = actorFactoryId(req);
    const where = ownFid ? ' WHERE factory_id = ?' : '';
    const [rows] = await pool.query(
      `SELECT quote_no, factory_name, customer_name, product_type, quantity,
              unit_price, total_price, final_price, discount_rate, discount_amount, status, created_at
       FROM quote_order${where} ORDER BY id DESC`,
      ownFid ? [ownFid] : []
    );
    const csv = toCsv([
      { key: 'quote_no', label: '单号' },
      { key: 'factory_name', label: '工厂' },
      { key: 'customer_name', label: '客户' },
      { key: 'product_type', label: '产品类型' },
      { key: 'quantity', label: '数量' },
      { key: 'unit_price', label: '单价' },
      { key: 'total_price', label: '总价' },
      { key: 'final_price', label: '含税总价' },
      { key: 'discount_rate', label: '折扣' },
      { key: 'discount_amount', label: '优惠金额' },
      { key: 'status', label: '状态' },
      { key: 'created_at', label: '创建时间' },
    ], rows);
    sendCsv(res, 'quotes.csv', csv);
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

router.get('/:id', requirePermission('quote:view'), async (req, res) => {
  try {
    const data = await quoteService.getQuoteById(req.params.id);
    if (!data) return res.status(404).json(fail('报价单不存在', 404));
    // 026：工厂端只能看本厂报价单
    const ownFid = actorFactoryId(req);
    if (ownFid && Number(data.factory_id) !== Number(ownFid)) {
      return res.status(403).json(fail('无权查看其他工厂的报价单', 403));
    }
    res.json(ok(data));
  } catch (err) { res.status(500).json(fail(err.message, 500)); }
});

/**
 * DELETE /api/quote/:id
 * 删除报价单
 */
router.delete('/:id', requirePermission('quote:view'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // 026：工厂端只能删本厂报价单
    const ownFid = actorFactoryId(req);
    if (ownFid) {
      const [rows] = await pool.query('SELECT factory_id FROM quote_order WHERE id = ?', [id]);
      if (!rows.length) throw new Error('报价单不存在');
      if (Number(rows[0].factory_id) !== Number(ownFid)) throw new Error('无权删除其他工厂的报价单');
    }
    const [ret] = await pool.query('DELETE FROM quote_order WHERE id = ?', [id]);
    if (!ret.affectedRows) throw new Error('报价单不存在');
    res.json(ok({ id, deleted: true }));
  } catch (err) { res.status(400).json(fail(err.message)); }
});

module.exports = router;
