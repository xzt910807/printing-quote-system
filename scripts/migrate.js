/**
 * 数据库迁移管理工具（P1 防环境漂移）：schema_migrations 版本表 + 按序执行 + 校验和登记
 * 背景：此前发版靠人肉记住 sql/migrations/*.sql 执行到哪（ops.md 手动循环），
 *       漏跑/重复跑/环境漂移全凭运气；本工具把「执行过哪些」落库，启动自检也随之成为可能。
 *
 * 用法：
 *   node scripts/migrate.js status      # 列出全部迁移与执行状态（供运维诊断页展示）
 *   node scripts/migrate.js bootstrap   # 【一次性】老库建版本表并把现存迁移全部标记已执行（不跑 SQL）
 *   node scripts/migrate.js apply       # 按文件名升序执行未登记的迁移并记录校验和
 *
 * 约定（与既有迁移脚本一致）：
 *   - 所有迁移必须幂等（CREATE TABLE IF NOT EXISTS / INSERT IGNORE / 加列前先判存在等），
 *     apply 重跑安全；修改已执行的迁移文件属大忌，改前请三思（本工具仅告警不阻断）。
 *   - 文件内的 USE 语句会被忽略，连接库以 .env DB_NAME 为准（多环境共库名不同时防串库）。
 * 作为模块被 src/app.js 启动自检 require：pendingMigrations()。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'sql', 'migrations');

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(128) PRIMARY KEY COMMENT '迁移文件名',
  checksum CHAR(40) NOT NULL COMMENT '文件内容 sha1',
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '登记时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已执行迁移登记（scripts/migrate.js 维护）'`;

function listFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /\.sql$/i.test(f)).sort();
}

function checksumOf(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/**
 * SQL 文件 → 语句数组：跳过 -- 行注释与块注释，按分号切分，
 * 字符串字面量（单/双引号、反引号标识符）内的分号不切。
 * 注：现有迁移均为幂等 DDL/DML 且无存储过程；若未来引入 DELIMITER 场景需另行处理。
 */
function splitSqlStatements(text) {
  const stmts = [];
  let cur = '';
  let quote = null; // 当前字符串/标识符引号 ' " `
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote !== '`') { cur += text[i + 1] || ''; i += 2; continue; }
      if (ch === quote) {
        // SQL 双写转义（'' "" ``）不算结束
        if (next === quote) { cur += next; i += 2; continue; }
        quote = null;
      }
      i++; continue;
    }
    if (ch === '-' && next === '-') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; i++; continue; }
    if (ch === ';') {
      const s = cur.trim();
      if (s) stmts.push(s);
      cur = ''; i++; continue;
    }
    cur += ch; i++;
  }
  const tail = cur.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

async function connect() {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'printing_quote',
    multipleStatements: false,
  });
}

/** 读已登记的迁移；版本表不存在返回 null（尚未初始化） */
async function loadApplied(conn) {
  try {
    const [rows] = await conn.query('SELECT filename, checksum FROM schema_migrations');
    const map = {};
    for (const r of rows) map[r.filename] = r.checksum;
    return map;
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }
}

/** 全量状态：[{file, applied, checksumMatch}]，按文件名升序 */
async function status() {
  const conn = await connect();
  try {
    const applied = await loadApplied(conn);
    return listFiles().map((f) => {
      if (applied === null) return { file: f, applied: false, checksumMatch: null, unregistered: true };
      const rec = applied[f];
      const match = rec ? checksumOf(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')) === rec : null;
      return { file: f, applied: !!rec, checksumMatch: match };
    });
  } finally {
    conn.end();
  }
}

/** 未登记执行的迁移文件名（版本表缺失时返回 []——老库未 bootstrap 不产噪音） */
async function pendingMigrations() {
  try {
    const st = await status();
    return st.filter((x) => !x.applied).map((x) => x.file);
  } catch (e) {
    console.warn('[migrate] 自检失败（不影响启动）:', e.message);
    return [];
  }
}

async function bootstrap() {
  const conn = await connect();
  try {
    await conn.query(CREATE_TABLE_SQL);
    const files = listFiles();
    let marked = 0;
    for (const f of files) {
      const sum = checksumOf(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
      await conn.query(
        `INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum)`,
        [f, sum]
      );
      marked++;
    }
    console.log('[migrate] bootstrap 完成：版本表就绪，' + marked + ' 个现存迁移已标记为已执行（未跑 SQL）');
  } finally {
    conn.end();
  }
}

async function apply() {
  const conn = await connect();
  try {
    let applied = await loadApplied(conn);
    if (applied === null) {
      await conn.query(CREATE_TABLE_SQL);
      applied = {};
      console.log('[migrate] schema_migrations 表已创建');
    }
    const files = listFiles();
    let ran = 0;
    for (const f of files) {
      const text = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const sum = checksumOf(text);
      if (applied[f]) {
        if (applied[f] !== sum) console.warn('[migrate] ⚠️ ' + f + ' 已执行但文件内容有变更（校验和不一致），跳过执行；请人工确认差异');
        continue;
      }
      const stmts = splitSqlStatements(text).filter((s) => !/^USE\s/i.test(s));
      console.log('[migrate] 执行 ' + f + '（' + stmts.length + ' 条语句）...');
      try {
        for (const s of stmts) await conn.query(s);
      } catch (e) {
        console.error('[migrate] ✗ ' + f + ' 执行失败: ' + e.message);
        console.error('  失败语句: ' + s.slice(0, 200));
        process.exitCode = 1;
        return;
      }
      await conn.query(
        `INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE checksum = VALUES(checksum)`,
        [f, sum]
      );
      ran++;
    }
    console.log('[migrate] apply 完成：执行 ' + ran + ' 个迁移，库内共登记 ' + files.length + ' 个');
  } finally {
    conn.end();
  }
}

// ===== CLI =====
if (require.main === module) {
  const cmd = process.argv[2] || 'status';
  const run = async () => {
    if (cmd === 'bootstrap') return bootstrap();
    if (cmd === 'apply') return apply();
    const st = await status();
    const unreg = st.some((x) => x.unregistered);
    if (unreg) console.log('（schema_migrations 尚未初始化：先执行 node scripts/migrate.js bootstrap 登记老库）\n');
    for (const x of st) {
      const mark = x.unregistered ? '·' : (x.applied ? (x.checksumMatch === false ? '!' : '✓') : '✗');
      console.log(mark + ' ' + x.file
        + (x.applied ? (x.checksumMatch === false ? '  [文件已改动，与登记校验和不符]' : '') : '  [未执行]'));
    }
    const pend = st.filter((x) => !x.applied && !x.unregistered).length;
    console.log('\n合计 ' + st.length + ' 个迁移，未执行 ' + pend + ' 个' + (pend ? '：node scripts/migrate.js apply' : ''));
  };
  run().catch((e) => { console.error('[migrate] 失败:', e.message); process.exit(1); });
}

module.exports = { status, pendingMigrations, bootstrap, apply, splitSqlStatements, checksumOf, listFiles, MIGRATIONS_DIR };
