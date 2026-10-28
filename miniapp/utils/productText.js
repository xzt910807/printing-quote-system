/**
 * 产品类型代码 → 中文名（全局唯一权威映射）
 * 各列表页（我的/工厂接单/询价）统一引用, 禁止在页面内再写各自的三元判断,
 * 避免新品类接入时某页漏改（如旧代码把非 carton 全显示成「彩盒」）。
 */
const PRODUCT_TEXT = {
  carton: '纸箱', cardBox: '彩盒', card: '卡片', paperBag: '纸袋', sticker: '不干胶',
  flexiblePackaging: '软包装', nonWovenBag: '无纺布袋', antiCounterfeitLabel: '防伪标签', heatTransfer: '热转印',
  paperContainer: '纸容器',
};

// 未知代码回落原值, 空值返回空串（调用方自行决定是否展示）
function productName(code) {
  if (!code) return '';
  return PRODUCT_TEXT[code] || code;
}

module.exports = { PRODUCT_TEXT, productName };
