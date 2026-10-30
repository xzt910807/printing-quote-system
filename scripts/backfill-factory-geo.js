/**
 * 一次性回填脚本：按 factory.city 填充市中心坐标（lat/lng）。
 * 用法：
 *   node scripts/backfill-factory-geo.js            # 试运行（打印匹配结果，不写库）
 *   node scripts/backfill-factory-geo.js --apply    # 实际写入
 *   node scripts/backfill-factory-geo.js --apply --force   # 连已填过坐标的一并重写
 *
 * 为什么要有这个脚本：Batch D2 的「距离最近」排序需要厂级坐标，而存量工厂的
 * lat/lng 全是 NULL——不回填的话距离排序对所有厂都算不出距离，功能等于没上。
 * 精确到市的中心点只是「粗距离」（同城厂之间的距离会显示成 0.0km 或几公里内的偏差），
 * 真机在小程序「我的工厂 → 地图选址」里选点即可覆盖成准确位置。
 *
 * 匹配规则：city 精确命中下表才写，命中不到的一律保持 NULL（不拿省会硬凑、不猜）。
 * 已填过 lat/lng 的行默认跳过（--force 覆盖），避免把工厂自己选的点冲掉。
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// 印刷产业集中城市 → 市中心坐标（GPS 84，lat 纬度 / lng 经度，6 位小数与列宽一致）
// 表按省分组，收录的是包装印刷产业集中的城市，不是全国地级市全表
const CITY_GEO = [
  // 浙江（印刷/包装产业主带）
  { city: '温州市', lat: 27.993846, lng: 120.699362 },
  { city: '杭州市', lat: 30.274084, lng: 120.155070 },
  { city: '宁波市', lat: 29.868388, lng: 121.544379 },
  { city: '金华市', lat: 29.078005, lng: 119.647441 },   // 含义乌
  { city: '台州市', lat: 28.656654, lng: 121.420335 },
  { city: '嘉兴市', lat: 30.752206, lng: 120.750129 },
  { city: '绍兴市', lat: 30.001644, lng: 120.582596 },
  { city: '湖州市', lat: 30.894239, lng: 120.089940 },
  // 广东（书刊/纸盒/软包第一大省）
  { city: '深圳市', lat: 22.543099, lng: 114.057868 },
  { city: '广州市', lat: 23.129162, lng: 113.264434 },
  { city: '东莞市', lat: 23.020665, lng: 113.751780 },
  { city: '佛山市', lat: 23.021836, lng: 113.121901 },
  { city: '中山市', lat: 22.517000, lng: 113.392760 },
  { city: '汕头市', lat: 23.353523, lng: 116.681972 },
  { city: '揭阳市', lat: 23.549997, lng: 116.372718 },
  { city: '珠海市', lat: 22.270651, lng: 113.576695 },
  { city: '惠州市', lat: 23.111530, lng: 114.416140 },
  { city: '江门市', lat: 22.578738, lng: 113.081992 },
  { city: '潮州市', lat: 23.656756, lng: 116.622235 },
  { city: '湛江市', lat: 21.270768, lng: 110.359372 },
  { city: '肇庆市', lat: 23.047160, lng: 112.465035 },
  { city: '清远市', lat: 23.681791, lng: 113.056049 },
  // 江苏
  { city: '南京市', lat: 32.060376, lng: 118.796877 },
  { city: '苏州市', lat: 31.298886, lng: 120.585297 },
  { city: '无锡市', lat: 31.491169, lng: 120.311917 },
  { city: '常州市', lat: 31.810675, lng: 119.973987 },
  { city: '南通市', lat: 31.980192, lng: 120.894292 },
  { city: '扬州市', lat: 32.394633, lng: 119.412893 },
  { city: '徐州市', lat: 34.205836, lng: 117.284811 },
  // 直辖市
  { city: '上海市', lat: 31.230370, lng: 121.473701 },
  { city: '北京市', lat: 39.904579, lng: 116.407048 },
  { city: '天津市', lat: 39.343357, lng: 117.361648 },
  { city: '重庆市', lat: 29.563008, lng: 106.551556 },
  // 山东 / 河北 / 河南
  { city: '青岛市', lat: 36.067117, lng: 120.382619 },
  { city: '济南市', lat: 36.651183, lng: 117.120097 },
  { city: '潍坊市', lat: 36.706944, lng: 119.161757 },
  { city: '烟台市', lat: 37.463597, lng: 121.447838 },
  { city: '临沂市', lat: 35.104672, lng: 118.356407 },
  { city: '石家庄市', lat: 38.042307, lng: 114.514859 },
  { city: '保定市', lat: 38.874462, lng: 115.464555 },
  { city: '廊坊市', lat: 39.518631, lng: 116.683288 },
  { city: '唐山市', lat: 39.630468, lng: 118.182452 },
  { city: '郑州市', lat: 34.746599, lng: 113.625368 },
  { city: '洛阳市', lat: 34.619682, lng: 112.453987 },
  // 华中 / 华南其他
  { city: '武汉市', lat: 30.592754, lng: 114.305469 },
  { city: '长沙市', lat: 28.227950, lng: 112.938814 },
  { city: '南昌市', lat: 28.682881, lng: 115.858198 },
  { city: '赣州市', lat: 25.845296, lng: 114.933927 },
  // 福建
  { city: '厦门市', lat: 24.479627, lng: 118.081902 },
  { city: '泉州市', lat: 24.873795, lng: 118.675720 },
  { city: '福州市', lat: 26.074342, lng: 119.296494 },
  { city: '漳州市', lat: 24.512939, lng: 117.647286 },
  // 西南 / 西北 / 东北
  { city: '成都市', lat: 30.572965, lng: 104.066301 },
  { city: '西安市', lat: 34.341568, lng: 108.940174 },
  { city: '昆明市', lat: 25.038103, lng: 102.718281 },
  { city: '贵阳市', lat: 26.646664, lng: 106.630224 },
  { city: '南宁市', lat: 22.816229, lng: 108.317918 },
  { city: '桂林市', lat: 25.273566, lng: 110.299022 },
  { city: '海口市', lat: 20.044001, lng: 110.199891 },
  { city: '乌鲁木齐市', lat: 43.825592, lng: 87.616848 },
  { city: '兰州市', lat: 36.061564, lng: 103.834344 },
  { city: '太原市', lat: 37.870590, lng: 112.548879 },
  { city: '呼和浩特市', lat: 40.842386, lng: 111.749995 },
  { city: '沈阳市', lat: 41.805753, lng: 123.431499 },
  { city: '大连市', lat: 38.914590, lng: 121.614683 },
  { city: '长春市', lat: 43.816963, lng: 125.323544 },
  { city: '哈尔滨市', lat: 45.803775, lng: 126.534967 },
  // 华东其他
  { city: '合肥市', lat: 31.820587, lng: 117.227215 },
  { city: '芜湖市', lat: 31.352859, lng: 118.435355 },
];

// city 列存的是「温州市」这种带市后缀的标准名（见 backfill-region.js），
// 但也可能有历史脏数据写成「温州」，所以两边都试一次
const GEO_MAP = new Map(CITY_GEO.map((c) => [c.city, c]));
function matchGeo(city) {
  const raw = String(city || '').trim();
  if (!raw) return null;
  return GEO_MAP.get(raw) || GEO_MAP.get(raw.endsWith('市') ? raw : raw + '市') || null;
}

async function main() {
  const doApply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    console.log(`目标库：${process.env.DB_NAME}@${process.env.DB_HOST}`);
    console.log(`城市坐标表：${CITY_GEO.length} 个市\n`);
    console.log(`模式：${doApply ? '★ 执行回填' : '试运行（不写库）'}${force ? ' + --force 覆盖已填' : ''}\n`);

    // 列存在性检查（lat/lng 由 Batch D2 引入，存量库要先跑 schema-sync）
    const [[{ cnt: colCnt }]] = await conn.query(
      `SELECT COUNT(*) cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND COLUMN_NAME IN ('lat','lng')`);
    if (colCnt < 2) {
      console.error('❌ factory 表缺少 lat/lng 列，先执行：node scripts/schema-sync.js --apply');
      process.exit(1);
    }
    // 索引不会由 schema-sync 建（它只比表名/列名），这里顺手提示，别让运维漏掉
    const [[{ cnt: idxCnt }]] = await conn.query(
      `SELECT COUNT(DISTINCT INDEX_NAME) cnt FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND INDEX_NAME = 'idx_latlng'`);
    if (!idxCnt) {
      console.warn('⚠️ 缺索引 idx_latlng，请手工执行：ALTER TABLE factory ADD INDEX idx_latlng(lat, lng);');
    }

    const sql = force
      ? 'SELECT id, name, province, city, lat, lng FROM factory'
      : 'SELECT id, name, province, city, lat, lng FROM factory WHERE lat IS NULL OR lng IS NULL';
    const [rows] = await conn.query(sql);
    let matched = 0, missed = 0, failed = 0;
    const bucket = {};
    for (const f of rows) {
      const geo = matchGeo(f.city);
      if (!geo) {
        missed++;
        console.log(`  ⚠️ 未匹配 #${f.id} ${f.name} → city=${f.city || '(空)'}`);
        continue;
      }
      const tag = `${f.province || '-'}/${f.city}`;
      bucket[tag] = (bucket[tag] || 0) + 1;
      if (!doApply) {
        matched++;
        console.log(`  ✓ #${f.id} ${f.name} → ${geo.lat}, ${geo.lng} (${tag})`);
        continue;
      }
      try {
        await conn.query('UPDATE factory SET lat = ?, lng = ? WHERE id = ?', [geo.lat, geo.lng, f.id]);
        matched++;
      } catch (e) {
        failed++;
        console.warn(`  ✗ #${f.id} 更新失败：${e.message}`);
      }
    }
    console.log('\n分市统计：');
    Object.entries(bucket).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k.padEnd(24) + v));
    console.log(`\n合计：候选 ${rows.length} / 匹配 ${matched} / 未命中 ${missed}${doApply ? ' / 失败 ' + failed : ''}`);
    if (!doApply) console.log('\n确认无误后执行：node scripts/backfill-factory-geo.js --apply');
    else console.log('\n提示：回填的是市中心粗坐标；工厂在小程序「我的工厂 → 地图选址」选点后会被覆盖为精确位置。');
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[backfill-factory-geo] 失败:', e.message); process.exit(1); });
