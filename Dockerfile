# -------- Stage 1: build ggwave (Linux)
# This stage was already well-optimized.
FROM debian:bookworm-slim AS ggwave-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config libsdl2-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ggwave /src/ggwave
RUN mkdir -p /src/ggwave/build-linux \
 && cd /src/ggwave/build-linux \
 && cmake -DGGWAVE_SUPPORT_SDL2=ON -DGGWAVE_BUILD_EXAMPLES=ON cmake -D USE_FINDSDL2 .. \
 && cmake --build . --config Release -j $(nproc)
RUN mkdir -p /opt/ggwave/bin \
 && cp /src/ggwave/build-linux/bin/ggwave-to-file /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/bin/ggwave-from-file /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/bin/ggwave-cli /opt/ggwave/bin/

# -------- Stage 2: build client
FROM node:20-bullseye AS client-build
WORKDIR /app
# OPTIMIZATION: Copy package files first to cache npm install step
COPY app/client/package*.json ./
RUN npm ci || npm i
COPY app/client .
RUN npm run build

# -------- Stage 3: runtime
FROM node:20-bullseye-slim
# Add ffmpeg installation here
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
# ... rest of the final stage
# OPTIMIZATION: Copy package files first to cache npm install step
COPY app/server/package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY app/server .
# ---
COPY --from=client-build /app/dist /app/../client/dist
COPY --from=ggwave-build /opt/ggwave/bin /opt/ggwave/bin
ENV GGWAVE_BIN_DIR=/opt/ggwave/bin
ENV GGWAVE_CLI=/opt/ggwave/bin/ggwave-cli
EXPOSE 5055

# OPTIMIZATION: Run as a non-root user for better security
USER node

CMD ["node", "src/index.js"]
