#!/usr/bin/env node
/**
 * 种子数据执行器：node scripts/seed-run.js <sql文件路径>
 * 以 multipleStatements 连接执行整个 SQL 文件，并打印末尾核对结果。
 * 示例：node scripts/seed-run.js sql/seed-yinchacha.sql
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('用法: node scripts/seed-run.js <sql文件>'); process.exit(1); }
  const sql = fs.readFileSync(path.resolve(file), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'printing_quote',
    charset: 'utf8mb4',
    timezone: '+08:00',
    multipleStatements: true,
  });
  try {
    const [rows] = await conn.query(sql);
    console.log('[seed] 执行成功:', file);
    // multipleStatements 下最后一个 SELECT 的结果在末元素
    const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
    if (Array.isArray(last)) console.table(last);
  } finally {
    await conn.end();
  }
})().catch((e) => { console.error('[seed] 失败:', e.message); process.exit(1); });
