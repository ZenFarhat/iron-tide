# Iron Tide — production image.
# Build:  docker build -t iron-tide .
# Run:    docker run --rm -p 3000:3000 iron-tide   → http://localhost:3000

# ---- deps: install runtime dependencies only (currently none; kept for future packages) ----
FROM oven/bun:1.4.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# ---- runtime ----
FROM oven/bun:1.4.3-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock tsconfig.json ./
COPY --chown=bun:bun server ./server
COPY --chown=bun:bun shared ./shared
COPY --chown=bun:bun sim ./sim
COPY --chown=bun:bun client ./client

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The client is bundled in-memory by Bun at startup (HTML imports), so no separate build step.
CMD ["bun", "server/index.ts"]
