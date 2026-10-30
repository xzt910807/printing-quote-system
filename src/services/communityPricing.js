/**
 * 社区帖子的结构化规格与「平台参考价」（Batch E）
 *
 * 独立成一个模块而不是塞进 690 行的 communityService：这里只做两件与计价相关的事
 * （规格白名单归一 + 调计价引擎算锚定价），审计/计数/审核逻辑一概不碰。
 *
 * 三条设计约束：
 * 1. 参考价只用**系统基准价**（generateQuote 传 factoryId=0）。工厂价是商业敏感信息，
 *    公开帖里展示某家的报价等于替它向同行报价；且按最优工厂价展示，其余工厂就没有报价意愿了。
 *    系统基准价与结果页 systemQuote 同口径，两处数字能对上。
 * 2. **算不出价绝不阻断发帖**。规格校验不过或引擎抛错（品类白名单外的组合）时，
 *    丢弃 spec 与 estimate，帖子照常落库，只把错误文案回给端上提示。
 * 3. 快照是**发帖那一刻**的价，不做后台重算。价格口径会随目录调价而变，
 *    重算会让历史帖的数字集体漂移；过期感由端上用 calculatedAt 加一句话解决。
 */
const { generateQuote } = require('../core/engine');
const catalog = require('./catalogService');

/** 尺寸与数量的取值域：超出范围的多半是误按（300 当成 300mm 还是 3 米）或恶意刷价 */
const MIN_MM = 10;
const MAX_MM = 5000;
const MAX_QTY = 10000000;
const MAX_NUP = 20;
const MAX_FILM_LAYERS = 5;
const MAX_PROCESSES = 8;
const BOX_TYPES = ['normal', 'lidBase', 'drawer'];

const str = (v) => String(v == null ? '' : v).trim();

function intIn(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** 规格里的数组字段可能是 JSON 字符串（端上 storage 回填时被序列化过） */
function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v) {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
  }
  return [];
}

/**
 * 规格归一：白名单裁剪，不合格直接返回 error（调用方丢弃 spec 但继续发帖）
 * 为什么不在引擎里做：engine 的白名单校验是「配置存在才收窄」，且校验失败是 throw；
 * 社区要把「不合规的规格」变成「没有规格的正常帖子」，只能在进入引擎前先归一。
 * @returns {{spec: Object|null, error: string|null}}
 */
function normalizeSpec(raw) {
  if (raw == null || raw === '') return { spec: null, error: null };
  let obj = raw;
  if (typeof obj === 'string') {
    try { obj = JSON.parse(obj); } catch (e) { return { spec: null, error: '规格格式不正确' }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { spec: null, error: '规格格式不正确' };

  const productType = str(obj.productType);
  const cfg = productType ? catalog.getProductConfig(productType) : null;
  if (!cfg) return { spec: null, error: '规格里的产品类型不在平台品类目录内' };

  // 印刷方式：白名单内有就用，没有或未传则取首个可选项（picker 默认值同口径）
  const rawPrint = str(obj.printMode);
  let printMode = rawPrint;
  if (cfg.printModes.length) {
    printMode = cfg.printModes.includes(rawPrint) ? rawPrint : cfg.printModes[0];
  } else if (!printMode) {
    printMode = '';
  }
  if (!printMode) return { spec: null, error: '规格里缺少印刷方式' };

  const materialCode = str(obj.materialCode);
  if (!materialCode) return { spec: null, error: '规格里缺少材料' };
  // 白名单为空表示该品类不限材料（与 engine.validateInput 同口径），此时不做拦截
  if (cfg.materials.length && !cfg.materials.includes(materialCode)) {
    return { spec: null, error: '该品类不支持所选材料，未生成参考价' };
  }

  const lengthMm = intIn(obj.lengthMm, MIN_MM, MAX_MM, 0);
  const widthMm = intIn(obj.widthMm, MIN_MM, MAX_MM, 0);
  if (!lengthMm || !widthMm) return { spec: null, error: '规格里的长宽需在 10~5000mm 之间' };
  const heightMm = intIn(obj.heightMm, 0, MAX_MM, 0);
  const quantity = intIn(obj.quantity, 1, MAX_QTY, 0);
  if (!quantity) return { spec: null, error: '规格里的数量需在 1~10000000 之间' };

  // 工艺：品类配了白名单就只留白名单内且目录里真实存在的工序，静默丢弃其余（不整条打回）
  const allowed = new Set(cfg.processes);
  const seen = new Set();
  const processes = [];
  for (const it of asArray(obj.processes)) {
    const code = str(it);
    if (!code || seen.has(code)) continue;
    if (allowed.size && !allowed.has(code)) continue;
    if (!catalog.baseData.finishing[code]) continue;
    seen.add(code);
    processes.push(code);
    if (processes.length >= MAX_PROCESSES) break;
  }

  const boxTypeRaw = str(obj.boxType);
  return {
    spec: {
      productType,
      printMode,
      lengthMm,
      widthMm,
      heightMm,
      quantity,
      materialCode,
      processes,
      boxType: BOX_TYPES.includes(boxTypeRaw) ? boxTypeRaw : 'normal',
      nUp: intIn(obj.nUp, 1, MAX_NUP, 1),
      filmLayers: intIn(obj.filmLayers, 1, MAX_FILM_LAYERS, 1),
    },
    error: null,
  };
}

/**
 * 按平台计价模型算参考价快照
 * 材料大类必须由编码反查（四张材料表编码不重叠），查不到说明材料码不在目录里，直接降级。
 * @returns {{ok: boolean, estimate: Object|null, error: string|null}}
 */
function estimateOf(spec) {
  if (!spec || !spec.productType) return { ok: false, estimate: null, error: null };
  const materialType = catalog.materialTypeOf(spec.materialCode);
  if (!materialType) return { ok: false, estimate: null, error: '材料不在平台材料目录内，未生成参考价' };
  let r;
  try {
    r = generateQuote({
      factoryId: 0,
      productType: spec.productType,
      printMode: spec.printMode,
      lengthM: spec.lengthMm / 1000,
      widthM: spec.widthMm / 1000,
      heightM: (spec.heightMm || 0) / 1000,
      quantity: spec.quantity,
      materialType,
      materialCode: spec.materialCode,
      processes: spec.processes || [],
      boxType: spec.boxType || 'normal',
      nUp: spec.nUp || 1,
      filmLayers: spec.filmLayers || 1,
    });
  } catch (e) {
    // 白名单外的组合会在这里 throw（引擎按 product_config 严格收窄），降级即可
    return { ok: false, estimate: null, error: '该参数组合暂不支持估算：' + e.message.slice(0, 60) };
  }
  if (!r || typeof r !== 'object' || !Number.isFinite(Number(r.unitPrice))) {
    return { ok: false, estimate: null, error: '参考价计算失败' };
  }
  return {
    ok: true,
    error: null,
    // 只留展示与对账需要的字段：把整份 engine 结果存进去会让快照表体型翻倍且大半用不上
    estimate: {
      unitPrice: r.unitPrice,
      totalPrice: r.totalPrice,
      taxAmount: r.taxAmount,
      finalPrice: r.finalPrice,
      quantity: r.quantity,
      breakdown: r.breakdown,
      calculatedAt: new Date().toISOString(),
      priceSource: 'system',
    },
  };
}

/**
 * 规格的人读文案（复用 catalog.describeSpec，不写第二套映射）
 * describeSpec 吃的是米制查询行，这里把 spec 的 mm 转回米再交给它，文案口径与计算器/询价单一致。
 */
function specTextOf(spec) {
  if (!spec || !spec.productType) return null;
  const d = catalog.describeSpec({
    length_m: spec.lengthMm / 1000,
    width_m: spec.widthMm / 1000,
    height_m: (spec.heightMm || 0) / 1000,
    print_mode: spec.printMode,
    material_code: spec.materialCode,
    processes: spec.processes || [],
  });
  return [d.sizeText, d.printModeText, d.materialText, d.processText].filter(Boolean).join(' · ');
}

module.exports = { normalizeSpec, estimateOf, specTextOf };
