const { calcRawPaperCost, calcBoardCost, calcCardCost, calcCartonArea, calcPaperBagArea, calcLidBaseArea, calcDrawerArea, calcFilmCost } = require('./paper');
const { calcPlateCost } = require('./plate');
const { calcPrintingCost } = require('./printing');
const { calcFinishingCost } = require('./finishing');
const catalog = require('../services/catalogService');
const { round } = require('../utils/helpers');

function generateQuote(input) {
  validateInput(input);
  const {
    factoryId = 0, productType = 'carton', printMode = 'offset',
    lengthM, widthM, heightM = 0, quantity,
    materialType, materialCode,
    colorCount = 4, plateCode = 'CTP', processes = [],
    wasteRate, targetMargin, taxRate,
    // Stage7：盒型/拼版/软包装参数
    boxType = 'normal', nUp = 1,
    filmCodes, filmLayers = 1,
    moldFee = 0, knifeFee = 0,
    // 016：图案覆盖率/油墨类型/专色数量（印工系数与专色加价）
    patternCover = 'mid', inkType = 'NORMAL', spotColors = 0,
  } = input;

  if (!quantity || quantity <= 0) throw new Error('数量必须大于0');
  if (!materialType || !materialCode) throw new Error('必须指定材料类型与编码');

  const factory = catalog.getFactory(factoryId);
  const finalWasteRate = wasteRate !== undefined ? wasteRate : (factory ? factory.default_waste_rate : 0.04);
  const finalMargin = targetMargin !== undefined ? targetMargin : (factory ? factory.default_margin : 0.15);
  const finalTaxRate = taxRate !== undefined ? taxRate : (factory ? factory.default_tax_rate : 0.10);

  let areaPerUnit;
  if (productType === 'carton') {
    areaPerUnit = calcCartonArea({ lengthM, widthM, heightM });
  } else if (productType === 'paperBag' || productType === 'nonWovenBag') {
    // 手提袋/无纺布袋展开面积：lengthM=袋高，widthM=袋宽，heightM=侧宽
    areaPerUnit = calcPaperBagArea({ lengthM, widthM, heightM });
  } else if (productType === 'cardBox' && boxType === 'lidBase') {
    areaPerUnit = calcLidBaseArea({ lengthM, widthM, heightM });
  } else if (productType === 'cardBox' && boxType === 'drawer') {
    areaPerUnit = calcDrawerArea({ lengthM, widthM, heightM });
  } else {
    // cardBox(normal) / card / sticker / antiCounterfeitLabel / heatTransfer / flexiblePackaging：平面矩形+出血位
    areaPerUnit = round((lengthM + 0.04) * (widthM + 0.04), 4);
  }
  const totalArea = round(areaPerUnit * quantity, 4);
  // 软包装薄膜按重量计价用净袋面积（长×宽，不含出血位）
  const filmAreaPerUnit = round(lengthM * widthM, 4);

  let material;
  if (materialType === 'plasticFilm') {
    material = calcFilmCost({
      factoryId,
      filmCodes: filmCodes && filmCodes.length ? filmCodes : [materialCode],
      areaSqmPerUnit: filmAreaPerUnit, layers: filmLayers, quantity,
      wasteRate: finalWasteRate,
    });
  } else if (materialType === 'boardPaper') {
    material = calcBoardCost({ factoryId, boardCode: materialCode, totalArea, wasteRate: finalWasteRate });
  } else if (materialType === 'cardPaper') {
    material = calcCardCost({ factoryId, cardCode: materialCode, totalArea, wasteRate: finalWasteRate });
  } else if (materialType === 'rawPaper') {
    const one = calcRawPaperCost({ factoryId, lengthM, widthM, paperCode: materialCode, wasteRate: finalWasteRate });
    material = { ...one, totalCost: round(one.unitPrice * quantity, 2) };
  } else {
    throw new Error('未知材料类型：' + materialType);
  }

  let plate = calcPlateCost({ factoryId, colorCount, plateCode });
  let printing = calcPrintingCost({
    factoryId, printMode, colorCount, totalArea, quantity,
    patternCover, inkType, spotColors,
  });
  const finishing = calcFinishingCost({ factoryId, processCodes: processes, totalArea, quantity });

  // 拼版摊薄：一张大纸拼 nUp 个成品，版费与印工按拼数摊薄
  if (nUp > 1) {
    plate = { ...plate, totalCost: round(plate.totalCost / nUp, 2), detail: plate.detail + ' | 拼版' + nUp + '个/张摊薄' };
    printing = { ...printing, totalCost: round(printing.totalCost / nUp, 2), detail: printing.detail + ' | 拼版' + nUp + '个/张摊薄' };
  }

  // 软包装固定费分摊：模具费（PE袋模 3000-8000）+ 刀模费（复合袋 200-600）按数量摊入单价
  let fixedFee = 0;
  const fixedItems = [];
  if (productType === 'flexiblePackaging') {
    const mold = Number(moldFee) || 0;
    const knife = Number(knifeFee) || 0;
    if (mold > 0) {
      fixedFee += mold;
      fixedItems.push({ name: '模具费', cost: mold, detail: '模具费 ' + mold + '元 ÷ ' + quantity + '个分摊' });
    }
    if (knife > 0) {
      fixedFee += knife;
      fixedItems.push({ name: '刀模费', cost: knife, detail: '刀模费 ' + knife + '元 ÷ ' + quantity + '个分摊' });
    }
  }

  const subtotal = round(material.totalCost + plate.totalCost + printing.totalCost + finishing.totalCost + fixedFee, 2);
  const unitCost = round(subtotal / quantity, 4);
  const unitPrice = round(unitCost * (1 + finalMargin), 4);
  const totalPrice = round(unitPrice * quantity, 2);
  const taxAmount = round(totalPrice * finalTaxRate, 2);
  const finalPrice = round(totalPrice + taxAmount, 2);

  return {
    factoryId,
    factoryName: factory ? factory.name : '系统默认',
    unitPrice, totalPrice, taxAmount, finalPrice,
    subtotal, unitCost, quantity, totalArea, areaPerUnit,
    targetMargin: finalMargin, taxRate: finalTaxRate, wasteRate: finalWasteRate,
    breakdown: {
      material: { name: '材料费', cost: material.totalCost, perUnit: round(material.totalCost / quantity, 4), detail: material.detail, priceSource: material.priceSource },
      plate: { name: '版费', cost: plate.totalCost, perUnit: round(plate.totalCost / quantity, 4), detail: plate.detail, priceSource: plate.priceSource },
      printing: { name: '印工', cost: printing.totalCost, perUnit: round(printing.totalCost / quantity, 4), detail: printing.detail, priceSource: printing.priceSource },
      finishing: { name: '后道', cost: finishing.totalCost, perUnit: round(finishing.totalCost / quantity, 4), items: finishing.items },
      fixed: { name: '固定费分摊', cost: round(fixedFee, 2), perUnit: round(fixedFee / quantity, 4), items: fixedItems },
    },
  };
}

// 产品类型联动校验（Stage8）：配置存在的品类严格收窄印刷方式/材料/工艺，
// 未配置的品类放行（向后兼容未来新品类）。配置来自 product_config 表，随目录缓存加载。
function validateInput(input) {
  const cfg = catalog.getProductConfig(input.productType);
  if (!cfg) return;
  const label = cfg.productName || input.productType;
  if (cfg.printModes.length && input.printMode && !cfg.printModes.includes(input.printMode)) {
    throw new Error(label + '不支持该印刷方式（可选：' + cfg.printModes.join('/') + '）');
  }
  if (cfg.materials.length && input.materialCode && !cfg.materials.includes(input.materialCode)) {
    throw new Error(label + '不能使用材料「' + input.materialCode + '」');
  }
  if (cfg.processes.length && Array.isArray(input.processes)) {
    for (const p of input.processes) {
      if (!cfg.processes.includes(p)) throw new Error(label + '不支持工艺「' + p + '」');
    }
  }
}

module.exports = { generateQuote };
