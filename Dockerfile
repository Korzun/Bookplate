# Build stage
FROM node:24-alpine AS builder
WORKDIR /app

# Backend deps
COPY package*.json tsconfig.json ./
RUN npm ci

# Client deps
COPY client/package*.json ./client/
RUN npm ci --prefix client

# Backend source
COPY app/ ./app/

# Client source
COPY client/index.html client/vite.config.ts client/tsconfig.json ./client/
COPY client/src/ ./client/src/

# Build everything (build:client then tsc)
RUN npm run build

# Production stage
FROM node:24-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/dist ./client/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3000
CMD ["/run.sh"]
