/**
 * 工厂信任徽章（F-6）
 *
 * verification_level 语义见 init.sql：0=未核验 / 1=营业执照已核 / 2=实地或视频验厂 / 3=深度验厂。
 * license_verified 是更早（027）的独立布尔开关，口径上等价于 L1 —— 两个字段长期并存，
 * 于是同一个工厂会在结果页说「已核验」、找厂页说「已验真」、后台说「L2」，客户看到的是三套话术。
 * 人读文案统一收在这里，取数仍是各路由自己的 SELECT（列清单已由 factoryProfile 统一）。
 *
 * 为什么只有文案、没有「是否进前 5」的判定：
 *   线上 53 家开了 C 端的工厂里，verification_level=0 的有 41 家、有过审资质证书的 0 家。
 *   在这种分布下把「未验真不进前 5」做成硬门槛，等于让 77% 的工厂永久失去曝光、
 *   让大量询价匹配到 0 家工厂。所以信任只作为排序权重（见 matchService 的排序链），
 *   不做准入过滤；筛选则由客户自己在找厂页显式勾选。
 */

// 0 级不出徽章：给「未验真」挂一个灰色标签，实质是在减分，而它本来也没承诺过什么
const LEVEL_LABELS = {
  1: '执照已核验',
  2: '实地验厂',
  3: '深度验厂',
};

/** 归并两套验真字段，得到 0~3 的统一等级 */
function levelOf(verificationLevel, licenseVerified) {
  const lv = Number(verificationLevel) || 0;
  if (lv > 0) return Math.min(lv, 3);
  return Number(licenseVerified) === 1 ? 1 : 0;
}

/** 人读徽章文案；0 级返回空串（端上 `wx:if="{{item.trustLabel}}"` 直接判空，不会亮空标签） */
function badgeOf(verificationLevel, licenseVerified) {
  return LEVEL_LABELS[levelOf(verificationLevel, licenseVerified)] || '';
}

/**
 * 统一画像对象：撮合卡片、找厂列表、工厂端自查共用同一个形状。
 * @param {{verification_level?:number, license_verified?:number}} row 工厂行（列名用库里的下划线）
 */
function trustOf(row) {
  const r = row || {};
  const level = levelOf(r.verification_level, r.license_verified);
  return { level, verified: level > 0, label: LEVEL_LABELS[level] || '' };
}

module.exports = { LEVEL_LABELS, levelOf, badgeOf, trustOf };
