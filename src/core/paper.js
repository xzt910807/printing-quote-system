const catalog = require('../services/catalogService');
const { round } = require('../utils/helpers');

function calcRawPaperCost({ factoryId, lengthM, widthM, paperCode, wasteRate }) {
  const paper = catalog.getRawPaper(factoryId, paperCode);
  if (!paper) throw new Error('未知原纸：' + paperCode);
  const basePrice = (lengthM * widthM * paper.grammage * paper.price_per_ton) / 1000000;
  const unitPrice = basePrice * (1 + wasteRate);
  return {
    unitPrice: round(unitPrice, 4), basePrice: round(basePrice, 4), wasteRate,
    priceSource: paper._source,
    detail: paper.name + ' | ' + lengthM + '×' + widthM + 'm | ' + paper.grammage + 'g/m² | ' + paper.price_per_ton + '元/吨[' + paper._source + ']',
  };
}

function calcBoardCost({ factoryId, boardCode, totalArea, wasteRate }) {
  const b = catalog.getBoardPaper(factoryId, boardCode);
  if (!b) throw new Error('未知纸板：' + boardCode);
  const cost = totalArea * b.price_per_sqm * (1 + wasteRate);
  return {
    unitPricePerSqm: b.price_per_sqm, totalCost: round(cost, 2),
    totalArea: round(totalArea, 4), wasteRate, priceSource: b._source,
    detail: b.name + ' | ' + b.price_per_sqm + '元/㎡[' + b._source + ']',
  };
}

function calcCardCost({ factoryId, cardCode, totalArea, wasteRate }) {
  const c = catalog.getCardPaper(factoryId, cardCode);
  if (!c) throw new Error('未知卡纸：' + cardCode);
  const cost = totalArea * c.price_per_sqm * (1 + wasteRate);
  return {
    unitPricePerSqm: c.price_per_sqm, totalCost: round(cost, 2),
    totalArea: round(totalArea, 4), wasteRate, priceSource: c._source,
    detail: c.name + ' | ' + c.price_per_sqm + '元/㎡[' + c._source + ']',
  };
}

function calcCartonArea({ lengthM, widthM, heightM, glueFlapM = 0.04 }) {
  return round((lengthM + widthM) * 2 * heightM + glueFlapM * heightM, 4);
}

// 手提袋单张展开面积：
//   展开宽 = (袋宽 + 侧宽) × 2 + 糊口
//   展开高 = 袋高 + 侧宽×0.5(底折) + 翻口
// 尺寸语义约定：lengthM=袋高，widthM=袋宽，heightM=侧宽（与前端表单对齐）
// 无纺布袋与纸袋结构相同（有侧折和翻边的车缝袋），复用本公式
function calcPaperBagArea({ lengthM, widthM, heightM, glueFlapM = 0.04, foldTopM = 0.05 }) {
  const unfoldW = (widthM + heightM) * 2 + glueFlapM;
  const unfoldH = lengthM + heightM * 0.5 + foldTopM;
  return round(unfoldW * unfoldH, 4);
}

// 天地盖盒（lid + base 两件套）展开面积：
//   盖 = (长+2×高+0.02) × (宽+2×高+0.02)；底盒 = (长+0.01) × (宽+0.01) 周圈围折 + 底
//   简化：盖按盒面+四边包边展开，底按套合间隙 1mm 缩小；两者相加为一套用纸
function calcLidBaseArea({ lengthM, widthM, heightM }) {
  const lid = (lengthM + heightM * 2 + 0.02) * (widthM + heightM * 2 + 0.02);
  const base = (lengthM - 0.001 + heightM * 2 + 0.015) * (widthM - 0.001 + heightM * 2 + 0.015);
  return round(lid + base, 4);
}

// 抽屉盒（外套 + 内抽）展开面积：
//   外套四面包裹+插舌，内抽三面围折；简化按外套 2.5 倍盒面 + 内抽 2.5 倍盒面估算
function calcDrawerArea({ lengthM, widthM, heightM }) {
  const sideH = heightM * 2 + 0.01;
  const sleeve = (lengthM + sideH + 0.04) * (widthM + sideH + 0.04);
  const inner = (lengthM + 0.015) * (widthM + heightM * 2 + 0.03);
  return round(sleeve + inner, 4);
}

// 塑料薄膜按重量计价（软包装核心模型）：
//   单袋材料(kg) = 长(m)×宽(m)×厚度(μm)×比重×层数 ÷ 1000
//   验证：40×30cm 双层 PP_40(40μm/0.91/14.6元/kg) = 0.4×0.3×40×0.91×2/1000 = 0.008736kg ≈ 0.1275元/个
// filmCodes 每层一个编码，不足层数时按第一层补齐（如双层同材质传 ['PP_40']）
function calcFilmCost({ factoryId, filmCodes, areaSqmPerUnit, layers = 1, quantity, wasteRate }) {
  const codes = filmCodes && filmCodes.length ? filmCodes : ['PP_40'];
  let unitCost = 0;
  const parts = [];
  let firstSource = 'system';
  for (let i = 0; i < layers; i++) {
    const code = codes[i] || codes[0];
    const f = catalog.getPlasticFilm(factoryId, code);
    if (!f) throw new Error('未知薄膜：' + code);
    if (i === 0) firstSource = f._source;
    const kgPerUnit = round((areaSqmPerUnit * f.thickness_um * f.density) / 1000, 6);
    const c = kgPerUnit * f.price_per_kg;
    unitCost += c;
    parts.push(f.name + ' ' + kgPerUnit + 'kg');
  }
  const totalCost = round(unitCost * quantity * (1 + wasteRate), 2);
  return {
    unitCost: round(unitCost, 4), totalCost,
    totalArea: round(areaSqmPerUnit * quantity, 4), layers, wasteRate,
    priceSource: firstSource,
    detail: parts.join(' + ') + ' × ' + quantity + '个 | 损耗' + Math.round(wasteRate * 100) + '%[' + firstSource + ']',
  };
}

module.exports = { calcRawPaperCost, calcBoardCost, calcCardCost, calcCartonArea, calcPaperBagArea, calcLidBaseArea, calcDrawerArea, calcFilmCost };
