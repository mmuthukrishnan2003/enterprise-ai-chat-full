const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const chatController = require('../controllers/chatController');
const adminController = require('../controllers/adminController');
const { authenticate, requireAdmin, checkTokenQuota } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Upload config
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|docx|mp3|mp4|wav|ogg/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  },
});

// ─── AUTH ───────────────────────────────────────────────────────────────────
router.post('/auth/login', authController.login);
router.post('/auth/signup', authController.signup);
router.post('/auth/refresh-token', authController.refreshToken);
router.post('/auth/logout', authController.logout);
router.get('/auth/me', authenticate, authController.me);

// ─── CHAT ───────────────────────────────────────────────────────────────────
router.get('/chat', authenticate, chatController.listChats);
router.get('/chat/search', authenticate, chatController.searchChats);
router.get('/chat/token-info', authenticate, chatController.getTokenInfo);
router.post('/chat/new', authenticate, chatController.createChat);
router.post('/chat', authenticate, checkTokenQuota, chatController.sendMessage);
router.get('/chat/:chatId/messages', authenticate, chatController.getMessages);
router.patch('/chat/:chatId', authenticate, chatController.updateChat);
router.delete('/chat/:chatId', authenticate, chatController.deleteChat);

// File upload
router.post('/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    url: `/uploads/${req.file.filename}`,
  });
});

// ─── MODELS (public list) ───────────────────────────────────────────────────
router.get('/models', authenticate, async (req, res) => {
  try {
    const { query } = require('../config/database');
    const result = await query('SELECT model_name, display_name, description, is_enabled FROM models_config WHERE is_enabled = true');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// ─── ADMIN ──────────────────────────────────────────────────────────────────
router.get('/admin/dashboard', authenticate, requireAdmin, adminController.getDashboard);
router.get('/admin/analytics', authenticate, requireAdmin, adminController.getAnalytics);
router.get('/admin/logs', authenticate, requireAdmin, adminController.getAdminLogs);

router.get('/admin/users', authenticate, requireAdmin, adminController.getUsers);
router.post('/admin/users', authenticate, requireAdmin, adminController.createUser);
router.patch('/admin/users/:userId', authenticate, requireAdmin, adminController.updateUser);
router.delete('/admin/users/:userId', authenticate, requireAdmin, adminController.deleteUser);
router.post('/admin/users/:userId/reset-password', authenticate, requireAdmin, adminController.resetPassword);
router.post('/admin/users/:userId/reset-tokens', authenticate, requireAdmin, adminController.resetUserTokens);
router.get('/admin/users/:userId/login-history', authenticate, requireAdmin, adminController.getUserLoginHistory);

router.get('/admin/models', authenticate, requireAdmin, adminController.getModels);
router.post('/admin/models/:modelName/pull', authenticate, requireAdmin, adminController.pullModel);
router.patch('/admin/models/:modelName', authenticate, requireAdmin, adminController.updateModel);

// Health check
router.get('/health', async (req, res) => {
  const ollamaOk = await require('../services/ollamaService').checkHealth();
  res.json({ status: 'ok', ollama: ollamaOk ? 'connected' : 'unreachable', timestamp: new Date().toISOString() });
});

module.exports = router;
