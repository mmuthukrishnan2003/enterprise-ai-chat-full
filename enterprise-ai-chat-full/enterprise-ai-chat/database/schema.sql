-- ============================================================
-- Enterprise AI Chat Platform - PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_active BOOLEAN DEFAULT TRUE,
    is_suspended BOOLEAN DEFAULT FALSE,
    daily_token_limit INTEGER DEFAULT 10000,
    monthly_token_limit INTEGER DEFAULT 300000,
    daily_used_tokens INTEGER DEFAULT 0,
    monthly_used_tokens INTEGER DEFAULT 0,
    last_token_reset TIMESTAMP DEFAULT NOW(),
    last_monthly_reset TIMESTAMP DEFAULT NOW(),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP
);

-- REFRESH TOKENS TABLE
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- CHATS TABLE
CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) DEFAULT 'New Chat',
    model_name VARCHAR(50) DEFAULT 'qwen3',
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- MESSAGES TABLE
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender VARCHAR(10) NOT NULL CHECK (sender IN ('user', 'ai')),
    content TEXT NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    model_name VARCHAR(50),
    attachments JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- TOKEN LOGS TABLE
CREATE TABLE IF NOT EXISTS token_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tokens_used INTEGER NOT NULL,
    remaining_daily INTEGER NOT NULL,
    remaining_monthly INTEGER NOT NULL,
    model_name VARCHAR(50),
    chat_id UUID REFERENCES chats(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ADMIN LOGS TABLE
CREATE TABLE IF NOT EXISTS admin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(255) NOT NULL,
    performed_by UUID REFERENCES users(id),
    target_user_id UUID REFERENCES users(id),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- LOGIN HISTORY TABLE
CREATE TABLE IF NOT EXISTS login_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    success BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- MODEL USAGE TABLE
CREATE TABLE IF NOT EXISTS model_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id),
    tokens_used INTEGER DEFAULT 0,
    request_count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW()
);

-- MODELS CONFIG TABLE
CREATE TABLE IF NOT EXISTS models_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    is_enabled BOOLEAN DEFAULT TRUE,
    is_available BOOLEAN DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert default models
INSERT INTO models_config (model_name, display_name, description) VALUES
    ('qwen3', 'Qwen 3', 'Alibaba Qwen 3 - Fast and capable'),
    ('qwen2.5', 'Qwen 2.5', 'Alibaba Qwen 2.5 - Balanced performance'),
    ('llama3', 'Llama 3', 'Meta Llama 3 - Open source powerhouse'),
    ('mistral', 'Mistral', 'Mistral AI - Efficient and accurate')
ON CONFLICT (model_name) DO NOTHING;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_user_id ON token_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_token_logs_created_at ON token_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_model_usage_model_name ON model_usage(model_name);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);

-- Default admin user (password: Admin@123)
INSERT INTO users (username, email, password_hash, role, daily_token_limit, monthly_token_limit)
VALUES (
    'admin',
    'admin@company.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewRqo0oVqgTQHpuC',
    'admin',
    999999,
    9999999
) ON CONFLICT (username) DO NOTHING;

-- Update function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chats_updated_at BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_models_config_updated_at BEFORE UPDATE ON models_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
