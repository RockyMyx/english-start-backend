ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma.config.ts tsconfig.json vitest.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY tools ./tools
COPY images ./images

# Prisma only needs a syntactically valid URL while generating the client.
RUN DATABASE_URL=postgresql://unused:unused@localhost:5432/unused npm ci \
  && npm run typecheck \
  && npm test \
  && npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV AVATAR_STORAGE_PATH=/app/storage/avatars

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
