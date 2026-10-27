const catalog = require('../services/catalogService');
const { round } = require('../utils/helpers');

function calcFinishingCost({ factoryId, processCodes = [], totalArea, quantity }) {
  const items = [];
  let total = 0;
  for (const code of processCodes) {
    const rule = catalog.getFinishing(factoryId, code);
    if (!rule) continue;
    let cost = 0, detail = '';
    if (rule.mode === 'perSqm') {
      cost = totalArea * rule.rate * (1 + rule.waste_rate);
      detail = rule.name + ': ' + totalArea + '㎡ × ' + rule.rate + '元[' + rule._source + ']';
    } else if (rule.mode === 'perSqm_withPlate') {
      cost = totalArea * rule.rate + rule.plate_fee;
      detail = rule.name + ': ' + totalArea + '㎡ × ' + rule.rate + '元 + 版费' + rule.plate_fee + '[' + rule._source + ']';
    } else if (rule.mode === 'perUnit') {
      cost = quantity * rule.rate;
      detail = rule.name + ': ' + quantity + '个 × ' + rule.rate + '元[' + rule._source + ']';
    }
    // 小批量上浮：加工类工艺（穿绳/车缝等）数量低于阈值时调机费摊薄不足，按系数上浮
    if (rule.small_qty_threshold > 0 && quantity < rule.small_qty_threshold && cost > 0) {
      cost = cost * rule.small_qty_factor;
      detail += '（批量<' + rule.small_qty_threshold + ' 上浮×' + rule.small_qty_factor + '）';
    }
    cost = round(cost, 2);
    total += cost;
    items.push({ code, name: rule.name, cost, priceSource: rule._source, detail });
  }
  return { totalCost: round(total, 2), items };
}

module.exports = { calcFinishingCost };
