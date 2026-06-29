const axios = require('axios');
const logger = require('../utils/logger');

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT) || 120000;

const FALLBACK_MODEL = 'qwen3';

const ollamaClient = axios.create({
  baseURL: OLLAMA_BASE,
  timeout: TIMEOUT,
});

// Check if Ollama is running
const checkHealth = async () => {
  try {
    await ollamaClient.get('/');
    return true;
  } catch {
    return false;
  }
};

// List local models
const listModels = async () => {
  try {
    const res = await ollamaClient.get('/api/tags');
    return res.data.models || [];
  } catch (error) {
    logger.error('Ollama listModels error:', error.message);
    return [];
  }
};

// Check if model is available locally
const isModelAvailable = async (modelName) => {
  const models = await listModels();
  return models.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
};

// Pull a model if missing
const pullModel = async (modelName) => {
  try {
    logger.info(`Pulling model: ${modelName}`);
    const res = await ollamaClient.post('/api/pull', { name: modelName }, {
      timeout: 600000, // 10 min for large models
    });
    logger.info(`Model pulled: ${modelName}`);
    return res.data;
  } catch (error) {
    logger.error(`Failed to pull model ${modelName}:`, error.message);
    throw error;
  }
};

// Generate chat completion (streaming)
const generateStream = async (model, messages, systemPrompt, onChunk, onDone, onError) => {
  try {
    const available = await isModelAvailable(model);
    if (!available) {
      logger.warn(`Model ${model} not available, attempting to pull...`);
      try {
        await pullModel(model);
      } catch {
        logger.warn(`Pull failed, falling back to ${FALLBACK_MODEL}`);
        model = FALLBACK_MODEL;
      }
    }

    const payload = {
      model,
      messages: systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : messages,
      stream: true,
      options: {
        temperature: 0.7,
        top_p: 0.9,
      },
    };

    const response = await ollamaClient.post('/api/chat', payload, {
      responseType: 'stream',
    });

    let fullText = '';
    let totalTokens = 0;

    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullText += json.message.content;
            onChunk(json.message.content);
          }
          if (json.done && json.eval_count) {
            totalTokens = json.eval_count + (json.prompt_eval_count || 0);
          }
        } catch {}
      }
    });

    response.data.on('end', () => {
      onDone(fullText, totalTokens || Math.ceil(fullText.length / 4));
    });

    response.data.on('error', (err) => {
      logger.error('Ollama stream error:', err.message);
      onError(err);
    });

  } catch (error) {
    logger.error('Ollama generateStream error:', error.message);
    onError(error);
  }
};

// Non-streaming generation
const generate = async (model, messages, systemPrompt) => {
  try {
    const payload = {
      model,
      messages: systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : messages,
      stream: false,
    };

    const response = await ollamaClient.post('/api/chat', payload);
    const data = response.data;
    const tokens = (data.eval_count || 0) + (data.prompt_eval_count || 0);

    return {
      content: data.message?.content || '',
      tokens: tokens || Math.ceil((data.message?.content || '').length / 4),
      model,
    };
  } catch (error) {
    logger.error('Ollama generate error:', error.message);
    throw error;
  }
};

// Delete a model
const deleteModel = async (modelName) => {
  const res = await ollamaClient.delete('/api/delete', { data: { name: modelName } });
  return res.data;
};

module.exports = {
  checkHealth,
  listModels,
  isModelAvailable,
  pullModel,
  generateStream,
  generate,
  deleteModel,
};
