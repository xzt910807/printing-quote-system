/**
 * 地理距离计算（Batch D2）
 *
 * 找厂列表的「距离最近」排序走内存计算而不是 SQL 球面函数：候选集已被能力匹配
 * （matchedIds）限定在几百家内，Node 侧一次遍历的成本可以忽略，而 MySQL 里要么用
 * ST_Distance_Sphere（对 decimal 列要先转 POINT、且索引帮不上忙），要么写一长串
 * acos 公式塞进 ORDER BY——两种都没法让「无坐标的厂恒排末尾」这条规则写得清楚。
 * 与 capacity 排序同为「SQL 先出候选集 + Node 侧内存排序」的既有模式。
 */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * 两点间球面距离（km），Haversine 公式。
 * 任一坐标缺失（null / 空串）或超出地球坐标范围返回 null（调用方按「算不出距离」处理，
 * 不要拿 NaN 去排序）。注意必须先挡 null：Number(null) === 0 是有限数，
 * 直接转会把「没填坐标」当成赤道上经度 0 的那个点算出一个假距离。
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';
  if (!present(lat1) || !present(lng1) || !present(lat2) || !present(lng2)) return null;
  const a = Number(lat1);
  const b = Number(lng1);
  const c = Number(lat2);
  const d = Number(lng2);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  if (Math.abs(a) > 90 || Math.abs(c) > 90 || Math.abs(b) > 180 || Math.abs(d) > 180) return null;
  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// 保留 1 位小数下发（3.2km 比 3.1873421093 更适合给人看）
function roundKm(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  return Math.round(km * 10) / 10;
}

module.exports = { haversineKm, roundKm };
