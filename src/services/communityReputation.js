/**
 * 社区声望 → 撮合排序（Batch E）
 *
 * 只回答一个问题：这家工厂在社区里「愿意报价、且报的价被人认可」吗？
 * 数据来自 community_comment 的答价（is_quote=1）与被采纳（is_accepted=1），近 90 天窗口。
 *
 * 三条不能松的口：
 * 1. **绝不抛错**。这段跑在 C 端询价的主路径上（客户按下「算一算」的必经环节），
 *    社区表没数据、还没建、甚至 SQL 出错，都只能退化成「没有社区分」，不能让询价 500。
 * 2. **一次查询算完一批厂**，与既有 followedSet 同模式，不按厂循环查（N+1）。
 * 3. **分数有上限**（MAX_SCORE）。刷答价能刷到上限，但刷不过口碑与接单率——社区分只在
 *    排序链最末尾做 tiebreaker，不参与主序（理由见 matchService 里那行排序）。
 */
const { pool } = require('../config/db');

/** 统计窗口：太短看不出稳定性，太长会把换了老板的老账算在现任头上 */
const WINDOW_DAYS = 90;
/** 被采纳一次的权重：远高于答价（答价是低成本行为，被采纳才是客户认可的强信号） */
const ACCEPT_WEIGHT = 3;
/** 封顶：超过这个分在同分档里已无区别，封顶可防「刷答价」把分数做到无穷大 */
const MAX_SCORE = 20;

const EMPTY = { quoteCount: 0, acceptedCount: 0, score: 0, badge: '' };

/** 端上直出的徽章文案，服务层拼好（小程序不写第二套映射） */
function badgeOf(quoteCount, acceptedCount) {
  if (!quoteCount && !acceptedCount) return '';
  const parts = [`社区答价 ${quoteCount} 次`];
  if (acceptedCount) parts.push(`被采纳 ${acceptedCount} 次`);
  return parts.join(' · ');
}

/**
 * 一次性聚合一批工厂的社区表现
 * @param {Array<number>} factoryIds
 * @returns {Promise<Map<number, {quoteCount:number, acceptedCount:number, score:number, badge:string}>>}
 */
async function loadReputation(factoryIds) {
  const map = new Map();
  const ids = (Array.isArray(factoryIds) ? factoryIds : [])
    .map((x) => Number(x)).filter((n) => n > 0);
  if (!ids.length) return map;
  let rows = [];
  try {
    // 仅统计 published 且有 factory_id 的答价：客户评论、被删/待审的答价都不算
    [rows] = await pool.query(
      `SELECT factory_id, COUNT(*) AS q, SUM(is_accepted) AS a
         FROM community_comment
        WHERE author_type = 'factory' AND status = 'published' AND is_quote = 1
          AND factory_id IN (?) AND created_at >= DATE_SUB(NOW(), INTERVAL ${WINDOW_DAYS} DAY)
        GROUP BY factory_id`, [ids]);
  } catch (e) {
    console.error('[communityReputation] 社区声望聚合失败，按无社区数据继续：', e.message);
    return map;
  }
  for (const r of rows) {
    const quoteCount = Number(r.q) || 0;
    const acceptedCount = Number(r.a) || 0;
    map.set(Number(r.factory_id), {
      quoteCount,
      acceptedCount,
      score: Math.min(acceptedCount * ACCEPT_WEIGHT + quoteCount, MAX_SCORE),
      badge: badgeOf(quoteCount, acceptedCount),
    });
  }
  return map;
}

/** 取某厂的社区声望；查不到给全零，调用方不必判空 */
function repOf(map, factoryId) {
  const hit = map && map.get(Number(factoryId));
  return hit || { ...EMPTY };
}

module.exports = { loadReputation, repOf, WINDOW_DAYS, MAX_SCORE };
