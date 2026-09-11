FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV VITE_OPENAI_PROXY_URL=/api/openai/chat/completions
RUN npm run build && npm run build:server

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# The server defaults to loopback; inside a container it must listen on all
# interfaces so the published port mapping works.
ENV HOST=0.0.0.0
COPY package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8080

CMD ["node", "dist-server/index.js"]
