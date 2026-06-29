# NexusAI – Enterprise Chat Platform
## Complete Deployment Guide

---

## 📁 Project Structure

```
enterprise-ai-chat/
├── backend/                    # Node.js + Express API
│   ├── src/
│   │   ├── config/
│   │   │   └── database.js         # PostgreSQL connection pool
│   │   ├── controllers/
│   │   │   ├── authController.js   # Login, signup, refresh, logout
│   │   │   ├── chatController.js   # Chat, messages, streaming
│   │   │   └── adminController.js  # Admin dashboard, users, models
│   │   ├── middleware/
│   │   │   └── auth.js             # JWT verify, role check, token quota
│   │   ├── routes/
│   │   │   └── index.js            # All API routes
│   │   ├── services/
│   │   │   └── ollamaService.js    # Ollama LLM integration
│   │   ├── utils/
│   │   │   ├── logger.js           # Winston logger
│   │   │   ├── cronJobs.js         # Token reset, cleanup jobs
│   │   │   └── migrate.js          # DB migration runner
│   │   └── index.js                # Express server entry point
│   ├── .env                        # Environment variables
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                   # Angular 17 SPA
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── auth/login/     # Login page
│   │   │   │   ├── chat/chat/      # Main chat UI
│   │   │   │   └── admin/admin/    # Admin dashboard
│   │   │   ├── services/
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── chat.service.ts
│   │   │   ├── guards/auth.guard.ts
│   │   │   ├── interceptors/auth.interceptor.ts
│   │   │   ├── models/index.ts
│   │   │   ├── app.module.ts
│   │   │   └── app.component.ts
│   │   ├── environments/
│   │   ├── styles.scss
│   │   └── index.html
│   ├── angular.json
│   ├── proxy.conf.json
│   ├── Dockerfile
│   └── package.json
│
├── database/
│   └── schema.sql              # PostgreSQL schema + seed
│
├── nginx/
│   ├── nexusai.conf            # Production Nginx (bare metal)
│   └── nginx-docker.conf       # Docker Nginx
│
└── docker/
    └── docker-compose.yml
```

---

## 🚀 Quick Start (Development)

### Prerequisites
- Node.js 20+
- PostgreSQL running at 172.16.0.112
- Ollama installed and running
- npm / npx

---

### Step 1 – Database Setup

```bash
# Connect to your PostgreSQL and create the DB if needed
psql -h 172.16.0.112 -U postgre -c "CREATE DATABASE \"chat-3\";"

# Run schema migration
cd enterprise-ai-chat/backend
npm install
npm run migrate
```

---

### Step 2 – Backend Setup

```bash
cd enterprise-ai-chat/backend

# Install dependencies
npm install

# Configure environment (edit .env if needed)
# DB is pre-configured for your PostgreSQL

# Start development server
npm run dev

# Backend runs on http://localhost:3000
# Test: curl http://localhost:3000/api/health
```

**Default admin credentials:**
- Username: `admin`
- Password: `Admin@123`

---

### Step 3 – Ollama Setup

```bash
# Install Ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service
ollama serve &

# Pull the AI models (run any you want)
ollama pull qwen3
ollama pull qwen2.5
ollama pull llama3
ollama pull mistral

# Verify
ollama list
```

---

### Step 4 – Frontend Setup

```bash
cd enterprise-ai-chat/frontend

# Install Angular CLI globally
npm install -g @angular/cli@17

# Install dependencies
npm install

# Start dev server with proxy
ng serve --configuration development

# Frontend runs on http://localhost:4200
```

---

## 🐳 Docker Deployment

```bash
cd enterprise-ai-chat/docker

# Set secrets in environment
export JWT_SECRET="your-super-secret-min-32-chars-here"
export REFRESH_TOKEN_SECRET="your-refresh-secret-here"

# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f backend

# Pull models into Ollama container
docker exec nexusai-ollama ollama pull qwen3

# Run migration
docker exec nexusai-backend node src/utils/migrate.js
```

**Services after docker-compose:**
| Service    | URL                       |
|------------|---------------------------|
| Frontend   | http://localhost           |
| Backend    | http://localhost/api       |
| Ollama     | http://localhost:11434     |
| PostgreSQL | localhost:5432             |
| Redis      | localhost:6379             |

---

## 🌐 Production (Bare Metal with Nginx)

```bash
# 1. Install Nginx
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

# 2. Build Angular for production
cd frontend
npm run build
# Output: dist/enterprise-ai-chat/browser/

# 3. Deploy frontend
sudo mkdir -p /var/www/nexusai/frontend
sudo cp -r dist/enterprise-ai-chat /var/www/nexusai/frontend/

# 4. Deploy backend
sudo mkdir -p /var/www/nexusai/backend
sudo cp -r ../backend /var/www/nexusai/
cd /var/www/nexusai/backend && npm ci --only=production

# 5. Setup Nginx
sudo cp ../nginx/nexusai.conf /etc/nginx/sites-available/nexusai
sudo ln -sf /etc/nginx/sites-available/nexusai /etc/nginx/sites-enabled/
# Edit yourdomain.com in the config first!
sudo nginx -t && sudo systemctl reload nginx

# 6. SSL certificate
sudo certbot --nginx -d yourdomain.com

# 7. Run backend with PM2
npm install -g pm2
cd /var/www/nexusai/backend
pm2 start src/index.js --name nexusai-backend
pm2 save
pm2 startup
```

---

## 🔑 API Reference

### Auth Endpoints
| Method | Endpoint              | Description                    |
|--------|-----------------------|--------------------------------|
| POST   | /api/auth/login       | Login (auto-creates if new)    |
| POST   | /api/auth/signup      | Explicit signup                |
| POST   | /api/auth/refresh-token | Refresh access token         |
| POST   | /api/auth/logout      | Logout and revoke token        |
| GET    | /api/auth/me          | Get current user info          |

### Chat Endpoints
| Method | Endpoint                      | Description              |
|--------|-------------------------------|--------------------------|
| GET    | /api/chat                     | List all chats           |
| POST   | /api/chat/new                 | Create new chat          |
| POST   | /api/chat                     | Send message (SSE stream)|
| GET    | /api/chat/:id/messages        | Get chat messages        |
| PATCH  | /api/chat/:id                 | Rename / pin chat        |
| DELETE | /api/chat/:id                 | Delete chat              |
| GET    | /api/chat/search?q=           | Search chats             |
| GET    | /api/chat/token-info          | Get token balance        |
| POST   | /api/upload                   | Upload file              |
| GET    | /api/models                   | List enabled models      |

### Admin Endpoints (require admin role)
| Method | Endpoint                              | Description              |
|--------|---------------------------------------|--------------------------|
| GET    | /api/admin/dashboard                  | Dashboard stats          |
| GET    | /api/admin/users                      | List users               |
| POST   | /api/admin/users                      | Create user              |
| PATCH  | /api/admin/users/:id                  | Update user              |
| DELETE | /api/admin/users/:id                  | Delete user              |
| POST   | /api/admin/users/:id/reset-password   | Reset password           |
| POST   | /api/admin/users/:id/reset-tokens     | Reset token quota        |
| GET    | /api/admin/models                     | List all models          |
| POST   | /api/admin/models/:name/pull          | Pull model from Ollama   |
| PATCH  | /api/admin/models/:name               | Enable/disable model     |
| GET    | /api/admin/analytics                  | Usage analytics          |
| GET    | /api/admin/logs                       | Admin audit logs         |

---

## ⚙️ Environment Variables

Edit `backend/.env`:

```env
# Server
PORT=3000
NODE_ENV=production

# Database (your PostgreSQL)
DB_HOST=172.16.0.112
DB_PORT=5432
DB_USER=postgre
DB_PASSWORD=demo
DB_NAME=chat-3

# JWT (CHANGE THESE IN PRODUCTION!)
JWT_SECRET=your-super-secret-min-32-chars
JWT_EXPIRES_IN=1h
REFRESH_TOKEN_SECRET=your-refresh-secret
REFRESH_TOKEN_EXPIRES_IN=7d

# Ollama
OLLAMA_BASE_URL=http://localhost:11434

# Token defaults
DEFAULT_DAILY_TOKEN_LIMIT=10000
DEFAULT_MONTHLY_TOKEN_LIMIT=300000

# Rate limiting
RATE_LIMIT_MAX_REQUESTS=200
```

---

## 🔐 Security Checklist

- [ ] Change JWT_SECRET and REFRESH_TOKEN_SECRET before production
- [ ] Change default admin password immediately after first login
- [ ] Enable HTTPS with Let's Encrypt
- [ ] Set DB_SSL=true if PostgreSQL has SSL
- [ ] Configure CORS FRONTEND_URL to your actual domain
- [ ] Keep Ollama on localhost (not exposed externally)
- [ ] Enable Redis for rate limiting persistence
- [ ] Set up log rotation for backend logs
- [ ] Configure firewall to block direct port 3000 access

---

## 🧩 Features Summary

### User Features
- ✅ Auto signup / login on first visit
- ✅ JWT auth with refresh tokens
- ✅ Stays logged in after browser refresh
- ✅ ChatGPT-like UI with sidebar, search
- ✅ Real-time streaming AI responses (SSE)
- ✅ Markdown + code block rendering
- ✅ Rename, delete, pin chats
- ✅ File upload (image, PDF, DOCX, audio, video)
- ✅ Model selector (Qwen3, Qwen2.5, Llama3, Mistral)
- ✅ Token usage display with countdown
- ✅ Light / dark mode toggle
- ✅ Mobile responsive layout

### Admin Features
- ✅ Dashboard with live stats
- ✅ User management (create, suspend, delete)
- ✅ Token quota management per user
- ✅ Password reset
- ✅ Model enable/disable/pull
- ✅ Usage analytics (7-day, top users, model distribution)
- ✅ Audit log of all admin actions

---

## 🛟 Troubleshooting

**Backend can't connect to DB:**
```bash
psql -h 172.16.0.112 -U postgre -d "chat-3"   # test connection
# Check firewall: sudo ufw allow from <server-ip> to any port 5432
```

**Ollama not responding:**
```bash
curl http://localhost:11434/api/tags    # should return model list
systemctl status ollama
journalctl -u ollama -f
```

**Angular build fails:**
```bash
node --version   # must be 18+
npm cache clean --force
rm -rf node_modules && npm install
```

**Streaming not working through Nginx:**
```
Ensure proxy_buffering off; in Nginx config for /api/ location
Check chunked_transfer_encoding on;
```
