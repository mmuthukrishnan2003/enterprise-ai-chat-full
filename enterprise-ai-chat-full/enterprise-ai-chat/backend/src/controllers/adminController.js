const { query } = require('../config/database');
const bcrypt = require('bcryptjs');
const ollamaService = require('../services/ollamaService');
const logger = require('../utils/logger');

const logAdminAction = async (action, performedBy, targetUserId = null, details = {}) => {
  try {
    await query(
      'INSERT INTO admin_logs (action, performed_by, target_user_id, details) VALUES ($1, $2, $3, $4)',
      [action, performedBy, targetUserId, JSON.stringify(details)]
    );
  } catch (e) {
    logger.warn('Admin log failed:', e.message);
  }
};

// GET /admin/dashboard
const getDashboard = async (req, res) => {
  try {
    const [totalUsers, activeUsers, totalRequests, tokensToday, modelUsage, recentErrors] = await Promise.all([
      query('SELECT COUNT(*) FROM users WHERE role = $1', ['user']),
      query("SELECT COUNT(*) FROM users WHERE last_login > NOW() - INTERVAL '1 hour'"),
      query('SELECT COUNT(*) FROM messages WHERE sender = $1', ['user']),
      query("SELECT COALESCE(SUM(tokens_used), 0) as total FROM token_logs WHERE created_at > NOW() - INTERVAL '24 hours'"),
      query(`SELECT model_name, COUNT(*) as requests, COALESCE(SUM(tokens_used), 0) as tokens
             FROM model_usage WHERE created_at > NOW() - INTERVAL '7 days'
             GROUP BY model_name ORDER BY requests DESC`),
      query(`SELECT action, details, created_at FROM admin_logs ORDER BY created_at DESC LIMIT 10`),
    ]);

    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      activeUsers: parseInt(activeUsers.rows[0].count),
      totalRequests: parseInt(totalRequests.rows[0].count),
      tokensToday: parseInt(tokensToday.rows[0].total),
      modelUsage: modelUsage.rows,
      recentActivity: recentErrors.rows,
    });
  } catch (error) {
    logger.error('getDashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
};

// GET /admin/users
const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (page - 1) * limit;
    const searchParam = `%${search}%`;

    const result = await query(
      `SELECT id, username, email, role, is_active, is_suspended,
              daily_token_limit, monthly_token_limit, daily_used_tokens, monthly_used_tokens,
              created_at, last_login
       FROM users WHERE (username ILIKE $1 OR email ILIKE $1) AND role != 'admin'
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [searchParam, parseInt(limit), offset]
    );
    const count = await query(
      "SELECT COUNT(*) FROM users WHERE (username ILIKE $1 OR email ILIKE $1) AND role != 'admin'",
      [searchParam]
    );

    res.json({ users: result.rows, total: parseInt(count.rows[0].count) });
  } catch (error) {
    logger.error('getUsers error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// POST /admin/users
const createUser = async (req, res) => {
  try {
    const { username, email, password, role = 'user', dailyTokenLimit, monthlyTokenLimit } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (username, email, password_hash, role, daily_token_limit, monthly_token_limit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, role`,
      [username, email || null, hash, role, dailyTokenLimit || 10000, monthlyTokenLimit || 300000]
    );

    await logAdminAction('CREATE_USER', req.user.id, result.rows[0].id, { username });
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Username already exists' });
    logger.error('createUser error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
};

// PATCH /admin/users/:userId
const updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { is_active, is_suspended, role, daily_token_limit, monthly_token_limit, email } = req.body;

    const fields = [], values = [];
    let idx = 1;
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }
    if (is_suspended !== undefined) { fields.push(`is_suspended = $${idx++}`); values.push(is_suspended); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
    if (daily_token_limit !== undefined) { fields.push(`daily_token_limit = $${idx++}`); values.push(daily_token_limit); }
    if (monthly_token_limit !== undefined) { fields.push(`monthly_token_limit = $${idx++}`); values.push(monthly_token_limit); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    values.push(userId);

    const result = await query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    await logAdminAction('UPDATE_USER', req.user.id, userId, req.body);
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('updateUser error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
};

// DELETE /admin/users/:userId
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await query('DELETE FROM users WHERE id = $1 AND role != $2 RETURNING username', [userId, 'admin']);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    await logAdminAction('DELETE_USER', req.user.id, null, { deletedUsername: result.rows[0].username });
    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('deleteUser error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

// POST /admin/users/:userId/reset-password
const resetPassword = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be 6+ chars' });

    const hash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    await logAdminAction('RESET_PASSWORD', req.user.id, userId);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    logger.error('resetPassword error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
};

// POST /admin/users/:userId/reset-tokens
const resetUserTokens = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type = 'daily' } = req.body;

    if (type === 'daily') {
      await query('UPDATE users SET daily_used_tokens = 0, last_token_reset = NOW() WHERE id = $1', [userId]);
    } else if (type === 'monthly') {
      await query('UPDATE users SET monthly_used_tokens = 0, last_monthly_reset = NOW() WHERE id = $1', [userId]);
    } else {
      await query('UPDATE users SET daily_used_tokens = 0, monthly_used_tokens = 0, last_token_reset = NOW(), last_monthly_reset = NOW() WHERE id = $1', [userId]);
    }

    await logAdminAction('RESET_TOKENS', req.user.id, userId, { type });
    res.json({ message: 'Tokens reset successfully' });
  } catch (error) {
    logger.error('resetUserTokens error:', error);
    res.status(500).json({ error: 'Failed to reset tokens' });
  }
};

// GET /admin/users/:userId/login-history
const getUserLoginHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await query(
      'SELECT ip_address, user_agent, success, created_at FROM login_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch login history' });
  }
};

// GET /admin/models
const getModels = async (req, res) => {
  try {
    const [dbModels, ollamaModels] = await Promise.all([
      query('SELECT * FROM models_config ORDER BY model_name'),
      ollamaService.listModels(),
    ]);

    const ollamaNames = ollamaModels.map(m => m.name.split(':')[0]);
    const models = dbModels.rows.map(m => ({
      ...m,
      is_available: ollamaNames.includes(m.model_name),
    }));

    res.json(models);
  } catch (error) {
    logger.error('getModels error:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
};

// POST /admin/models/:modelName/pull
const pullModel = async (req, res) => {
  try {
    const { modelName } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ status: 'pulling', model: modelName })}\n\n`);
    try {
      await ollamaService.pullModel(modelName);
      await query('UPDATE models_config SET is_available = true WHERE model_name = $1', [modelName]);
      await logAdminAction('PULL_MODEL', req.user.id, null, { modelName });
      res.write(`data: ${JSON.stringify({ status: 'done', model: modelName })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ status: 'error', error: err.message })}\n\n`);
    }
    res.end();
  } catch (error) {
    res.status(500).json({ error: 'Failed to pull model' });
  }
};

// PATCH /admin/models/:modelName
const updateModel = async (req, res) => {
  try {
    const { modelName } = req.params;
    const { is_enabled } = req.body;
    await query('UPDATE models_config SET is_enabled = $1, updated_at = NOW() WHERE model_name = $2', [is_enabled, modelName]);
    await logAdminAction('UPDATE_MODEL', req.user.id, null, { modelName, is_enabled });
    res.json({ message: 'Model updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update model' });
  }
};

// GET /admin/analytics
const getAnalytics = async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const [dailyUsage, topUsers, modelDist, requestsPerHour] = await Promise.all([
      query(`SELECT DATE(created_at) as date, SUM(tokens_used) as tokens, COUNT(*) as requests
             FROM token_logs WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
             GROUP BY DATE(created_at) ORDER BY date`),
      query(`SELECT u.username, SUM(tl.tokens_used) as total_tokens, COUNT(tl.id) as requests
             FROM token_logs tl JOIN users u ON u.id = tl.user_id
             WHERE tl.created_at > NOW() - INTERVAL '${parseInt(days)} days'
             GROUP BY u.username ORDER BY total_tokens DESC LIMIT 10`),
      query(`SELECT model_name, COUNT(*) as count FROM model_usage
             WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'
             GROUP BY model_name`),
      query(`SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as requests
             FROM messages WHERE sender = 'user' AND created_at > NOW() - INTERVAL '1 day'
             GROUP BY hour ORDER BY hour`),
    ]);

    res.json({
      dailyUsage: dailyUsage.rows,
      topUsers: topUsers.rows,
      modelDistribution: modelDist.rows,
      requestsPerHour: requestsPerHour.rows,
    });
  } catch (error) {
    logger.error('getAnalytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

// GET /admin/logs
const getAdminLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const result = await query(
      `SELECT al.*, u.username as performed_by_username, tu.username as target_username
       FROM admin_logs al
       LEFT JOIN users u ON u.id = al.performed_by
       LEFT JOIN users tu ON tu.id = al.target_user_id
       ORDER BY al.created_at DESC LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    );
    const count = await query('SELECT COUNT(*) FROM admin_logs');
    res.json({ logs: result.rows, total: parseInt(count.rows[0].count) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
};

module.exports = {
  getDashboard, getUsers, createUser, updateUser, deleteUser,
  resetPassword, resetUserTokens, getUserLoginHistory,
  getModels, pullModel, updateModel, getAnalytics, getAdminLogs,
};
