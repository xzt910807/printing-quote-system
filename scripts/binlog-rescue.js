/**
 * binlog 镜像抢救：从 binary log 的行事件里还原指定表的最终行，生成可重放的 REPLACE INTO
 *
 * 背景：ROW 格式 + binlog_row_image=FULL 时，每个 Write_rows/Update_rows/Delete_rows 事件都带整行前后镜像。
 *       按 binlog 顺序重放到内存字典（主键 → 行），字典终态即该表在 binlog 末刻的内容。
 *       仅能覆盖现存 binlog 范围内被写过的行；更早且此后未变更的行不在其中。
 *
 * 用法：
 *   node scripts/binlog-rescue.js                       # 只解析并生成 data/rescue-<ts>.sql
 *   node scripts/binlog-rescue.js --apply               # 生成后立即写回当前库
 *   node scripts/binlog-rescue.js --tables=a,b          # 自定义目标表
 *   node scripts/binlog-rescue.js --dir=data/binlog-rescue
 *
 * 注意：默认读 data/binlog-rescue 下的副本（不动服务器原文件），按文件名升序解析。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const mysql = require('mysql2/promise');

// init.sql 里预置了种子的参考表不在此列——它们已由 init.sql 恢复到最新态，重放会二次叠加
const DEFAULT_TABLES = ['admin_user', 'factory_user', 'c_end_user', 'customer', 'factory_invite_code', 'biz_seq'];

function argVal(name) {
  const hit = process.argv.slice(2).find((s) => s.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : null;
}

/** mysqlbinlog 不在 PATH 时回退到 Windows 默认安装位置 */
function resolveMysqlbinlog() {
  if (process.env.MYSQLBINLOG && fs.existsSync(process.env.MYSQLBINLOG)) return process.env.MYSQLBINLOG;
  const guess = [
    process.env.MYSQLBINLOG,
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqlbinlog.exe',
    'D:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqlbinlog.exe',
  ].filter(Boolean);
  return guess.find((p) => fs.existsSync(p)) || null;
}

/** 解析 mysqlbinlog -v 输出，返回 { table: [ {seq, kind, pkVals, cols} ] } 的事件流 */
function parseEvents(text) {
  const events = [];
  let cur = null; // { table, kind, section, vals }
  const flush = () => {
    if (cur && Object.keys(cur.vals).length) events.push(cur);
    cur = null;
  };
  for (const raw of text.split('\n')) {
    const ln = raw.replace(/\r$/, '');
    let m;
    if ((m = ln.match(/^###\s+(INSERT INTO|UPDATE|DELETE FROM)\s+`?[\w$-]+`?\.`?(\w+)`?/i))) {
      flush();
      const k = m[1].toUpperCase();
      cur = {
        table: m[2],
        kind: k === 'INSERT INTO' ? 'I' : k[0] === 'U' ? 'U' : 'D', // I / U / D
        section: null,
        where: {},
        set: {},
        vals: {},
      };
      continue;
    }
    if (!cur) continue;
    if (/^###\s+(WHERE|SET)\s*$/i.test(ln)) {
      cur.section = /^###\s+WHERE/i.test(ln) ? 'where' : 'set';
      cur.vals = cur[cur.section];
      continue;
    }
    if ((m = ln.match(/^###\s+@(\d+)=(.*)$/))) {
      if (!cur.section) continue;
      const rest = m[2];
      // 尾部注释形如 /* DATETIME(0) meta=0 nullable=1 is_null=1 */，用于判定真正的 NULL
      const cm = rest.match(/\/\*\s*([\w()]+).*?is_null=(\d)/);
      const lit = cm ? rest.slice(0, rest.indexOf('/*')).trim() : rest.trim();
      cur.vals[Number(m[1])] = { lit, type: cm ? cm[1] : '', isNull: cm ? cm[2] === '1' : lit === 'NULL' };
      continue;
    }
    if (/^#(at|\d)/.test(ln) || ln.startsWith('#')) { flush(); }
  }
  flush();
  return events;
}

/** 按列类型把 binlog 字面量转成可执行 SQL；TIMESTAMP/DATETIME 在 binlog 里是 Unix 秒 */
function toSql(meta, pos, v) {
  if (!v || v.isNull || v.lit === 'NULL') return 'NULL';
  const colType = (meta.types[pos - 1] || '').toLowerCase();
  const isTime = /^(timestamp|datetime)/.test(colType);
  if (isTime && /^\d+$/.test(v.lit)) {
    return Number(v.lit) === 0 ? 'NULL' : `FROM_UNIXTIME(${v.lit})`;
  }
  if (isTime && !v.lit.startsWith("'")) return `'${v.lit}'`;
  return v.lit;
}

/** 表的 主键列名 / ordinal→列名 / ordinal→列类型 映射 */
async function tableMeta(conn, table) {
  const [cols] = await conn.query(
    'SELECT COLUMN_NAME n, DATA_TYPE d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [table]
  );
  if (!cols.length) return null;
  const [pk] = await conn.query(
    'SELECT COLUMN_NAME n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX',
    [table, 'PRIMARY']
  );
  return { colByPos: cols.map((c) => c.n), types: cols.map((c) => c.d), pkCols: pk.map((c) => c.n) };
}

async function main() {
  const doApply = process.argv.slice(2).includes('--apply');
  const tables = (argVal('tables') || DEFAULT_TABLES.join(',')).split(',').filter(Boolean);
  const dir = path.resolve(process.cwd(), argVal('dir') || path.join('data', 'binlog-rescue'));
  if (!fs.existsSync(dir)) { console.error('binlog 目录不存在：' + dir); process.exit(1); }
  const files = fs.readdirSync(dir).filter((f) => /^.+-bin\.\d{6}$/.test(f)).sort();
  if (!files.length) { console.error('目录下没有 binlog 文件'); process.exit(1); }
  console.log(`binlog 目录：${dir}\n文件（按序）：${files.join(', ')}`);

  const BIN_EXE = resolveMysqlbinlog();
  if (!BIN_EXE) {
    console.error('未找到 mysqlbinlog，请在 .env 配 MYSQLBINLOG=<完整路径>');
    process.exit(1);
  }
  let all = '';
  for (const f of files) {
    try {
      all += execFileSync(BIN_EXE,
        ['--base64-output=DECODE-ROWS', '-v', '--database=' + process.env.DB_NAME, '--force-read', path.join(dir, f)],
        { maxBuffer: 1024 * 1024 * 192, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch (e) { console.warn(`⚠️ 解析失败 ${f}: ${String(e.message).slice(0, 100)}`); }
  }
  const events = parseEvents(all).filter((ev) => tables.includes(ev.table));
  console.log(`命中事件：${events.length}（目标表 ${tables.join(', ')}）`);

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  try {
    // 按 binlog 顺序重放到字典：主键 → 最后一次镜像
    const dicts = {};
    const skipped = {};
    for (const ev of events) {
      if (!(ev.table in dicts)) {
        const meta = await tableMeta(conn, ev.table);
        dicts[ev.table] = meta ? { meta, rows: new Map() } : null;
        if (!meta) { skipped[ev.table] = 0; continue; }
      }
      const dict = dicts[ev.table];
      if (!dict) { skipped[ev.table]++; continue; }
      const keyOf = (vals) => dict.meta.pkCols
        .map((c) => (vals[dict.meta.colByPos.indexOf(c) + 1] || {}).lit)
        .join('|');
      if (ev.kind === 'D') { dict.rows.delete(keyOf(ev.where)); continue; }
      if (!Object.keys(ev.set).length) continue;
      dict.rows.set(keyOf(ev.set), ev.set);
    }

    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const out = path.join(__dirname, '..', 'data', `rescue-${ts}.sql`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let head = `-- binlog 镜像抢救 ${process.env.DB_NAME} ${new Date().toISOString()}\n`
      + `-- 来源：${path.relative(process.cwd(), dir)}（${files.length} 个文件）\n`
      + `-- 恢复：node scripts/run-sql.js ${path.relative(path.join(__dirname, '..'), out)}\n`
      + 'SET NAMES utf8mb4;\n\n';
    let totalRows = 0;
    const sqls = [];
    for (const t of tables) {
      const d = dicts[t];
      if (!d || !d.rows.size) { console.log(`  ${t.padEnd(24)} 0 行（binlog 范围内无可还原内容）`); continue; }
      const names = d.meta.colByPos;
      let stmts = '';
      for (const vals of d.rows.values()) {
        const cols = []; const vs = [];
        names.forEach((n, i) => {
          const v = vals[i + 1];
          if (!v) return;
          cols.push('`' + n + '`'); vs.push(toSql(d.meta, i + 1, v));
        });
        if (!cols.length) continue;
        stmts += `REPLACE INTO \`${t}\` (${cols.join(',')}) VALUES (${vs.join(',')});\n`;
      }
      const cnt = (stmts.match(/REPLACE INTO/g) || []).length;
      totalRows += cnt;
      console.log(`  ${t.padEnd(24)} ${String(cnt).padStart(4)} 行`);
      head += `-- ===== ${t}: ${cnt} 行 =====\n` + stmts + '\n';
      sqls.push({ t, cnt, stmts });
    }
    if (Object.keys(skipped).length) console.log('⚠️ 当前库缺表，已跳过：', skipped);
    fs.writeFileSync(out, head);
    console.log(`\n✓ 已生成：${path.relative(process.cwd(), out)}（合计 ${totalRows} 行）`);

    if (!doApply) { console.log('确认内容后写回：node scripts/binlog-rescue.js --apply'); return; }
    let done = 0;
    for (const g of sqls) {
      for (const line of g.stmts.split('\n')) {
        if (!/^REPLACE/.test(line)) continue;
        await conn.query(line.replace(/;$/, ''));
        done++;
      }
      console.log(`[写回] ${g.t} 累计 ${done} 行`);
    }
    console.log(`\n✓ 已写回 ${done} 行`);
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[binlog-rescue] 失败:', e.message); process.exit(1); });
