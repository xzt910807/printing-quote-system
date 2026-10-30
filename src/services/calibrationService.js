/**
 * 报价校准（把「平台估价」和「真实成交价」对账）
 *
 * 为什么这层值得单独存在：
 *   引擎参数（纸张吨价/版材单价/印工费率/毛利）是手工维护的静态值，而平台自己就握着
 *   「引擎预估」与「真实成交价」两端数据 —— c_inquiry.system_quote 是下单当时的引擎输出快照，
 *   order_main.unit_price 是工厂正式报价折算的真实单价，两者靠 order_main.inquiry_id 一一对应。
 *   这份对照关系是信息类平台拿不到的（它们只撮合、不掌握成交价），也是「报价越用越准」的基础。
 *
 * 两个刻意的设计选择：
 *   1. 用 system_quote **快照**而不是用当前引擎重算历史订单。重算会引入参数漂移的自指：
 *      引擎参数一旦被调到贴近成交价，重算偏差自动趋近 0，看起来「很准」，其实什么都没测到。
 *      快照 + 成交价才是纯粹的「预测 vs 实际」。
 *   2. 样本不足时**不对外宣称偏差**。库里有 3 笔成交就说「偏差 ±2%」比不说更伤人，
 *      所以低于 MIN_SAMPLE 一律返回 level='none'，前端只显示「样本积累中」。
 */
const { pool } = require('../config/db');

// 统计窗口：只看近 N 天成交。行情在动，两年前的成交价对今天没有参考意义。
const WINDOW_DAYS = Number(process.env.CALIBRATION_WINDOW_DAYS) || 180;
// 低于此样本数不对外宣称偏差（分级门槛见 LEVEL_TABLE）
const MIN_SAMPLE = 30;
const LEVEL_TABLE = [
  { min: 300, level: 'high' },
  { min: 100, level: 'medium' },
  { min: MIN_SAMPLE, level: 'low' },
];

// 维度用空串表示「不限」，不能用 NULL：MySQL 唯一索引里 NULL 互不相等，
// 同一维度会重复插行。全量口径（品类级）即 material_code='' && print_mode=''。
const ANY = '';

let cache = { rows: [], byKey: new Map(), computedAt: null };

function keyOf(productType, materialCode, printMode) {
  return productType + '|' + (materialCode || ANY) + '|' + (printMode || ANY);
}

function levelOf(sampleN) {
  for (const t of LEVEL_TABLE) {
    if (sampleN >= t.min) return t.level;
  }
  return 'none';
}

/**
 * 逐笔偏差的派生表：一条 SQL 拿到「规格 → 引擎单价 / 实际单价」的配对样本。
 * 用 JSON_UNQUOTE 而不是直接比较 JSON_EXTRACT 结果，避免 MySQL 拿 JSON 类型参与数值比较时
 * 隐式转换的意外（老版本/脏数据里 system_quote 可能是字符串化的对象）。
 */
const PAIR_SQL = `
  SELECT o.product_type, o.material_code, o.print_mode,
         CAST(JSON_UNQUOTE(JSON_EXTRACT(q.system_quote, '$.unitPrice')) AS DECIMAL(12, 4)) AS engine_unit,
         o.unit_price AS actual_unit
  FROM order_main o
  JOIN c_inquiry q ON q.id = o.inquiry_id
  WHERE o.inquiry_id IS NOT NULL
    AND o.unit_price > 0
    AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
`;

/**
 * 按维度聚合。withDim=false 时压成品类级一行（material_code/print_mode 填 ''），
 * 给「具体材料样本不够、但同品类有参考价值」的场景兜底。
 * bias 用 sum(actual)/sum(engine)-1 而不是 avg(逐笔偏差)：小单笔数多时平均会被拉偏，
 * 加权口径才是「按金额算，平台整体估低/估高了多少」。
 */
function aggSql(withDim) {
  return `
    SELECT product_type,
           ${withDim ? 'material_code, print_mode' : "'' AS material_code, '' AS print_mode"},
           COUNT(*) AS n,
           ROUND(AVG(engine_unit), 4) AS engine_avg,
           ROUND(AVG(actual_unit), 4) AS actual_avg,
           ROUND(SUM(actual_unit) / SUM(engine_unit) - 1, 4) AS bias,
           ROUND(MIN(actual_unit / engine_unit - 1), 4) AS bias_min,
           ROUND(MAX(actual_unit / engine_unit - 1), 4) AS bias_max
    FROM (${PAIR_SQL}) t
    WHERE t.engine_unit > 0 AND t.actual_unit > 0
    GROUP BY product_type ${withDim ? ', material_code, print_mode' : ''}
  `;
}

/**
 * 重算并落库。cron 每日调用一次；也可由运维手动 node -e "require('./src/services/calibrationService').refresh()"。
 * 先算后写：任一步骤失败都不动已有校准行，宁可保留上一次的结果也不要写半张表。
 */
async function refresh() {
  const [detail] = await pool.query(aggSql(true), [WINDOW_DAYS]);
  const [byProduct] = await pool.query(aggSql(false), [WINDOW_DAYS]);
  const rows = [
    ...detail.map((r) => ({ ...r, material_code: r.material_code || ANY, print_mode: r.print_mode || ANY })),
    ...byProduct,
  ];
  if (!rows.length) {
    // 没有任何配对样本：清空旧结果，避免展示早已过期的偏差
    await pool.query('DELETE FROM quote_calibration');
    cache = { rows: [], byKey: new Map(), computedAt: new Date() };
    return { groups: 0, samples: 0 };
  }
  const values = rows.map((r) => [
    r.product_type, r.material_code, r.print_mode,
    Number(r.n) || 0, r.engine_avg, r.actual_avg, r.bias, r.bias_min, r.bias_max, WINDOW_DAYS,
  ]);
  // 用 VALUES(col) 老写法而不是 8.0.19+ 的行别名：与 cronService 的 daily_stats 保持同一风格，
  // 也避免运维环境 MySQL 小版本不一时批量 UPSERT 直接语法错。
  await pool.query(
    `INSERT INTO quote_calibration
       (product_type, material_code, print_mode, sample_n,
        engine_unit_avg, actual_unit_avg, bias, bias_min, bias_max, window_days)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       sample_n = VALUES(sample_n), engine_unit_avg = VALUES(engine_unit_avg),
       actual_unit_avg = VALUES(actual_unit_avg), bias = VALUES(bias),
       bias_min = VALUES(bias_min), bias_max = VALUES(bias_max),
       window_days = VALUES(window_days)`,
    [values]
  );
  await loadAll();
  const samples = rows.reduce((s, r) => s + (Number(r.n) || 0), 0);
  console.log('[calibration] 校准维度 ' + rows.length + ' 组 / 配对样本 ' + samples + ' 笔（近 ' + WINDOW_DAYS + ' 天）');
  return { groups: rows.length, samples };
}

/** 启动加载内存缓存（与 catalog/capability 同模式，避免每次询价都查库） */
async function loadAll() {
  try {
    const [rows] = await pool.query(
      'SELECT product_type, material_code, print_mode, sample_n, engine_unit_avg, actual_unit_avg, bias, bias_min, bias_max, window_days, computed_at FROM quote_calibration'
    );
    const byKey = new Map();
    for (const r of rows) byKey.set(keyOf(r.product_type, r.material_code, r.print_mode), r);
    cache = { rows, byKey, computedAt: new Date() };
  } catch (e) {
    // 表还没建（存量库未执行 ALTER）时不能拖垮启动：退化为「无校准数据」，报价照常
    if (e.code !== 'ER_NO_SUCH_TABLE') console.warn('[calibration] 加载失败:', e.message);
    cache = { rows: [], byKey: new Map(), computedAt: null };
  }
  return cache;
}

/** 已加载的行数（启动日志/健康检查用） */
function size() { return cache.rows.length; }

function rowOf(productType, materialCode, printMode) {
  if (!productType) return null;
  return cache.byKey.get(keyOf(productType, materialCode, printMode))
    || cache.byKey.get(keyOf(productType, materialCode, ANY))
    || cache.byKey.get(keyOf(productType, ANY, ANY))
    || null;
}

/** 偏差文案：统一以「平台估价偏高/偏低」的人话表述，不让端上各自解释正负号 */
function biasText(bias) {
  const pct = Math.abs(Number(bias) || 0) * 100;
  if (pct < 1) return '与平台估价基本一致';
  return '实际成交价平均' + (bias > 0 ? '高于' : '低于') + '平台估价 ' + pct.toFixed(1) + '%';
}

/**
 * 某个规格的估价信度。无数据也返回完整结构（level='none'），调用方不必判空。
 * @param {{productType?:string, materialCode?:string, printMode?:string}} spec
 * @returns {{sampleN:number, bias:number|null, level:string, text:string, windowDays:number|null}}
 */
function confidenceOf(spec) {
  const s = spec || {};
  const row = rowOf(s.productType, s.materialCode, s.printMode);
  if (!row) {
    return { sampleN: 0, bias: null, level: 'none', text: '样本积累中，暂无校准数据', windowDays: null };
  }
  const n = Number(row.sample_n) || 0;
  const level = levelOf(n);
  // 维度越粗，话术越要含糊：品类级的偏差贴到具体材料上会误导
  const exact = row.material_code === (s.materialCode || ANY) && row.print_mode === (s.printMode || ANY);
  if (level === 'none') {
    return { sampleN: n, bias: Number(row.bias), level, text: '样本积累中（已收集 ' + n + ' 笔成交）', windowDays: Number(row.window_days) || WINDOW_DAYS };
  }
  const scope = exact ? '同类成交' : '同类品类成交';
  return {
    sampleN: n,
    bias: Number(row.bias),
    level,
    text: scope + ' ' + n + ' 笔，' + biasText(row.bias),
    windowDays: Number(row.window_days) || WINDOW_DAYS,
  };
}

/** 全部维度（后台/运维排查用） */
function list() {
  return cache.rows.map((r) => ({
    productType: r.product_type,
    materialCode: r.material_code,
    printMode: r.print_mode,
    sampleN: Number(r.sample_n) || 0,
    engineUnitAvg: Number(r.engine_unit_avg) || 0,
    actualUnitAvg: Number(r.actual_unit_avg) || 0,
    bias: Number(r.bias) || 0,
    biasMin: Number(r.bias_min) || 0,
    biasMax: Number(r.bias_max) || 0,
    level: levelOf(Number(r.sample_n) || 0),
    computedAt: r.computed_at,
  }));
}

module.exports = {
  refresh, loadAll, size, confidenceOf, list, levelOf, biasText,
  WINDOW_DAYS, MIN_SAMPLE,
};
