const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

const logLoginAttempt = async (userId, req, success) => {
  try {
    await query(
      'INSERT INTO login_history (user_id, ip_address, user_agent, success) VALUES ($1, $2, $3, $4)',
      [userId, req.ip, req.headers['user-agent'], success]
    );
  } catch (e) {
    logger.warn('Failed to log login attempt:', e.message);
  }
};

// POST /auth/login  - also auto-signup if user doesn't exist
const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);

    // Auto-signup if user doesn't exist
    if (result.rows.length === 0) {
      return signup(req, res);
    }

    const user = result.rows[0];

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await logLoginAttempt(user.id, req, false);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.is_suspended) return res.status(403).json({ error: 'Account suspended' });
    if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    await logLoginAttempt(user.id, req, true);

    logger.info(`User logged in: ${user.username}`);

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        dailyTokenLimit: user.daily_token_limit,
        monthlyTokenLimit: user.monthly_token_limit,
        dailyUsedTokens: user.daily_used_tokens,
        monthlyUsedTokens: user.monthly_used_tokens,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
};

// POST /auth/signup
const signup = async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newUser = await query(
      `INSERT INTO users (username, email, password_hash, daily_token_limit, monthly_token_limit)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        username,
        email || null,
        passwordHash,
        parseInt(process.env.DEFAULT_DAILY_TOKEN_LIMIT) || 10000,
        parseInt(process.env.DEFAULT_MONTHLY_TOKEN_LIMIT) || 300000,
      ]
    );

    const user = newUser.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.id, user.role);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    logger.info(`New user created: ${username}`);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        dailyTokenLimit: user.daily_token_limit,
        monthlyTokenLimit: user.monthly_token_limit,
        dailyUsedTokens: 0,
        monthlyUsedTokens: 0,
      },
    });
  } catch (error) {
    logger.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
};

// POST /auth/refresh-token
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json({ error: 'Refresh token required' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const stored = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (stored.rows.length === 0) {
      return res.status(401).json({ error: 'Refresh token expired or not found' });
    }

    const userResult = await query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const user = userResult.rows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user.id, user.role);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, newRefreshToken, expiresAt]
    );

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
};

// POST /auth/logout
const logout = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (token) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
};

// GET /auth/me
const me = async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, email, role, daily_token_limit, monthly_token_limit,
              daily_used_tokens, monthly_used_tokens, last_token_reset, last_monthly_reset, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const u = result.rows[0];
    res.json({
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      dailyTokenLimit: u.daily_token_limit,
      monthlyTokenLimit: u.monthly_token_limit,
      dailyUsedTokens: u.daily_used_tokens,
      monthlyUsedTokens: u.monthly_used_tokens,
      lastTokenReset: u.last_token_reset,
      lastMonthlyReset: u.last_monthly_reset,
      createdAt: u.created_at,
    });
  } catch (error) {
    logger.error('Me error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
};

module.exports = { login, signup, refreshToken, logout, me };
