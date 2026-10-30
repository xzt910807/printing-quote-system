/**
 * 业务流水数据清理（带自动备份），配套 sql/purge-biz-data.sql
 * 只清业务流水表；账号表（admin_user/factory_user/c_end_user）、客户与工厂档案、
 * init.sql 预置的参考种子表、biz_seq 单号计数器一律不动。
 *
 * 用法：
 *   node scripts/purge-biz-data.js             # 试运行：只列出将被清空的表与行数
 *   node scripts/purge-biz-data.js --apply     # 先把目标表导出到 data/purge-backup-*.sql，再执行清理
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { splitSqlStatements } = require('./migrate');

// 与 sql/purge-biz-data.sql 中的 TRUNCATE 清单保持一致
const TARGETS = [
  'c_inquiry', 'c_inquiry_quote_view', 'factory_inquiry_push', 'inquiry_message',
  'quote_order', 'order_main', 'order_logistics', 'platform_fee_ledger', 'daily_stats',
  'c_message', 'user_session', 'factory_operation_log', 'factory_media', 'user_address',
  // Batch D4 社区：内容与互动/举报（版块种子不清，见 KEEP_HINT）
  'community_post', 'community_comment', 'community_like', 'community_favorite', 'community_report',
];
const KEEP_HINT = [
  'admin_user', 'factory_user', 'c_end_user', 'customer', 'factory_invite_code',
  'factory', 'factory_capability', 'factory_price_override', 'product_config',
  'design_template', 'biz_seq', 'schema_migrations', 'community_category',
];

async function main() {
  const doApply = process.argv.slice(2).includes('--apply');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  try {
    console.log(`目标库：${process.env.DB_NAME}@${process.env.DB_HOST}:${process.env.DB_PORT}`);
    console.log(`模式：${doApply ? '★ 执行清理（先备份）' : '试运行（不做任何变更）'}\n`);

    // 表存在性 + 行数
    const counts = {};
    for (const t of TARGETS) {
      try {
        const [[r]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
        counts[t] = r.c;
      } catch (e) {
        counts[t] = -1;
        console.warn(`⚠️ 表不存在或不可读：${t}（${e.message}）`);
      }
    }
    let total = 0;
    console.log('将清空的表：');
    TARGETS.forEach((t) => {
      if (counts[t] < 0) return;
      total += counts[t];
      console.log(`  ${t.padEnd(26)} ${String(counts[t]).padStart(6)} 行`);
    });
    console.log(`\n合计 ${total} 行业务数据`);

    console.log('\n保留不动（删了会锁死后台/丢配置）：');
    for (const t of KEEP_HINT) {
      try {
        const [[r]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
        console.log(`  ${t.padEnd(26)} ${String(r.c).padStart(6)} 行`);
      } catch (e) { /* 表不存在则跳过 */ }
    }

    if (!doApply) {
      console.log('\n确认无误后执行：node scripts/purge-biz-data.js --apply');
      return;
    }

    // 1) 备份目标表（结构 + 数据）到 data/purge-backup-<ts>.sql
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const bakDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(bakDir, { recursive: true });
    const bakFile = path.join(bakDir, `purge-backup-${ts}.sql`);
    let out = `-- 清理前备份：${process.env.DB_NAME}@${process.env.DB_HOST} ${new Date().toISOString()}\n`
      + '-- 恢复：node scripts/run-sql.js ' + path.relative(path.join(__dirname, '..'), bakFile) + '\n'
      + 'SET FOREIGN_KEY_CHECKS = 0;\n\n';
    for (const t of TARGETS) {
      if (!counts[t]) continue; // 空表不必备份
      const [[row]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      out += `DROP TABLE IF EXISTS \`${t}\`;\n${row['Create Table']};\n\n`;
      const [cols] = await conn.query(
        'SELECT COLUMN_NAME n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [t]
      );
      const colNames = cols.map((c) => c.n);
      const [rows] = await conn.query(`SELECT * FROM \`${t}\``);
      for (const r of rows) {
        const vals = colNames.map((c) => conn.escape(r[c]));
        out += `INSERT INTO \`${t}\` (${colNames.map((c) => '`' + c + '`').join(',')}) VALUES (${vals.join(',')});\n`;
      }
      out += `\n-- ${t}: ${rows.length} 行\n\n`;
      console.log(`[备份] ${t} → ${rows.length} 行`);
    }
    out += 'SET FOREIGN_KEY_CHECKS = 1;\n';
    fs.writeFileSync(bakFile, out);
    console.log(`\n✓ 备份完成：${path.relative(path.join(__dirname, '..'), bakFile)}（${fs.statSync(bakFile).size} 字节）`);

    // 2) 执行清理 SQL
    const sqlFile = path.join(__dirname, '..', 'sql', 'purge-biz-data.sql');
    const stmts = splitSqlStatements(fs.readFileSync(sqlFile, 'utf8'))
      .filter((s) => /^TRUNCATE/i.test(s) || /^SET/i.test(s));
    for (const s of stmts) {
      await conn.query(s);
      if (/^TRUNCATE/i.test(s)) console.log('[清理] ' + s.replace(/\s+/g, ' '));
    }

    // 3) 核对
    console.log('\n清理后核对：');
    let left = 0;
    for (const t of TARGETS) {
      if (counts[t] < 0) continue;
      const [[r]] = await conn.query(`SELECT COUNT(*) c FROM \`${t}\``);
      left += r.c;
      console.log(`  ${t.padEnd(26)} ${String(r.c).padStart(6)} 行${r.c === 0 ? ' ✓' : ' ✗ 未清空!'}`);
    }
    console.log(left === 0 ? '\n✓ 业务流水已全部清空，账号与参考数据完好' : '\n⚠️ 仍有残留，请检查');
  } finally {
    await conn.end();
  }
}

main().catch((e) => { console.error('[purge] 失败:', e.message); process.exit(1); });
