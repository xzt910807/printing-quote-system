/**
 * 结构同步比对工具（开发阶段 init.sql 单一权威策略的配套工具）
 * 背景：sql/migrations 已清空，表结构变更直接改 sql/init.sql；
 *       于是「某个库到底缺了哪些列/表」不再有迁移文件可依据，需要本工具按 init.sql 反查。
 *
 * 用法：
 *   node scripts/schema-sync.js            # 只读比对，打印差异报告
 *   node scripts/schema-sync.js --sql      # 额外打印补齐 DDL（可粘贴到 mysql 客户端执行）
 *   node scripts/schema-sync.js --apply    # 直接执行补齐 DDL（只加不删）
 *
 * 安全约定：
 *   - 只做「加法」：CREATE TABLE / ADD COLUMN，绝不生成 DROP，避免误删线上数据；
 *   - 库里多出来的表/列只在报告里列出，由人判断处置；
 *   - 不比对索引/约束/字符序差异（init.sql 由 mysqldump 导出，新表整体建出来即一致；
 *     存量表的手工改列不会自动同步索引，需要时人工核对）。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const INIT_SQL = path.join(__dirname, '..', 'sql', 'init.sql');

/**
 * 解析 init.sql 建表语句
 * @returns {{ name: string, body: string, columns: Array<{name:string, def:string, after:string|null}> }[]}
 */
function parseInitSchema(text) {
  const tables = [];
  const re = /CREATE TABLE `([^`]+)`\s*\(([\s\S]*?)\n\)\s*ENGINE[^;]*;/gi;
  let m;
  while ((m = re.exec(text))) {
    const [, name, body] = m;
    const columns = [];
    let prev = null;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,\s*$/, '');
      const cm = /^`([^`]+)`\s+([\s\S]+)$/.exec(line);
      // 约束行（PRIMARY KEY / UNIQUE KEY / KEY / CONSTRAINT）不以反引号列名开头，天然被排除
      if (!cm) continue;
      columns.push({ name: cm[1], def: line, after: prev });
      prev = cm[1];
    }
    tables.push({ name, body, columns });
  }
  return tables;
}

async function loadActualSchema(conn) {
  const [tabs] = await conn.query(
    "SELECT TABLE_NAME n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  );
  const actual = {};
  for (const t of tabs) {
    const [cols] = await conn.query(
      'SELECT COLUMN_NAME n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [t.n]
    );
    actual[t.n] = cols.map((c) => c.n);
  }
  return actual;
}

/** 依据差异生成补齐 DDL */
function buildDdl(tables, actual) {
  const ddl = [];
  for (const t of tables) {
    if (!actual[t.name]) {
      ddl.push(`CREATE TABLE IF NOT EXISTS \`${t.name}\` (\n${t.body}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
      continue;
    }
    for (const c of t.columns) {
      if (actual[t.name].includes(c.name)) continue;
      ddl.push(`ALTER TABLE \`${t.name}\` ADD COLUMN ${c.def}${c.after ? ` AFTER \`${c.after}\`` : ''};`);
    }
  }
  return ddl;
}

async function main() {
  const args = process.argv.slice(2);
  const wantSql = args.includes('--sql');
  const doApply = args.includes('--apply');

  const tables = parseInitSchema(fs.readFileSync(INIT_SQL, 'utf8'));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  try {
    const actual = await loadActualSchema(conn);
    const declaredNames = tables.map((t) => t.name);
    const missingTables = declaredNames.filter((n) => !actual[n]);
    const extraTables = Object.keys(actual).filter((n) => !declaredNames.includes(n)).sort();
    const missingCols = [];
    const extraCols = [];
    for (const t of tables) {
      if (!actual[t.name]) continue;
      for (const c of t.columns) {
        if (!actual[t.name].includes(c.name)) missingCols.push(`${t.name}.${c.name}`);
      }
      for (const c of actual[t.name]) {
        if (!t.columns.some((x) => x.name === c)) extraCols.push(`${t.name}.${c.name}`);
      }
    }

    console.log(`目标库：${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);
    console.log(`init.sql 声明 ${tables.length} 表 / 库内实际 ${Object.keys(actual).length} 表\n`);
    const report = (label, arr) => {
      console.log(`${label}（${arr.length}）`);
      if (arr.length) arr.forEach((x) => console.log('  - ' + x));
    };
    report('缺表 [需 CREATE]', missingTables);
    report('缺列 [需 ADD COLUMN]', missingCols);
    report('库内多余表 [仅提示，不动]', extraTables);
    report('库内多余列 [仅提示，不动]', extraCols);

    const ddl = buildDdl(tables, actual);
    if (wantSql || doApply) {
      console.log('\n===== 补齐 DDL（只加不删）=====');
      console.log(ddl.length ? ddl.join('\n') : '-- 结构已一致，无需变更');
    }
    if (!ddl.length) { console.log('\n✓ 结构已与 init.sql 对齐'); return; }
    if (!doApply) {
      console.log(`\n待执行 ${ddl.length} 条。加 --apply 执行，或 --sql 取 SQL 到目标库手工跑。`);
      return;
    }
    for (const s of ddl) {
      const head = s.split('\n')[0].slice(0, 90);
      try { await conn.query(s); console.log('[schema-sync] ✓ ' + head); }
      catch (e) { console.error('[schema-sync] ✗ 失败: ' + head + '\n  ' + e.message); process.exitCode = 1; return; }
    }
    console.log(`[schema-sync] 完成，共执行 ${ddl.length} 条`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[schema-sync] 失败:', e.message); process.exit(1); });
