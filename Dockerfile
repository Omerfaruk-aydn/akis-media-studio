FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001 NO_PROXY="" no_proxy=""
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates ffmpeg \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp gallery-dl \
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
