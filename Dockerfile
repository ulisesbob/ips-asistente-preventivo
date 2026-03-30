# ─── Stage 1: Build ──────────────────────────────────────────────
FROM node:20-alpine AS builder

# Build tools for bcrypt native addon
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy workspace config first (cache deps layer)
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY tsconfig.base.json ./

# Install ALL deps (including devDependencies for build)
# No --ignore-scripts: bcrypt needs post-install compilation
RUN npm ci

# Copy source code
COPY packages/db/ packages/db/
COPY apps/api/ apps/api/

# Generate Prisma client + build in single layer
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma && \
    npm run build -w @ips/db && \
    npm run build -w @ips/api

# ─── Stage 2: Production ────────────────────────────────────────
FROM node:20-alpine AS production

# Build tools for bcrypt + dumb-init for PID 1 signal handling
RUN apk add --no-cache dumb-init python3 make g++ && \
    addgroup -g 1001 -S ips && \
    adduser -S ips -u 1001

WORKDIR /app

# Copy workspace config (no tsconfig — not needed at runtime)
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/

# Install production deps only (no --ignore-scripts for bcrypt)
RUN npm ci --omit=dev

# Remove build tools after bcrypt compilation to reduce image size
RUN apk del python3 make g++

# Copy Prisma schema + migrations (needed for migrate deploy)
COPY packages/db/prisma/ packages/db/prisma/

# Copy Prisma client + CLI from builder (avoid re-generating in production)
COPY --from=builder /app/node_modules/.prisma/ node_modules/.prisma/
COPY --from=builder /app/node_modules/@prisma/client/ node_modules/@prisma/client/
COPY --from=builder /app/node_modules/prisma/ node_modules/prisma/
COPY --from=builder /app/node_modules/.bin/prisma node_modules/.bin/prisma

# Copy built artifacts from builder
COPY --from=builder /app/packages/db/dist/ packages/db/dist/
COPY --from=builder /app/apps/api/dist/ apps/api/dist/

# Copy production start script
COPY scripts/start-api.sh ./scripts/start-api.sh
RUN chmod +x ./scripts/start-api.sh

# Metadata
LABEL org.opencontainers.image.title="IPS Asistente Preventivo API" \
      org.opencontainers.image.description="API Express para gestión de pacientes crónicos del IPS" \
      security.scan="trivy"

# Set ownership of entire app to non-root user
RUN chown -R ips:ips /app

# Security: switch to non-root user
USER ips

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["./scripts/start-api.sh"]
