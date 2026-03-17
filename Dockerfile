# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

# Install OpenSSL (needed by Prisma)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and Prisma schema
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# Generate Prisma client + build NestJS
RUN pnpm exec prisma generate && pnpm run build

# Prune to production dependencies (keeps Prisma generated client intact)
RUN pnpm prune --prod

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

# Install runtime dependencies: OpenSSL (Prisma), poppler (PDF conversion), dumb-init
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends openssl poppler-utils dumb-init && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r mps && useradd -r -g mps -m mps

# Copy pruned node_modules (with generated Prisma client) and built app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Copy Prisma schema + migrations (needed for prisma migrate deploy)
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY package.json ./

# Create uploads directory
RUN mkdir -p uploads && chown -R mps:mps /app

USER mps

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
