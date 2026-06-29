const { query } = require('../config/database');
const ollamaService = require('../services/ollamaService');
const logger = require('../utils/logger');

const ALLOWED_MODELS = ['qwen3', 'qwen2.5', 'llama3', 'mistral'];

// POST /chat  (streaming)
const sendMessage = async (req, res) => {
  const { chatId, message, model = 'qwen3', systemPrompt } = req.body;
  const user = req.user;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const selectedModel = ALLOWED_MODELS.includes(model) ? model : 'qwen3';

  try {
    // Verify or create chat
    let activeChatId = chatId;
    if (!activeChatId) {
      const chatResult = await query(
        'INSERT INTO chats (user_id, title, model_name) VALUES ($1, $2, $3) RETURNING id',
        [user.id, message.substring(0, 60), selectedModel]
      );
      activeChatId = chatResult.rows[0].id;
    } else {
      const chatCheck = await query(
        'SELECT id FROM chats WHERE id = $1 AND user_id = $2',
        [chatId, user.id]
      );
      if (chatCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Chat not found' });
      }
    }

    // Save user message
    await query(
      'INSERT INTO messages (chat_id, sender, content, model_name) VALUES ($1, $2, $3, $4)',
      [activeChatId, 'user', message, selectedModel]
    );

    // Load conversation history
    const historyResult = await query(
      `SELECT sender, content FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 20`,
      [activeChatId]
    );
    const ollamaMessages = historyResult.rows.map(m => ({
      role: m.sender === 'ai' ? 'assistant' : 'user',
      content: m.content,
    }));

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Chat-Id', activeChatId);
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'chat_id', chatId: activeChatId })}\n\n`);

    let streamError = null;

    await ollamaService.generateStream(
      selectedModel,
      ollamaMessages,
      systemPrompt || null,
      // onChunk
      (chunk) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      },
      // onDone
      async (fullText, tokensUsed) => {
        try {
          // Save AI response
          const msgResult = await query(
            'INSERT INTO messages (chat_id, sender, content, tokens_used, model_name) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [activeChatId, 'ai', fullText, tokensUsed, selectedModel]
          );

          // Update token usage
          await query(
            'UPDATE users SET daily_used_tokens = daily_used_tokens + $1, monthly_used_tokens = monthly_used_tokens + $1 WHERE id = $2',
            [tokensUsed, user.id]
          );

          // Get updated balances
          const balanceResult = await query(
            'SELECT daily_token_limit - daily_used_tokens as daily_remaining, monthly_token_limit - monthly_used_tokens as monthly_remaining FROM users WHERE id = $1',
            [user.id]
          );

          // Log token usage
          const bal = balanceResult.rows[0];
          await query(
            'INSERT INTO token_logs (user_id, tokens_used, remaining_daily, remaining_monthly, model_name, chat_id) VALUES ($1, $2, $3, $4, $5, $6)',
            [user.id, tokensUsed, bal.daily_remaining, bal.monthly_remaining, selectedModel, activeChatId]
          );

          // Log model usage
          await query(
            'INSERT INTO model_usage (model_name, user_id, tokens_used) VALUES ($1, $2, $3)',
            [selectedModel, user.id, tokensUsed]
          );

          // Update chat title if first message
          const msgCount = await query('SELECT COUNT(*) FROM messages WHERE chat_id = $1', [activeChatId]);
          if (parseInt(msgCount.rows[0].count) <= 2) {
            await query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [activeChatId]);
          }

          res.write(`data: ${JSON.stringify({
            type: 'done',
            messageId: msgResult.rows[0].id,
            tokensUsed,
            dailyRemaining: parseInt(bal.daily_remaining),
            monthlyRemaining: parseInt(bal.monthly_remaining),
          })}\n\n`);
          res.end();
        } catch (err) {
          logger.error('Post-stream save error:', err);
          res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to save response' })}\n\n`);
          res.end();
        }
      },
      // onError
      (err) => {
        logger.error('Stream error:', err.message);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'AI model error: ' + err.message })}\n\n`);
        res.end();
      }
    );

  } catch (error) {
    logger.error('sendMessage error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process message' });
    }
  }
};

// GET /chat - list all chats
const listChats = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT c.id, c.title, c.model_name, c.is_pinned, c.created_at, c.updated_at,
              (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
       FROM chats c WHERE c.user_id = $1 ORDER BY c.is_pinned DESC, c.updated_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, parseInt(limit), offset]
    );

    const countResult = await query('SELECT COUNT(*) FROM chats WHERE user_id = $1', [req.user.id]);

    res.json({
      chats: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    logger.error('listChats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
};

// GET /chat/:chatId/messages
const getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const chatCheck = await query('SELECT * FROM chats WHERE id = $1 AND user_id = $2', [chatId, req.user.id]);
    if (chatCheck.rows.length === 0) return res.status(404).json({ error: 'Chat not found' });

    const messages = await query(
      `SELECT id, sender, content, tokens_used, model_name, attachments, created_at
       FROM messages WHERE chat_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [chatId, parseInt(limit), offset]
    );

    const countResult = await query('SELECT COUNT(*) FROM messages WHERE chat_id = $1', [chatId]);

    res.json({
      chat: chatCheck.rows[0],
      messages: messages.rows,
      total: parseInt(countResult.rows[0].count),
    });
  } catch (error) {
    logger.error('getMessages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

// POST /chat/new
const createChat = async (req, res) => {
  try {
    const { title = 'New Chat', model = 'qwen3' } = req.body;
    const result = await query(
      'INSERT INTO chats (user_id, title, model_name) VALUES ($1, $2, $3) RETURNING *',
      [req.user.id, title, model]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    logger.error('createChat error:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
};

// PATCH /chat/:chatId
const updateChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { title, is_pinned } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { fields.push(`title = $${idx++}`); values.push(title); }
    if (is_pinned !== undefined) { fields.push(`is_pinned = $${idx++}`); values.push(is_pinned); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(chatId, req.user.id);
    const result = await query(
      `UPDATE chats SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Chat not found' });
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('updateChat error:', error);
    res.status(500).json({ error: 'Failed to update chat' });
  }
};

// DELETE /chat/:chatId
const deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await query(
      'DELETE FROM chats WHERE id = $1 AND user_id = $2 RETURNING id',
      [chatId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Chat not found' });
    res.json({ message: 'Chat deleted' });
  } catch (error) {
    logger.error('deleteChat error:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
};

// GET /chat/search?q=
const searchChats = async (req, res) => {
  try {
    const { q = '' } = req.query;
    const result = await query(
      `SELECT c.id, c.title, c.model_name, c.updated_at
       FROM chats c WHERE c.user_id = $1 AND (
         c.title ILIKE $2 OR EXISTS (
           SELECT 1 FROM messages m WHERE m.chat_id = c.id AND m.content ILIKE $2
         )
       ) ORDER BY c.updated_at DESC LIMIT 20`,
      [req.user.id, `%${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    logger.error('searchChats error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
};

// GET /chat/token-info
const getTokenInfo = async (req, res) => {
  try {
    const result = await query(
      `SELECT daily_token_limit, monthly_token_limit, daily_used_tokens, monthly_used_tokens, last_token_reset, last_monthly_reset
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    const u = result.rows[0];

    const lastReset = new Date(u.last_token_reset);
    const nextReset = new Date(lastReset.getTime() + 24 * 60 * 60 * 1000);
    const msUntilReset = Math.max(0, nextReset.getTime() - Date.now());
    const hoursUntilReset = Math.floor(msUntilReset / (1000 * 60 * 60));
    const minutesUntilReset = Math.floor((msUntilReset % (1000 * 60 * 60)) / (1000 * 60));

    res.json({
      dailyTokenLimit: u.daily_token_limit,
      monthlyTokenLimit: u.monthly_token_limit,
      dailyUsedTokens: u.daily_used_tokens,
      monthlyUsedTokens: u.monthly_used_tokens,
      dailyRemaining: u.daily_token_limit - u.daily_used_tokens,
      monthlyRemaining: u.monthly_token_limit - u.monthly_used_tokens,
      nextReset: nextReset.toISOString(),
      nextResetIn: `${hoursUntilReset}h ${minutesUntilReset}m`,
    });
  } catch (error) {
    logger.error('getTokenInfo error:', error);
    res.status(500).json({ error: 'Failed to get token info' });
  }
};

module.exports = {
  sendMessage, listChats, getMessages, createChat,
  updateChat, deleteChat, searchChats, getTokenInfo,
};
