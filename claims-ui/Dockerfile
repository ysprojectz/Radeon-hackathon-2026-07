# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
# Use --force to handle cross-platform lockfile differences (Mac ARM vs Linux x64)
RUN npm install --force

# ─── Stage 2: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Disable Google Fonts network fetch during Docker build (fonts served from CDN at runtime)
ENV NEXT_FONT_GOOGLE_DISABLED=1
# Allow API URL to be passed at build time (deploy/radeon/docker-compose.yml
# overrides this to http://localhost:8080 for the local demo stack)
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build

# Strip sourceMappingURL references and delete .map files from the production build
# so browser DevTools cannot reconstruct original source code
RUN find .next -name '*.js' -exec sed -i 's|//# sourceMappingURL=.*||g' {} + 2>/dev/null; \
    find .next -name '*.map' -delete 2>/dev/null; \
    true

# ─── Stage 3: Production runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/landing', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

CMD ["node", "server.js"]
