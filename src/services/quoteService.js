const { pool } = require('../config/db');
const { generateQuote } = require('../core/engine');
const { generateQuoteNo, parseJsonField } = require('../utils/helpers');

/** 读取客户快照（名称 + 折扣比例），客户不存在返回 null */
async function getCustomerCtx(customerId) {
  if (!customerId) return null;
  const [rows] = await pool.query('SELECT name, discount FROM customer WHERE id = ?', [customerId]);
  return rows.length ? rows[0] : null;
}

/**
 * 应用客户折扣（025）：discount 为付款比例（1=原价，0.95=九五折）。
 * 对税前单价/总价打折，税额按折后基数重算（与 engine 同口径 round）；
 * 成本侧 breakdown 不动——折扣是商业让利，不改变成本结构。
 * 结果上附加 discountRate（实际生效比例）与 discountAmount（含税价优惠金额）。
 */
function applyCustomerDiscount(result, discount) {
  const d = Number(discount);
  if (!d || d >= 1 || d <= 0) {
    result.discountRate = 1;
    result.discountAmount = 0;
    return result;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  const origFinal = result.finalPrice;
  result.unitPrice = r4(result.unitPrice * d);
  result.totalPrice = r2(result.unitPrice * result.quantity);
  result.taxAmount = r2(result.totalPrice * result.taxRate);
  result.finalPrice = r2(result.totalPrice + result.taxAmount);
  result.discountRate = d;
  result.discountAmount = r2(origFinal - result.finalPrice);
  return result;
}

/** 计算器预览：计价 + 客户折扣（customerId 可空） */
async function calcWithCustomer(input, customerId = null) {
  const result = generateQuote(input);
  if (customerId) {
    const customer = await getCustomerCtx(customerId);
    if (customer) applyCustomerDiscount(result, customer.discount);
  }
  if (result.discountRate === undefined) { result.discountRate = 1; result.discountAmount = 0; }
  return result;
}

async function createQuote(input, customerId = null) {
  const result = generateQuote(input);
  let customerName = null;
  let discountRate = 1;
  let discountAmount = 0;
  if (customerId) {
    const customer = await getCustomerCtx(customerId);
    if (customer) {
      customerName = customer.name;
      applyCustomerDiscount(result, customer.discount);
      discountRate = result.discountRate;
      discountAmount = result.discountAmount;
    }
  }
  const quoteNo = generateQuoteNo('Q');

  const sql = `INSERT INTO quote_order (
    quote_no, factory_id, factory_name, customer_id, customer_name, discount_rate,
    product_type, print_mode, length_m, width_m, height_m, quantity,
    material_type, material_code, material_name,
    color_count, plate_code, processes,
    waste_rate, target_margin, tax_rate,
    subtotal, unit_cost, unit_price, total_price, tax_amount, final_price, discount_amount, breakdown
  ) VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?,?,?,?)`;

  const values = [
    quoteNo, input.factoryId || 0, result.factoryName, customerId, customerName, discountRate,
    input.productType || 'carton', input.printMode || 'offset',
    input.lengthM, input.widthM, input.heightM || 0, input.quantity,
    input.materialType, input.materialCode, result.breakdown.material.detail,
    input.colorCount || 4, input.plateCode || 'CTP',
    JSON.stringify(input.processes || []),
    result.wasteRate, result.targetMargin, result.taxRate,
    result.subtotal, result.unitCost, result.unitPrice,
    result.totalPrice, result.taxAmount, result.finalPrice, discountAmount,
    JSON.stringify(result.breakdown),
  ];

  const [ret] = await pool.query(sql, values);
  return { id: ret.insertId, quoteNo, ...result };
}

async function getQuoteById(id) {
  const [rows] = await pool.query('SELECT * FROM quote_order WHERE id = ?', [id]);
  if (!rows.length) return null;
  const row = rows[0];
  // 统一用 parseJsonField，兼容 mysql2 返回对象或字符串
  row.processes = parseJsonField(row.processes, []);
  row.breakdown = parseJsonField(row.breakdown, null);
  return row;
}

async function listQuotes({ page = 1, pageSize = 20, factoryId, customerId, status, keyword }) {
  const conditions = [];
  const params = [];
  if (factoryId)  { conditions.push('factory_id = ?');  params.push(factoryId); }
  if (customerId) { conditions.push('customer_id = ?'); params.push(customerId); }
  if (status)     { conditions.push('status = ?');      params.push(status); }
  // stage14 列表搜索：单号 / 客户名 / 工厂名 模糊匹配
  if (keyword && String(keyword).trim()) {
    const like = '%' + String(keyword).trim() + '%';
    conditions.push('(quote_no LIKE ? OR customer_name LIKE ? OR factory_name LIKE ?)');
    params.push(like, like, like);
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * pageSize;

  const [rows] = await pool.query(
    `SELECT id, quote_no, factory_id, factory_name, customer_name, discount_rate,
            product_type, print_mode, quantity, unit_price, final_price,
            status, created_at
     FROM quote_order ${where}
     ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [cnt] = await pool.query(
    `SELECT COUNT(*) AS total FROM quote_order ${where}`,
    params
  );
  return { list: rows, total: cnt[0].total, page, pageSize };
}

module.exports = { createQuote, getQuoteById, listQuotes, calcWithCustomer };