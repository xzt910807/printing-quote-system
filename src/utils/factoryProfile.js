/**
 * 工厂画像字段（Batch D1）
 *
 * 一、下发列清单为什么单独收在这里：/list（找厂列表）、/public/:id（C 端工厂详情）、
 *    /api/catalog/factories（后台工厂列表）以前各自手写一份 SELECT 列，长期不同步——
 *    /public 漏过 province/city，后台列表漏过 province/city/c_end_enabled/verification_level，
 *    结果是后台「编辑工厂」打开时这些字段是空，保存一次就把已核验工厂的地区和 C 端接单开关清掉。
 *    三处共用同一份常量，加列只改这里一次。
 * 二、硬指标白名单：工厂端 PUT /me/profile 与后台 PUT /api/factory/:id 都要校验同一批
 *    数值字段，两边各写一份校验迟早漂移，故一并收在这里。
 */

// C 端可见列：找厂列表与工厂详情共用（不含 password_hash / api_token / 内部定价参数）
const FACTORY_C_COLS = [
  'id', 'code', 'name', 'contact', 'phone', 'address', 'province', 'city', 'intro',
  'c_end_enabled', 'audit_status',
  'rating', 'rating_count', 'total_accepts', 'avg_response_hours',
  'license_verified', 'verification_level',
  'capacity_status', 'capacity_note', 'capacity_updated_at',
  // 经营硬指标 + 浏览量（印查查式工厂画像）
  'factory_area', 'annual_volume', 'employee_count', 'equipment_count',
  'assembly_lines', 'outer_processing', 'view_count',
].join(', ');

// 后台可见列 = C 端列 + 运营需要看/需要改的内部字段（仍不含 password_hash / api_token）
const FACTORY_ADMIN_COLS = [
  FACTORY_C_COLS,
  'username', 'default_margin', 'default_tax_rate', 'default_waste_rate',
  'verification_note', 'verified_at', 'status', 'applied_at', 'created_at', 'updated_at',
  // Batch D2 坐标：后台只查看/纠正，采集入口在小程序工厂端「地图选址」
  'lat', 'lng',
].join(', ');

// 硬指标白名单：请求体字段名 → 表列名 + 校验上限（int=true 要求整数）
// 上限只是防手滑（把 500 写成 5000000），不是业务规则；view_count 不在这里——它只由服务端自增
const HARD_METRICS = [
  { field: 'factoryArea',    column: 'factory_area',   label: '厂房面积(㎡)',    max: 1e7,  int: true },
  { field: 'annualVolume',   column: 'annual_volume',  label: '年交易额(万元)',  max: 1e10, int: false },
  { field: 'employeeCount',  column: 'employee_count', label: '员工总数',        max: 1e6,  int: true },
  { field: 'equipmentCount', column: 'equipment_count', label: '主要设备台数',   max: 1e5,  int: true },
  { field: 'assemblyLines',  column: 'assembly_lines', label: '流水线条数',      max: 1e4,  int: true },
];

/**
 * 归一一个硬指标值。
 * undefined（没传这个字段）→ set=false，调用方不要写这一列：
 * 资料页常常只改电话/地址，无条件写 NULL 会把工厂已经填过的面积、设备数清空。
 * null / 空串 → 归一为 NULL，让工厂能撤回自己填错的数据。
 */
function normalizeMetric(meta, raw) {
  if (raw === undefined) return { set: false, value: null };
  if (raw === null || String(raw).trim() === '') return { set: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(meta.label + '请填写数字');
  if (n < 0) throw new Error(meta.label + '不能为负数');
  if (n > meta.max) throw new Error(meta.label + '超出可填写范围（最大 ' + meta.max + '）');
  if (meta.int && !Number.isInteger(n)) throw new Error(meta.label + '需为整数');
  return { set: true, value: n };
}

// 是否对外加工：只允许 0/1/NULL（NULL=未表态，列表端不做假设）
// 返回 undefined 代「本次没传这个字段、不要动这一列」，与 normalizeMetric 的 set=false 同义
function normalizeOuterProcessing(raw) {
  if (raw === undefined) return undefined;
  if (raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (n !== 0 && n !== 1) throw new Error('是否对外加工只能选「是」或「否」');
  return n;
}

/**
 * 地图坐标（Batch D2）：lat/lng 一律成对处理。
 * 只写一个轴的坐标在距离计算里永远用不上（haversineKm 需要两个），
 * 与其让它静静地躺在库里算不出距离，不如当场报错让端上补全。
 * 两个都没传 → set=false（不要动这两列）；两个都传空 → 归一为 NULL（工厂主动撤回选址）。
 */
function normalizeGeoPair(rawLat, rawLng) {
  if (rawLat === undefined && rawLng === undefined) return { set: false, lat: null, lng: null };
  const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));
  const lat = clean(rawLat);
  const lng = clean(rawLng);
  if (lat === null && lng === null) return { set: true, lat: null, lng: null };
  if (lat === null || lng === null) throw new Error('经纬度必须一起填（请在地图上选点）');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('纬度超出有效范围（-90 ~ 90）');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('经度超出有效范围（-180 ~ 180）');
  // decimal(10,6)：多于 6 位小数的精度存不住，按 6 位截齐，免得前端以为存了更高精度
  return { set: true, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

module.exports = {
  FACTORY_C_COLS, FACTORY_ADMIN_COLS, HARD_METRICS,
  normalizeMetric, normalizeOuterProcessing, normalizeGeoPair,
};
