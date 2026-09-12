FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001 NO_PROXY="" no_proxy=""
RUN mkdir -p server/tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates ffmpeg \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages --no-cache-dir --upgrade pip \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp gallery-dl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY package.json ./
COPY vite.config.js ./
COPY index.html ./
RUN ln -sf /usr/local/bin/yt-dlp /app/server/tools/yt-dlp \
  && ln -sf /usr/local/bin/gallery-dl /app/server/tools/gallery-dl
EXPOSE 3001
CMD ["sh","-c","exec node server/index.mjs"]
