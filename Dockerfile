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

COPY --from=builder /app /app

EXPOSE 8787

CMD ["node", "apps/api/server.mjs"]
