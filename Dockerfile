# Build stage
FROM node:24-alpine AS builder
WORKDIR /hass-odps

# Install all workspace deps
COPY package*.json ./
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
RUN npm ci

# Backend source
COPY app/server/ ./app/server/

# Client source
COPY app/client/index.html app/client/vite.config.ts app/client/tsconfig.json ./app/client/
COPY app/client/src/ ./app/client/src/

# Build everything
RUN npm run build

# Production stage
FROM node:24-alpine
WORKDIR /hass-odps

COPY package*.json ./
COPY app/server/package*.json ./app/server/
COPY app/client/package*.json ./app/client/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /hass-odps/app/server/dist ./app/server/dist
COPY --from=builder /hass-odps/app/client/dist ./app/client/dist

COPY run.sh /run.sh
RUN chmod +x /run.sh

EXPOSE 3000
CMD ["/run.sh"]
