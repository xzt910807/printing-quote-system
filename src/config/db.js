const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'printing_quote',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_LIMIT) || 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
  decimalNumbers: true,
});

async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    console.log('[DB] MySQL 连接成功');
  } finally {
    conn.release();
  }
}

module.exports = { pool, testConnection };
