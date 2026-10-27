/**
 * 工厂首字头像：根据工厂名称生成彩色圆形头像配置
 * 同一家工厂每次生成的颜色一致（基于名称 hash）
 */

const COLOR_PALETTE = [
  '#2563eb', // 蓝
  '#7c3aed', // 紫
  '#db2777', // 粉
  '#dc2626', // 红
  '#ea580c', // 橙
  '#ca8a04', // 黄
  '#16a34a', // 绿
  '#0891b2', // 青
  '#0d9488', // 蓝绿
  '#4f46e5', // 靛蓝
];

/** 简单字符串 hash（同输入恒同输出，保证颜色稳定） */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 生成头像配置
 * @param {string} name 工厂名称
 * @returns {{text: string, color: string}}
 */
function getAvatarConfig(name) {
  if (!name) return { text: '厂', color: '#94a3b8' };

  // 去掉常见行政区划/行业后缀，取真正有意义的首字
  const cleaned = String(name)
    .replace(/^(浙江省|浙江|温州市|温州|龙港市|苍南县|平阳县|瑞安市|乐清市)/, '')
    .replace(/(有限责任公司|股份有限公司|有限公司|印业|包装|印刷|制品|公司|厂)$/g, '');

  const text = (cleaned || name).charAt(0);
  const color = COLOR_PALETTE[hashCode(name) % COLOR_PALETTE.length];

  return { text, color };
}

module.exports = { getAvatarConfig };
