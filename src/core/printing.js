const catalog = require('../services/catalogService');
const { round } = require('../utils/helpers');

/**
 * 印工计算（016 升级版）
 * 在基础印工之上叠加三档图案覆盖率系数、油墨类型系数与专色加价：
 *   totalCost = 基础印工 × 图案系数 × 油墨系数 + 专色数 × 专色版单价
 * 系数默认值在 printing_rate（ink_factor_*）与 ink_type（price_factor），
 * 工厂可经 factory_price_override（printingRate + ink_factor_* 字段）覆盖。
 */
function calcPrintingCost({
  factoryId,
  printMode,
  colorCount = 4,
  totalArea,
  quantity,
  patternCover = 'mid',  // low / mid / high
  inkType = 'NORMAL',    // 油墨类型编码
  spotColors = 0,        // 专色数量
}) {
  const rate = catalog.getPrintingRate(factoryId, printMode);
  if (!rate) throw new Error('未知印刷方式：' + printMode);

  // 1. 基础印工（原逻辑不变）
  let baseCost = 0;
  let baseDetail = '';
  if (rate.mode === 'perSqm') {
    baseCost = totalArea * colorCount * rate.color_rate;
    if (baseCost < rate.min_charge) baseCost = rate.min_charge;
    baseDetail = colorCount + '色 × ' + totalArea + '㎡ × ' + rate.color_rate + '元';
  } else if (rate.mode === 'startFee') {
    const extraUnits = Math.max(0, Math.ceil((quantity - 1000) / 1000));
    baseCost = rate.start_fee + extraUnits * rate.extra_per_1000;
    baseDetail = '开机' + rate.start_fee + '元 + ' + extraUnits + '千印 × ' + rate.extra_per_1000 + '元';
  } else if (rate.mode === 'perUnit') {
    baseCost = quantity * rate.min_charge;
    baseDetail = quantity + '件 × ' + rate.min_charge + '元';
  }

  // 2. 图案覆盖率系数（印刷方式维度，工厂可覆盖；缺省回退 1/1.3/1.8）
  const patternFactorMap = {
    low: Number(rate.ink_factor_low) || 1.00,
    mid: Number(rate.ink_factor_mid) || 1.30,
    high: Number(rate.ink_factor_high) || 1.80,
  };
  const patternFactor = patternFactorMap[patternCover] || 1.00;

  // 3. 油墨类型系数（系统目录 ink_type，工厂可覆盖 price_factor；编码未知时按 1.0 处理并记入明细）
  const ink = catalog.getInkType ? catalog.getInkType(factoryId, inkType) : null;
  const inkFactor = ink ? Number(ink.price_factor) || 1.00 : 1.00;

  // 4. 专色加价（按色数 × 专色版单价，默认 350 元/色）
  const spotN = Math.max(0, parseInt(spotColors, 10) || 0);
  const spotPlate = catalog.getPlate(factoryId, 'SPOT_COLOR');
  const spotUnit = spotPlate ? Number(spotPlate.unit_price) : 350;
  const spotColorCost = spotN * (spotUnit || 350);

  const totalCost = round(baseCost * patternFactor * inkFactor + spotColorCost, 2);

  // 5. 明细（沿用 name: 明细[source] 风格，系数非默认才标注）
  const parts = [baseDetail];
  if (patternFactor !== 1.00) parts.push('图案' + patternCover + ' ×' + patternFactor);
  if (inkFactor !== 1.00) parts.push((ink ? ink.name : inkType) + ' ×' + inkFactor);
  if (spotColorCost > 0) parts.push('专色' + spotN + '色 ×' + spotUnit + '元');
  const detail = rate.name + ': ' + parts.join(' · ') + '[' + rate._source + ']';

  return {
    totalCost,
    mode: rate.mode,
    priceSource: rate._source,
    baseCost: round(baseCost, 2),
    patternFactor,
    inkFactor,
    spotColors: spotN,
    spotColorCost,
    detail,
  };
}

module.exports = { calcPrintingCost };
