/**
 * 一次性回填脚本：从 factory.address 提取 province/city 并写回。
 * 用法：
 *   node scripts/backfill-region.js            # 试运行（打印匹配结果，不写库）
 *   node scripts/backfill-region.js --apply    # 实际写入
 *
 * 匹配策略（按关键词优先级从高到低）：
 *   1) 命中"城市别称/下辖县"→ 映射到标准 city + 上级 province（如 龙港→温州市/浙江省）
 *   2) 只命中省名 → 城市留空（后续可管理端补）
 *   3) 未命中 → 保持 NULL
 * 已填 province/city 的行默认跳过（--force 覆盖）。
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// 主要城市/重点县别称 → [省, 市]。城市顺序按印刷行业分布排序（浙江先行）
// 关键词命中规则：address 出现任一关键词即视为该市
const CITY_HINTS = [
  // 浙江
  { keys: ['龙港', '温州', '瑞安', '乐清', '永嘉'], province: '浙江省', city: '温州市' },
  { keys: ['杭州', '萧山', '余杭', '临安', '富阳'], province: '浙江省', city: '杭州市' },
  { keys: ['宁波', '余姚', '慈溪', '镇海'], province: '浙江省', city: '宁波市' },
  { keys: ['金华', '义乌', '东阳', '永康'], province: '浙江省', city: '金华市' },
  { keys: ['台州', '温岭', '玉环', '临海'], province: '浙江省', city: '台州市' },
  { keys: ['嘉兴', '海宁', '桐乡'], province: '浙江省', city: '嘉兴市' },
  { keys: ['绍兴', '诸暨', '上虞'], province: '浙江省', city: '绍兴市' },
  // 广东
  { keys: ['深圳', '宝安', '龙岗', '龙华'], province: '广东省', city: '深圳市' },
  { keys: ['广州', '番禺', '白云', '花都'], province: '广东省', city: '广州市' },
  { keys: ['东莞', '虎门', '长安'], province: '广东省', city: '东莞市' },
  { keys: ['佛山', '顺德', '南海'], province: '广东省', city: '佛山市' },
  { keys: ['中山', '小榄'], province: '广东省', city: '中山市' },
  { keys: ['汕头', '潮阳'], province: '广东省', city: '汕头市' },
  // 江苏
  { keys: ['南京', '江宁', '浦口'], province: '江苏省', city: '南京市' },
  { keys: ['苏州', '昆山', '常熟', '吴江'], province: '江苏省', city: '苏州市' },
  { keys: ['无锡', '江阴', '宜兴'], province: '江苏省', city: '无锡市' },
  { keys: ['南通', '海门'], province: '江苏省', city: '南通市' },
  { keys: ['常州'], province: '江苏省', city: '常州市' },
  // 上海 / 北京 / 天津 / 重庆
  { keys: ['上海', '浦东', '闵行', '松江'], province: '上海市', city: '上海市' },
  { keys: ['北京', '朝阳', '海淀', '通州'], province: '北京市', city: '北京市' },
  { keys: ['天津', '滨海'], province: '天津市', city: '天津市' },
  { keys: ['重庆', '沙坪坝'], province: '重庆市', city: '重庆市' },
  // 山东 / 河北 / 河南 / 湖北 / 湖南 / 福建
  { keys: ['青岛', '崂山', '黄岛'], province: '山东省', city: '青岛市' },
  { keys: ['济南'], province: '山东省', city: '济南市' },
  { keys: ['潍坊', '寿光'], province: '山东省', city: '潍坊市' },
  { keys: ['石家庄'], province: '河北省', city: '石家庄市' },
  { keys: ['保定'], province: '河北省', city: '保定市' },
  { keys: ['郑州'], province: '河南省', city: '郑州市' },
  { keys: ['武汉'], province: '湖北省', city: '武汉市' },
  { keys: ['长沙'], province: '湖南省', city: '长沙市' },
  { keys: ['厦门'], province: '福建省', city: '厦门市' },
  { keys: ['福州'], province: '福建省', city: '福州市' },
  { keys: ['泉州', '晋江'], province: '福建省', city: '泉州市' },
  // 四川 / 陕西 / 安徽 / 江西
  { keys: ['成都'], province: '四川省', city: '成都市' },
  { keys: ['西安'], province: '陕西省', city: '西安市' },
  { keys: ['合肥'], province: '安徽省', city: '合肥市' },
  { keys: ['芜湖'], province: '安徽省', city: '芜湖市' },
  { keys: ['南昌'], province: '江西省', city: '南昌市' },
];

// 省名单独兜底（未命中城市时按省填）
const PROVINCE_HINTS = [
  { keys: ['浙江'], province: '浙江省' },
  { keys: ['广东'], province: '广东省' },
  { keys: ['江苏'], province: '江苏省' },
  { keys: ['山东'], province: '山东省' },
  { keys: ['福建'], province: '福建省' },
  { keys: ['河北'], province: '河北省' },
  { keys: ['河南'], province: '河南省' },
  { keys: ['湖北'], province: '湖北省' },
  { keys: ['湖南'], province: '湖南省' },
  { keys: ['安徽'], province: '安徽省' },
  { keys: ['江西'], province: '江西省' },
  { keys: ['四川'], province: '四川省' },
  { keys: ['陕西'], province: '陕西省' },
];

function matchRegion(address) {
  const text = String(address || '');
  for (const c of CITY_HINTS) {
    for (const k of c.keys) {
      if (text.includes(k)) return { province: c.province, city: c.city, hit: k };
    }
  }
  for (const p of PROVINCE_HINTS) {
    for (const k of p.keys) {
      if (text.includes(k)) return { province: p.province, city: null, hit: k };
    }
  }
  return null;
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
    console.log(`模式：${doApply ? '★ 执行回填' : '试运行（不写库）'}${force ? ' + --force 覆盖已填' : ''}\n`);

    // 表存在性检查（province/city 列由 030 迁移引入）
    const [[{ cnt: colCnt }]] = await conn.query(
      `SELECT COUNT(*) cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factory' AND COLUMN_NAME IN ('province','city')`);
    if (colCnt < 2) {
      console.error('❌ factory 表缺少 province/city 列，请先跑 030 迁移：node scripts/migrate.js apply');
      process.exit(1);
    }

    const sql = force
      ? 'SELECT id, name, address, province, city FROM factory'
      : 'SELECT id, name, address, province, city FROM factory WHERE province IS NULL OR city IS NULL';
    const [rows] = await conn.query(sql);
    let matched = 0, skipped = 0, missed = 0;
    const bucket = {};
    for (const f of rows) {
      const m = matchRegion(f.address);
      if (!m) { missed++; console.log(`  ⚠️ 未匹配 #${f.id} ${f.name} → ${f.address || '(空)'}`); continue; }
      bucket[m.province + '/' + (m.city || '-')] = (bucket[m.province + '/' + (m.city || '-')] || 0) + 1;
      if (!doApply) {
        matched++;
        console.log(`  ✓ #${f.id} ${f.name} → ${m.province} / ${m.city || '未定'} (命中 "${m.hit}")`);
        continue;
      }
      try {
        await conn.query('UPDATE factory SET province = ?, city = ? WHERE id = ?', [m.province, m.city, f.id]);
        matched++;
      } catch (e) {
        skipped++;
        console.warn(`  ✗ #${f.id} 更新失败：${e.message}`);
      }
    }
    console.log('\n分省/市统计：');
    Object.entries(bucket).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k.padEnd(20) + v));
    console.log(`\n合计：候选 ${rows.length} / 匹配 ${matched} / 未命中 ${missed}${doApply ? ' / 失败 ' + skipped : ''}`);
    if (!doApply) console.log('\n确认无误后执行：node scripts/backfill-region.js --apply');
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[backfill-region] 失败:', e.message); process.exit(1); });
