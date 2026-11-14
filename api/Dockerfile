# Build da API (TypeScript + Prisma) para produção.
FROM node:24-slim AS build

WORKDIR /app

# prisma generate (postinstall) roda sem banco; a URL só precisa existir.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

COPY package.json package-lock.json prisma.config.ts ./
COPY src/prisma ./src/prisma
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# node_modules inclui o Prisma CLI, usado no start para aplicar as migrations.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/src/prisma ./src/prisma

EXPOSE 3333

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
