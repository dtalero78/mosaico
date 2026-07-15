# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Force cache invalidation - rebuild 2024-10-24
ENV CACHE_BUST=2024-10-24

# Copy package files
COPY package*.json ./

# Install dependencies (production only for smaller image)
RUN npm ci --only=production && \
    cp -R node_modules prod_node_modules && \
    npm ci && \
    find node_modules -name "test" -type d -exec rm -rf {} + || true && \
    find node_modules -name "tests" -type d -exec rm -rf {} + || true && \
    find node_modules -name "example" -type d -exec rm -rf {} + || true && \
    find node_modules -name "examples" -type d -exec rm -rf {} + || true && \
    find node_modules -name "*.test.*" -type f -delete || true && \
    find node_modules -name "*.spec.*" -type f -delete || true && \
    find prod_node_modules -name "test" -type d -exec rm -rf {} + || true && \
    find prod_node_modules -name "tests" -type d -exec rm -rf {} + || true && \
    find prod_node_modules -name "example" -type d -exec rm -rf {} + || true && \
    find prod_node_modules -name "examples" -type d -exec rm -rf {} + || true && \
    find prod_node_modules -name "*.test.*" -type f -delete || true && \
    find prod_node_modules -name "*.spec.*" -type f -delete || true

# Copy source code
COPY . .

# Build the application with increased memory limit
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Chromium para la generación de PDFs (puppeteer-core).
# Se instala el de Alpine a propósito: el Chromium que descarga `puppeteer` está
# compilado contra glibc y NO corre sobre musl. Por eso la dependencia es
# puppeteer-CORE (no descarga navegador) y se le apunta el ejecutable del sistema.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set environment to production
ENV NODE_ENV production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Copy production dependencies
COPY --from=builder --chown=nextjs:nodejs /app/prod_node_modules ./node_modules

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Copy scripts/ so the cron-worker component (separate DO worker) can run
# scripts/cron-worker.js — el run_command del worker en el app spec apunta
# a este archivo. La imagen es la misma que la del servicio web; sólo cambia
# el comando de arranque entre componentes.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# Switch to non-root user
USER nextjs

# Expose port (matches package.json start script)
EXPOSE 3001

# Set port environment variable
ENV PORT 3001
ENV HOSTNAME "0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})" || exit 1

# Start the application
CMD ["node", "server.js"]