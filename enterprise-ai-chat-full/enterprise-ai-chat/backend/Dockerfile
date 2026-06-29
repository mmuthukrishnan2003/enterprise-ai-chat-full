# Backend Dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source
COPY . .

# Create required directories
RUN mkdir -p uploads logs

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nexusai -u 1001 && \
    chown -R nexusai:nodejs /app

USER nexusai

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "src/index.js"]
