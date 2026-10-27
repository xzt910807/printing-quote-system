// AI 兜底解析走统一 LLM 通道（Agnes 优先，DeepSeek 回退，见 services/llmService.js）
const llm = require('../services/llmService');
// 028：目录新工艺按名称动态识别（catalogService 为内存缓存，取数无 IO）
const catalog = require('../services/catalogService');

const MATERIAL_KEYWORDS = [
  ['白卡', 'cardPaper', 'CARD250'],
  ['牛皮纸', 'cardPaper', 'KRAFT300'],
  ['120g牛皮', 'cardPaper', 'KRAFT120'],
  ['200g牛皮', 'cardPaper', 'KRAFT200'],
  ['无纺布', 'cardPaper', 'NW_100'],
  ['热转印膜', 'cardPaper', 'HTF_FILM'],
  ['合成纸', 'cardPaper', 'STK_SYNTH'],
  ['热敏', 'cardPaper', 'STK_THERMAL'],
  ['哑银', 'cardPaper', 'STK_PETSILVER'],
  ['铜版不干胶', 'cardPaper', 'STK_COPPER'],
  ['不干胶', 'cardPaper', 'STK_COPPER'],
  ['透明PET', 'cardPaper', 'STK_PET'],
  ['PP', 'plasticFilm', 'PP_40'],
  // 顺序敏感：PET 必须排在 PE 前（'PET' 含子串 'PE'，倒序会误命中 PE_50）
  ['PET', 'cardPaper', 'STK_PET'],
  ['PE', 'plasticFilm', 'PE_50'],
  ['铜版', 'cardPaper', 'COAT200'],
  ['牛卡', 'rawPaper', 'KRAFT170'],
  ['瓦楞', 'boardPaper', 'B_B3'],
  ['单坑', 'boardPaper', 'B_B3'],
  ['A楞', 'boardPaper', 'B_A3'],
  ['A坑', 'boardPaper', 'B_A3'],
  ['B楞', 'boardPaper', 'B_B3'],
  ['B坑', 'boardPaper', 'B_B3'],
  ['C楞', 'boardPaper', 'B_C3'],
  ['E楞', 'boardPaper', 'B_E3'],
  ['双坑', 'boardPaper', 'B_BC5'],
  ['三层', 'boardPaper', 'B_B3'],
  ['五层', 'boardPaper', 'B_BC5'],
];

// 产品类型词优先于材料词（如"白卡纸袋"= 纸袋用白卡，不是彩盒）
// 顺序敏感：防伪/复合袋/无纺布须排在标签/纸袋等泛词之前
const PRODUCT_KEYWORDS = [
  ['防伪标签', 'antiCounterfeitLabel'], ['防伪', 'antiCounterfeitLabel'],
  ['软包装', 'flexiblePackaging'], ['复合袋', 'flexiblePackaging'], ['胶袋', 'flexiblePackaging'],
  ['塑料袋', 'flexiblePackaging'], ['自立袋', 'flexiblePackaging'], ['拉链袋', 'flexiblePackaging'],
  ['热转印', 'heatTransfer'], ['模内贴', 'heatTransfer'],
  ['无纺布袋', 'nonWovenBag'], ['无纺布', 'nonWovenBag'], ['环保袋', 'nonWovenBag'],
  ['手提袋', 'paperBag'], ['手挽袋', 'paperBag'], ['纸袋', 'paperBag'], ['购物袋', 'paperBag'],
  ['不干胶', 'sticker'], ['标签', 'sticker'], ['贴纸', 'sticker'],
];

// 品类默认材料（文本只说了品类没材料时的兜底）
const DEFAULT_MATERIAL = {
  paperBag: { materialType: 'cardPaper', materialCode: 'KRAFT300' },
  sticker: { materialType: 'cardPaper', materialCode: 'STK_COPPER' },
  flexiblePackaging: { materialType: 'plasticFilm', materialCode: 'PP_40' },
  nonWovenBag: { materialType: 'cardPaper', materialCode: 'NW_100' },
  antiCounterfeitLabel: { materialType: 'cardPaper', materialCode: 'STK_COPPER' },
  heatTransfer: { materialType: 'cardPaper', materialCode: 'HTF_FILM' },
};

const PROCESS_KEYWORDS = {
  '覆膜': 'MATTE_FILM', '覆哑膜': 'MATTE_FILM', '覆光膜': 'GLOSS_FILM',
  '烫金': 'HOT_STAMP', '烫银': 'HOT_STAMP',
  'uv': 'UV_COAT', '上光': 'UV_COAT',
  '击凸': 'EMBOSS_PROC', '压痕': 'EMBOSS_PROC',
  '模切': 'DIE_CUT', '粘箱': 'GLUE_BOX', '打包': 'PACK',
  '穿绳': 'ROPE', '打扣': 'ROPE', '棉绳': 'ROPE_COTTON', '塑料扣': 'CLASP',
  '车缝': 'SEWING', '缝纫': 'SEWING',
  '复合': 'LAMINATE',
  '三边封': 'BAG_3SEAL', '中封': 'BAG_CENTER', '自立袋': 'BAG_STAND', '拉链': 'BAG_ZIP',
  '激光': 'LASER_AF', '刮刮': 'SCRATCH', '荧光': 'FLUOR',
  '揭开留底': 'VOID_AF', '溯源': 'TRACE_QR', '二维码': 'TRACE_QR',
  '植绒': 'FLOCK', '压纹': 'TEXTURE', '折页': 'FOLD', '打孔': 'PUNCH', '打拢线': 'PERF',
  '骑马订': 'SADDLE', '胶装': 'PERFECT_BIND', '锁线': 'SEW_BIND',
};

const COLOR_KEYWORDS = { '四色': 4, '彩色': 4, 'cmyk': 4, '单色': 1, '双色': 2 };
const PRINT_MODE_KEYWORDS = { '胶印': 'offset', '柔印': 'flexo', '凹印': 'gravure', '数码': 'digital', '丝印': 'screen' };

// 数量词数字 token → 整数：支持纯阿拉伯（1万）、纯中文（一万五）、混写（1万5千 / 1.5万）
// 兼容口语省略：一万五=15000、三千二=3200；有"零"按位直加：一万零五=10005
function qtyTokenToInt(s) {
  const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 };
  let total = 0, section = 0, num = 0, lastUnit = 1, hasLing = false, arabic = '';
  const flush = () => { if (arabic) { num = parseFloat(arabic); arabic = ''; } };
  for (const ch of s) {
    if (/[0-9.]/.test(ch)) { arabic += ch; continue; }  // 阿拉伯数字（含小数点）先缓冲
    if (ch === '零') { flush(); num = 0; hasLing = true; continue; }  // 须在 DIGITS 判断之前
    if (ch in DIGITS) { flush(); num = DIGITS[ch]; continue; }
    const u = UNITS[ch];
    if (!u) return null;
    flush();
    if (u >= 10000) { section = (section + num) * u; total += section; section = 0; }
    else { section += (num || 1) * u; }
    num = 0; lastUnit = u; hasLing = false;
  }
  flush();
  // 尾数字按最后一级单位补位（一万五=15000）；有"零"则直加个位（一万零五=10005）
  return Math.round(total + section + (num ? (hasLing ? num : num * Math.max(lastUnit / 10, 1)) : 0));
}

function parseByRules(text) {
  const lower = text.toLowerCase();
  const result = { processes: [] };

  const qty = text.match(/([0-9.零一二两三四五六七八九十百千万亿]+)\s*(个|只|张|份|件|套|枚|本)/);
  if (qty) {
    // "几十万个"这类约数不取（几/数/上/约/近 前缀直接跳过）
    const prevChar = qty.index > 0 ? text[qty.index - 1] : '';
    if (!/[几数上约近]/.test(prevChar)) {
      const v = qtyTokenToInt(qty[1].replace(/\s+/g, ''));
      if (v != null && !isNaN(v)) result.quantity = v;
    }
  }

  const dim = text.match(/(\d+(?:\.\d+)?)\s*[×xX*]\s*(\d+(?:\.\d+)?)\s*(?:[×xX*]\s*(\d+(?:\.\d+)?))?\s*(mm|厘米|cm|毫米)?/);
  if (dim) {
    const unit = dim[4];
    const div = (unit === '厘米' || unit === 'cm') ? 100 : 1000;
    result.lengthM = parseFloat(dim[1]) / div;
    result.widthM = parseFloat(dim[2]) / div;
    result.heightM = dim[3] ? parseFloat(dim[3]) / div : 0;
  }

  // 1. 产品类型词优先（手提袋/纸袋/不干胶/标签…）
  let productType;
  for (const [kw, pt] of PRODUCT_KEYWORDS) {
    if (lower.includes(kw)) { productType = pt; break; }
  }

  for (const [kw, type, code] of MATERIAL_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      result.materialType = type; result.materialCode = code; break;
    }
  }

  // 028：目录新工艺识别——动态名称匹配先跑（最长名优先、记录命中区间），
  // 硬编码别名表随后；别名命中点若完全落在某条长名区间内则跳过，
  // 保证「雕花压纹」只认新工艺，不连带触发别名「压纹」→ TEXTURE（该品类白名单未必允许，会 400）。
  // 「UV油墨」语境误中的上光类由下方统一剔除逻辑处理（同硬编码 'uv' → UV_COAT 的待遇）
  const procSpans = [];
  try {
    const dynList = Object.values(catalog.baseData.finishing || {})
      .filter((r) => r.name && String(r.name).trim().length >= 2)
      .sort((a, b) => String(b.name).length - String(a.name).length);
    for (const r of dynList) {
      const nm = String(r.name).toLowerCase();
      const idx = lower.indexOf(nm);
      if (idx < 0 || procSpans.some(([s, e]) => idx >= s && idx + nm.length <= e)) continue;
      if (!result.processes.includes(r.code)) result.processes.push(r.code);
      procSpans.push([idx, idx + nm.length]);
    }
  } catch (e) { /* 目录未就绪时静默降级为纯硬编码匹配 */ }

  for (const [kw, code] of Object.entries(PROCESS_KEYWORDS)) {
    if (result.processes.includes(code)) continue;
    const kwl = kw.toLowerCase();
    const idx = lower.indexOf(kwl);
    if (idx < 0 || procSpans.some(([s, e]) => idx >= s && idx + kwl.length <= e)) continue;
    result.processes.push(code);
  }

  for (const [kw, n] of Object.entries(COLOR_KEYWORDS)) {
    if (lower.includes(kw)) { result.colorCount = n; break; }
  }

  for (const [kw, mode] of Object.entries(PRINT_MODE_KEYWORDS)) {
    if (lower.includes(kw)) { result.printMode = mode; break; }
  }

  // ===== 016 图案覆盖率 / 油墨类型 / 专色数量 =====
  // 油墨词须先于工艺词处理：「UV油墨」含子串 'uv'，不先剔除会被工艺表误命中 UV_COAT
  if (/uv油墨|uv印刷/i.test(text)) { result.inkType = 'UV'; result._uvInkHit = true; }
  else if (/金属墨|金银墨|金属油墨/.test(text)) result.inkType = 'METALLIC';
  else if (/荧光墨|荧光油墨/.test(text)) result.inkType = 'FLUOR';
  else if (/大豆墨|大豆油墨|环保墨/.test(text)) result.inkType = 'SOY';

  // 满版/整版 → high；少量图案/以文字为主 → low（默认 mid）
  if (/满版|整版|大面积图案|实地印刷/.test(text)) result.patternCover = 'high';
  else if (/少量图案|简单文字|以文字为主|无图案/.test(text)) result.patternCover = 'low';

  // 专色数量：专色N / N个专色（0-6，超出截断）
  const spot = text.match(/专色\s*(\d+)|(\d+)\s*个\s*专色/);
  if (spot) result.spotColors = Math.min(6, parseInt(spot[1] || spot[2], 10) || 0);

  // 软包装层数：双层/三层（默认单层）
  if (/三层|四层|多层/.test(text)) result.filmLayers = 3;
  else if (/双层|二层|两层/.test(text)) result.filmLayers = 2;

  // 彩盒盒型：天地盖/抽屉盒（默认 normal）
  if (/天地盖/.test(text)) result.boxType = 'lidBase';
  else if (/抽屉/.test(text)) result.boxType = 'drawer';

  // 拼版数量：拼2 / 2拼
  const nup = text.match(/(?:拼\s*(\d+)|(\d+)\s*拼)/);
  if (nup) result.nUp = parseInt(nup[1] || nup[2], 10);

  // 「UV油墨」语境下剔除工艺表因子串 'uv' 误命中的 UV_COAT（上光是另一道工序）
  if (result._uvInkHit) {
    result.processes = result.processes.filter((c) => c !== 'UV_COAT');
    delete result._uvInkHit;
  }

  if (productType) {
    // 品类词命中：品类以词为准，材料缺失时用品类默认材料
    result.productType = productType;
    if (!result.materialType && DEFAULT_MATERIAL[productType]) {
      result.materialType = DEFAULT_MATERIAL[productType].materialType;
      result.materialCode = DEFAULT_MATERIAL[productType].materialCode;
    }
    // 材料词与品类冲突修正：软包装语境下 PET 面材词应指薄膜
    if (productType === 'flexiblePackaging' && result.materialCode === 'STK_PET') {
      result.materialType = 'plasticFilm';
      result.materialCode = 'PET_35';
    }
    // 软包装默认凹印（未显式指定印刷方式时）
    if (productType === 'flexiblePackaging' && !result.printMode) result.printMode = 'gravure';
  } else if (result.materialType === 'boardPaper') result.productType = 'carton';
  else if (result.materialType === 'cardPaper') result.productType = 'cardBox';
  else if (result.materialType === 'plasticFilm') result.productType = 'flexiblePackaging';

  return result;
}

async function parseByAI(text) {
  const prompt = '从以下印刷询价文本中提取JSON参数，字段：productType, printMode, lengthM,widthM,heightM(米), quantity, materialType, materialCode, colorCount, processes, boxType(normal/lidBase/drawer), nUp(拼版数), filmLayers(软包装层数), filmCodes(薄膜编码数组), patternCover(low/mid/high图案覆盖率), inkType(油墨编码NORMAL/UV/METALLIC/FLUOR/SOY), spotColors(专色数量0-6整数)。产品类型取值：carton纸箱/cardBox彩盒/card卡片/paperBag纸袋/sticker不干胶/flexiblePackaging软包装/nonWovenBag无纺布袋/antiCounterfeitLabel防伪标签/heatTransfer热转印。客户文本：' + text + ' 只返回JSON。';
  const content = await llm.chat([{ role: 'user', content: prompt }], { temperature: 0.1, maxTokens: 512 });
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 解析失败');
  return JSON.parse(m[0]);
}

module.exports = { parseByRules, parseByAI };
