# syntax=docker/dockerfile:1

# ---------- Dependencies ----------
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# bcrypt menyediakan prebuild glibc x64/arm64, jadi biasanya tanpa kompilasi.
# Fallback compile diaktifkan agar aman di platform lain.
RUN npm ci --omit=dev --no-audit --no-fund \
 || (npm ci --omit=dev --no-audit --no-fund --build-from-source)

# ---------- Runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=5000 \
    TZ=Asia/Jakarta \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# wget dipakai HEALTHCHECK
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates wget \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public

# Folder upload milik user non-root agar bisa ditulis saat fallback lokal.
RUN mkdir -p /app/public/uploads /app/logs && chown -R node:node /app
USER node

EXPOSE 5000
VOLUME ["/app/public/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "src/index.js"]
