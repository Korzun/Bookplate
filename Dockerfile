# Build stage
FROM node:24-alpine AS builder
WORKDIR /app

# Install all workspace deps
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci

# Backend source
COPY server/ ./server/

# Client source
COPY client/index.html client/vite.config.ts client/tsconfig.json ./client/
COPY client/src/ ./client/src/

# Build everything
RUN npm run build

# Production stage
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3000
CMD ["/run.sh"]
