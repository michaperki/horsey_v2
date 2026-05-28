## Builder stage: install dependencies, including the native build toolchain
## needed for better-sqlite3.
FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

## Runtime stage: minimal image with the prebuilt node_modules and source.
FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV HORSEY_DB_PATH=/data/horsey.db
ENV HORSEY_TRUST_PROXY=1
ENV STOCKFISH_PATH=/usr/games/stockfish

## Stockfish for offline game analysis (ADR 0008). Server-side execution as a
## hosted service; we do not redistribute the binary to clients.
RUN apt-get update \
  && apt-get install -y --no-install-recommends stockfish \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

EXPOSE 8787

CMD ["node", "apps/api/server.mjs"]
