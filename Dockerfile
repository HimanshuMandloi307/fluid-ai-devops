# ---- Stage 1: Build ----
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files first (layer caching optimization)
COPY package*.json ./

# Install only production dependencies
RUN npm install --only=production

# ---- Stage 2: Runtime ----
FROM node:18-alpine AS runtime

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only the installed deps and app code from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=appuser:appgroup . .

# Switch to non-root
USER appuser

EXPOSE 3000

# Health check built into image
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "index.js"]
