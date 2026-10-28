const { pool } = require('../config/db');

// 历史/演示数据里的工艺错码 → finishing_process 目录标准码（仅用于展示归一, 不改库）
const PROCESS_ALIAS = {
  EMBOSS: 'EMBOSS_PROC', // 击凸
  HOT_FOIL: 'HOT_STAMP', // 烫金
};

class CatalogService {
  constructor() {
    this.baseData = {
      rawPaper: {}, boardPaper: {}, cardPaper: {}, plasticFilm: {},
      fluteFactor: {}, plateType: {}, printingRate: {}, finishing: {},
      inkType: {}, productConfig: {},
    };
    this.factoryOverrides = {};
    this.factories = {};
    this.loadedAt = null;
  }

  async loadAll() {
    const [raws] = await pool.query('SELECT * FROM raw_paper WHERE is_active = 1');
    const [boards] = await pool.query('SELECT * FROM board_paper WHERE is_active = 1');
    const [cards] = await pool.query('SELECT * FROM card_paper WHERE is_active = 1');
    const [films] = await pool.query('SELECT * FROM plastic_film WHERE is_active = 1');
    const [flutes] = await pool.query('SELECT * FROM flute_factor');
    const [plates] = await pool.query('SELECT * FROM plate_type WHERE is_active = 1');
    const [rates] = await pool.query('SELECT * FROM printing_rate');
    const [finish] = await pool.query('SELECT * FROM finishing_process WHERE is_active = 1');
    const [inks] = await pool.query('SELECT * FROM ink_type WHERE is_active = 1');
    const [pconfigs] = await pool.query('SELECT * FROM product_config WHERE is_active = 1');

    this.baseData.rawPaper = indexBy(raws, 'code');
    this.baseData.boardPaper = indexBy(boards, 'code');
    this.baseData.cardPaper = indexBy(cards, 'code');
    this.baseData.plasticFilm = indexBy(films, 'code');
    this.baseData.fluteFactor = indexBy(flutes, 'flute');
    this.baseData.plateType = indexBy(plates, 'code');
    this.baseData.printingRate = indexBy(rates, 'print_mode');
    this.baseData.finishing = indexBy(finish, 'code');
    // 油墨类型目录（016：图案覆盖率/油墨类型/专色数量三参数的系数源之一）
    this.baseData.inkType = indexBy(inks, 'code');
    // 产品类型联动配置：JSON 列解析为数组，键为 product_type
    this.baseData.productConfig = {};
    for (const row of pconfigs) {
      this.baseData.productConfig[row.product_type] = {
        productType: row.product_type,
        productName: row.product_name,
        printModes: parseJsonCol(row.allowed_print_modes),
        materials: parseJsonCol(row.allowed_materials),
        processes: parseJsonCol(row.allowed_processes),
        sortOrder: row.sort_order,
        // 020 三参数显隐开关（≠0 即显；列缺失/NULL 时按显式处理，兼容迁移前的旧缓存行）
        showPatternCover: row.show_pattern_cover !== 0,
        showInkType: row.show_ink_type !== 0,
        showSpotColors: row.show_spot_colors !== 0,
      };
    }

    const [factories] = await pool.query('SELECT * FROM factory WHERE status = 1');
    this.factories = indexBy(factories, 'id');

    const [overrides] = await pool.query('SELECT * FROM factory_price_override');
    this.factoryOverrides = {};
    for (const o of overrides) {
      const fid = o.factory_id;
      if (!this.factoryOverrides[fid]) this.factoryOverrides[fid] = {};
      if (!this.factoryOverrides[fid][o.target_type]) this.factoryOverrides[fid][o.target_type] = {};
      if (!this.factoryOverrides[fid][o.target_type][o.target_code]) this.factoryOverrides[fid][o.target_type][o.target_code] = {};
      this.factoryOverrides[fid][o.target_type][o.target_code][o.field_name] = o.field_value;
    }

    this.loadedAt = new Date();
    return this;
  }

  getFactory(factoryId) { return this.factories[factoryId] || null; }

  getMerged(factoryId, targetType, code) {
    const baseRow = this.baseData[targetType] && this.baseData[targetType][code];
    if (!baseRow) return null;
    const ov = (this.factoryOverrides[factoryId] && this.factoryOverrides[factoryId][targetType] && this.factoryOverrides[factoryId][targetType][code]) || {};
    return { ...baseRow, ...ov, _source: Object.keys(ov).length ? 'factory' : 'system' };
  }

  getRawPaper(fid, code) { return this.getMerged(fid, 'rawPaper', code); }
  getBoardPaper(fid, code) { return this.getMerged(fid, 'boardPaper', code); }
  getCardPaper(fid, code) { return this.getMerged(fid, 'cardPaper', code); }
  getPlasticFilm(fid, code) { return this.getMerged(fid, 'plasticFilm', code); }
  getPlate(fid, code) { return this.getMerged(fid, 'plateType', code); }
  getPrintingRate(fid, code) { return this.getMerged(fid, 'printingRate', code); }
  getFinishing(fid, code) { return this.getMerged(fid, 'finishing', code); }
  getFluteFactor(flute) { return this.baseData.fluteFactor[flute]; }
  // 油墨类型目录（{ code: { name, price_factor, ... } }；未知编码返回 null）
  // 020：支持工厂级覆盖（factory_price_override，targetType=inkType），与材料/费率同一机制
  getInkType(factoryId, code) {
    const merged = this.getMerged(factoryId || 0, 'inkType', code);
    return merged || this.baseData.inkType[code] || null;
  }
  // 产品类型联动配置（{ printModes, materials, processes } 数组；未配置返回 null）
  getProductConfig(productType) { return this.baseData.productConfig[productType] || null; }

  // 产品类型编码 → 中文名（以 product_config 目录为准, 未知回落原码）
  // 报表/导出等需要人读品名的地方统一走这里, 避免各页面各写一份映射漏改导致界面露英文
  productTypeName(code) {
    if (!code) return '';
    const cfg = this.baseData.productConfig[code];
    return (cfg && cfg.productName) || code;
  }

  // 材料编码 → 中文名（跨卡纸/瓦楞/卷筒/薄膜四表查找, 未知回落原码）
  materialName(code) {
    if (!code) return '';
    for (const t of ['cardPaper', 'boardPaper', 'rawPaper', 'plasticFilm']) {
      const row = this.baseData[t][code];
      if (row && row.name) return row.name;
    }
    return code;
  }

  /**
   * 把询价/订单行的生产参数解析成人读文案, 供工厂端列表卡展示（工厂据此判断能否接单/如何报价）。
   * 尺寸按 mm 显示（库内以米存, ×1000 取整）; 缺项返回空串, 前端自行隐藏。
   * @param {Object} r 含 print_mode/length_m/width_m/height_m/material_code/color_count/spot_colors/processes
   */
  describeSpec(r) {
    const mm = (v) => Math.round(Number(v) * 1000);
    let sizeText = '';
    if (Number(r.length_m) > 0 && Number(r.width_m) > 0) {
      const h = Number(r.height_m) > 0 ? mm(r.height_m) : 0;
      sizeText = h ? `${mm(r.length_m)}×${mm(r.width_m)}×${h}mm` : `${mm(r.length_m)}×${mm(r.width_m)}mm`;
    }
    const printModeText = (this.baseData.printingRate[r.print_mode] || {}).name || r.print_mode || '';
    const materialText = this.materialName(r.material_code);
    let colorText = '';
    if (Number(r.color_count) > 0) {
      colorText = r.color_count + '色';
      if (Number(r.spot_colors) > 0) colorText += '+' + r.spot_colors + '专色';
    }
    let procArr = r.processes;
    if (typeof procArr === 'string') { try { procArr = JSON.parse(procArr); } catch (e) { procArr = []; } }
    const processText = (Array.isArray(procArr) ? procArr : [])
      .map((c) => {
        const std = PROCESS_ALIAS[c] || c; // 历史/演示错码归一到标准码, 避免展示英文原码
        return (this.baseData.finishing[std] || {}).name || std;
      })
      .filter(Boolean).join('、');
    return { sizeText, printModeText, materialText, colorText, processText };
  }

  getFullCatalog(factoryId = 0) {
    const merge = (type) => {
      const out = {};
      for (const code of Object.keys(this.baseData[type])) {
        out[code] = this.getMerged(factoryId, type, code);
      }
      return out;
    };
    return {
      factoryId,
      factory: this.factories[factoryId] || null,
      rawPaper: merge('rawPaper'),
      boardPaper: merge('boardPaper'),
      cardPaper: merge('cardPaper'),
      plasticFilm: merge('plasticFilm'),
      plateType: merge('plateType'),
      printingRate: merge('printingRate'),
      finishing: merge('finishing'),
      fluteFactor: this.baseData.fluteFactor,
    };
  }

  getOverrides(factoryId) { return this.factoryOverrides[factoryId] || {}; }
}

function indexBy(rows, key) {
  const map = {};
  for (const row of rows) map[row[key]] = row;
  return map;
}

// MySQL JSON 列经 mysql2 可能返回对象/数组或字符串，统一解析为数组
function parseJsonCol(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

const catalogService = new CatalogService();
module.exports = catalogService;
