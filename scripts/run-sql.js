/**
 * 通用 SQL 文件执行器（无 mysql 命令行的环境用，如 Windows 本地开发）
 * 语句切分复用 scripts/migrate.js 的实现（跳过 -- 注释与块注释、字符串内分号不切）。
 *
 * 用法：
 *   node scripts/run-sql.js sql/purge-biz-data.sql
 *   node scripts/run-sql.js sql/init.sql --allow-db-ddl   # 文件含建库/删库语句时才用
 *
 * 说明：连接库以 .env DB_NAME 为准，文件内的 USE 语句会被忽略（与 migrate.js 同口径）。
 *       ⚠️ 正因为忽略 USE，文件里的 DROP/CREATE DATABASE 会作用在「当前连接库」而非文件名指向的库，
 *          所以默认拒绝执行库级 DDL；确需执行时用 --allow-db-ddl，且语句指向的库名必须等于 DB_NAME。
 *       SELECT 语句的结果集会打印出来，便于核对（如清理脚本末尾的行数校验）。
 */
const DB_DDL_RE = /^\s*(DROP|CREATE|ALTER)\s+DATABASE\b/i;

/** 取库级 DDL 语句操作的目标库名 */
function dbDdlTarget(stmt) {
  const m = stmt.match(/^\s*(?:DROP|CREATE|ALTER)\s+DATABASE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?`?([\w$-]+)`?/i);
  return m ? m[1] : null;
}

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { splitSqlStatements } = require('./migrate');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法：node scripts/run-sql.js <sql文件路径>');
    process.exit(1);
  }
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) { console.error('文件不存在：' + abs); process.exit(1); }

  const argv = process.argv.slice(3);
  const allowDbDdl = argv.includes('--allow-db-ddl');
  const all = splitSqlStatements(fs.readFileSync(abs, 'utf8'));
  const stmts = all.filter((s) => !/^USE\s/i.test(s));

  // 库级 DDL 护栏：本工具忽略 USE，故 DROP/CREATE DATABASE 会打在连接默认库上，极易误伤
  const dbDdl = all.filter((s) => DB_DDL_RE.test(s));
  if (dbDdl.length) {
    console.log(`⚠️ 文件含 ${dbDdl.length} 条库级 DDL：` + dbDdl.map((s) => s.replace(/\s+/g, ' ').slice(0, 48)).join(' | '));
    if (!allowDbDdl) {
      console.error('\n已中止。这些语句不会随 USE 切换目标库（USE 被忽略），误用会删掉 DB_NAME 指向的库。\n'
        + `若确认要让它们作用在当前库 ${process.env.DB_NAME} 上，追加 --allow-db-ddl 重试。`);
      process.exit(1);
    }
    const bad = dbDdl.map(dbDdlTarget).filter((n) => n && n !== process.env.DB_NAME);
    if (bad.length) {
      console.error(`\n已中止：库级 DDL 指向 ${bad.join(' / ')}，与 DB_NAME=${process.env.DB_NAME} 不一致。`);
      process.exit(1);
    }
  }

  // 建库场景（带 --allow-db-ddl 且文件自带 USE）：必须保留 USE，并且不在连接时预绑库，
  // 否则 DROP DATABASE 后连接默认库失效，后续建表报 No database selected
  const keepUse = allowDbDdl && all.some((s) => /^USE\s/i.test(s));
  const finalStmts = keepUse ? all : stmts;

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: keepUse ? undefined : process.env.DB_NAME,
    multipleStatements: false,
  });
  console.log(`执行 ${path.relative(process.cwd(), abs)} → ${keepUse ? '跟随文件内 USE' : process.env.DB_NAME}@${process.env.DB_HOST}（${finalStmts.length} 条语句）`);

  try {
    for (const s of finalStmts) {
      const head = s.replace(/\s+/g, ' ').slice(0, 72);
      try {
        const [rows] = await conn.query(s);
        console.log('✓ ' + head + (Array.isArray(rows) && rows.length ? '' : ''));
        // SELECT 结果集打印（最多 40 行，超出省略）
        if (Array.isArray(rows) && rows.length && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
          rows.slice(0, 40).forEach((r) => console.log('    ' + JSON.stringify(r)));
          if (rows.length > 40) console.log(`    …共 ${rows.length} 行，已省略 ${rows.length - 40} 行`);
        }
      } catch (e) {
        console.error('✗ 失败: ' + head + '\n  ' + e.message);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`\n全部 ${finalStmts.length} 条执行完成`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[run-sql] 失败:', e.message); process.exit(1); });
