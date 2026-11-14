FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
# DATABASE_URL fictícia só para o `prisma generate` do postinstall carregar o config.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules completo: o CLI do Prisma (devDependency) é usado para aplicar as migrations.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

EXPOSE 3333
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
