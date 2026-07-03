# syntax=docker/dockerfile:1

# ---- build the web UI ----
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY shared ./shared
COPY remotion ./remotion
COPY web ./web
RUN npm run build:web

# ---- production node_modules ----
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ----
# Full bookworm (not slim): Remotion's chrome-headless-shell needs the
# shared libs below, and we want system ffmpeg/ffprobe for compositing.
FROM node:20-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        fonts-liberation \
        libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY remotion ./remotion
COPY server ./server
COPY --from=build /app/web/dist ./web/dist

# Pre-bake Remotion's chrome-headless-shell (downloads into node_modules/.remotion)
RUN npx remotion browser ensure

EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
