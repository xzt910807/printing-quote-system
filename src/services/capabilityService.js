const { pool } = require('../config/db');

class CapabilityService {
  constructor() {
    // { factoryId: { productType: Set, printMode: Set, process: Set, material: Set } }
    this.cache = {};
    this.loadedAt = null;
  }

  async loadAll() {
    const [rows] = await pool.query('SELECT * FROM factory_capability');
    this.cache = {};
    for (const r of rows) {
      if (!this.cache[r.factory_id]) {
        this.cache[r.factory_id] = {
          productType: new Set(),
          printMode:   new Set(),
          process:     new Set(),
          material:    new Set(),
        };
      }
      this.cache[r.factory_id][r.capability_type]?.add(r.capability_code);
    }
    this.loadedAt = new Date();
    return this;
  }

  /** 判断某工厂是否具备某项能力 */
  has(factoryId, type, code) {
    return this.cache[factoryId]?.[type]?.has(code) || false;
  }

  /** 判断工厂能否满足整套需求 */
  canHandle(factoryId, requirement) {
    const caps = this.cache[factoryId];
    if (!caps) return false;

    // 产品类型
    if (requirement.productType && !caps.productType.has(requirement.productType)) {
      return false;
    }
    // 印刷方式
    if (requirement.printMode && !caps.printMode.has(requirement.printMode)) {
      return false;
    }
    // 材料
    if (requirement.materialCode && !caps.material.has(requirement.materialCode)) {
      return false;
    }
    // 后道工艺（每一项都必须具备）
    if (requirement.processes?.length) {
      for (const p of requirement.processes) {
        if (!caps.process.has(p)) return false;
      }
    }
    return true;
  }

  /** 返回某工厂的完整能力（供查询接口用） */
  getByFactory(factoryId) {
    const caps = this.cache[factoryId];
    if (!caps) {
      return { productType: [], printMode: [], process: [], material: [] };
    }
    return {
      productType: [...caps.productType],
      printMode:   [...caps.printMode],
      process:     [...caps.process],
      material:    [...caps.material],
    };
  }

  /** 查询：具备指定能力的工厂ID列表 */
  findFactories(filter) {
    const result = [];
    for (const fid of Object.keys(this.cache)) {
      if (this.canHandle(parseInt(fid), filter)) {
        result.push(parseInt(fid));
      }
    }
    return result;
  }
}

const capabilityService = new CapabilityService();
module.exports = capabilityService;