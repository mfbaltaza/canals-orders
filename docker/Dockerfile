FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS build
# Prisma's migration engine needs OpenSSL, which the slim image lacks
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma/schema.prisma prisma/
RUN npm ci
COPY . .
RUN npm run build
USER node

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=build /app/generated generated
COPY package.json ./
COPY src src
USER node
EXPOSE 3000
CMD ["node", "src/index.ts"]
