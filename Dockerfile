# Multi-stage build for the JoharHaat API.
#
# Stage 1 installs everything and compiles; stage 2 ships only production
# dependencies and the compiled output. The Prisma client is generated in the
# builder and copied across, because `src/generated/prisma` is gitignored and
# therefore never present in the build context.
#
# Node 22 to match `engines` in package.json.

# ----------------------------------------------------------------- builder --
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

# Dependencies first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
# `prisma generate` reads the datasource URL from prisma.config.ts but never
# connects, so a placeholder keeps the image build free of secrets.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DIRECT_URL=postgresql://build:build@localhost:5432/build
RUN pnpm prisma:generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Drop dev dependencies before they are copied into the runtime image.
RUN pnpm prune --prod

# ----------------------------------------------------------------- runtime --
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# tini reaps zombies and forwards SIGTERM, so the container actually stops
# when the platform asks it to rather than being killed after a grace period.
RUN apk add --no-cache tini

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY package.json ./

# Run unprivileged. The base image already ships a `node` user.
USER node

EXPOSE 4000

# The app exposes /api/v1/health/ready, which checks the database. Platforms
# that read HEALTHCHECK get it for free; others should point their probe here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
