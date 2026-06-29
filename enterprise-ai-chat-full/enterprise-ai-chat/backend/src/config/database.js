const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || '172.16.0.112',
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgre',
  password: process.env.DB_PASSWORD || 'demo',
  database: process.env.DB_NAME || 'chat-3',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  logger.info('PostgreSQL pool connected');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL pool error:', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('DB query executed', { text: text.substring(0, 80), duration, rows: res.rowCount });
    return res;
  } catch (error) {
    logger.error('DB query error:', { text: text.substring(0, 80), error: error.message });
    throw error;
  }
};

const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
