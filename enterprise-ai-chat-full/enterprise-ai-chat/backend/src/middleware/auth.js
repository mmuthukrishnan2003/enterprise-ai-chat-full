const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await query(
      'SELECT id, username, email, role, is_active, is_suspended, daily_token_limit, monthly_token_limit, daily_used_tokens, monthly_used_tokens, last_token_reset FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
    if (user.is_suspended) return res.status(403).json({ error: 'Account suspended' });

    req.user = user;
    next();
  } catch (error) {
    logger.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const checkTokenQuota = async (req, res, next) => {
  try {
    const user = req.user;

    // Reset daily tokens if 24h have passed
    const lastReset = new Date(user.last_token_reset);
    const hoursSinceReset = (Date.now() - lastReset.getTime()) / (1000 * 60 * 60);

    if (hoursSinceReset >= 24) {
      await query(
        'UPDATE users SET daily_used_tokens = 0, last_token_reset = NOW() WHERE id = $1',
        [user.id]
      );
      user.daily_used_tokens = 0;
    }

    // Reset monthly tokens if month has passed
    const lastMonthly = new Date(user.last_monthly_reset);
    const daysSinceMonthly = (Date.now() - lastMonthly.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceMonthly >= 30) {
      await query(
        'UPDATE users SET monthly_used_tokens = 0, last_monthly_reset = NOW() WHERE id = $1',
        [user.id]
      );
      user.monthly_used_tokens = 0;
    }

    const dailyRemaining = user.daily_token_limit - user.daily_used_tokens;
    const monthlyRemaining = user.monthly_token_limit - user.monthly_used_tokens;

    if (dailyRemaining <= 0) {
      const resetTime = new Date(lastReset.getTime() + 24 * 60 * 60 * 1000);
      return res.status(429).json({
        error: 'Daily token limit exceeded',
        code: 'DAILY_LIMIT_EXCEEDED',
        retry_after: '24 hours',
        reset_at: resetTime.toISOString(),
      });
    }

    if (monthlyRemaining <= 0) {
      return res.status(429).json({
        error: 'Monthly token limit exceeded',
        code: 'MONTHLY_LIMIT_EXCEEDED',
        retry_after: '30 days',
      });
    }

    req.tokenInfo = {
      dailyRemaining,
      monthlyRemaining,
      lastReset: user.last_token_reset,
    };

    next();
  } catch (error) {
    logger.error('Token quota check error:', error);
    res.status(500).json({ error: 'Token quota check failed' });
  }
};

module.exports = { authenticate, requireAdmin, checkTokenQuota };
