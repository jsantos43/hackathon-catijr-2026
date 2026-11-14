# Build do front React e serviço estático pelo nginx (porta 8080).
FROM node:24-slim AS build

WORKDIR /app

ARG VITE_API_URL=http://localhost:8080
ARG VITE_PENDING_FALLBACK=true
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PENDING_FALLBACK=$VITE_PENDING_FALLBACK

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
