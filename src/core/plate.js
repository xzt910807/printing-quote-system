const catalog = require('../services/catalogService');
const { round } = require('../utils/helpers');

function calcPlateCost({ factoryId, colorCount = 4, plateCode = 'CTP', quantity }) {
  const plate = catalog.getPlate(factoryId, plateCode);
  if (!plate) throw new Error('未知版材：' + plateCode);
  const qty = quantity || (plateCode === 'CTP' ? colorCount : 1);
  const totalCost = round(plate.unit_price * qty, 2);
  return {
    totalCost, unitPrice: plate.unit_price, quantity: qty,
    plateName: plate.name, priceSource: plate._source,
    detail: plate.name + ' ' + qty + '张 × ' + plate.unit_price + '元[' + plate._source + ']',
  };
}

module.exports = { calcPlateCost };
