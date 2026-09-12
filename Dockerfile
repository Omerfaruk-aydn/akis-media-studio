FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001 NO_PROXY="" no_proxy=""
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl ffmpeg \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && curl -fsSL https://github.com/mikf/gallery-dl/releases/download/v1.32.11/gallery-dl -o /usr/local/bin/gallery-dl \
  && chmod +x /usr/local/bin/yt-dlp /usr/local/bin/gallery-dl \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY package.json ./
COPY vite.config.js ./
COPY index.html ./
EXPOSE 3001
CMD ["sh","-c","if [ ! -x server/tools/yt-dlp ]; then yt-dlp --version >/dev/null && ln -sf /usr/local/bin/yt-dlp server/tools/yt-dlp && ln -sf /usr/local/bin/gallery-dl server/tools/gallery-dl; fi; exec node server/index.mjs"]
