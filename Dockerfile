# -------- Stage 1: build ggwave (Linux)
FROM debian:bookworm-slim AS ggwave-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config libsdl2-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ggwave /src/ggwave
RUN mkdir -p /src/ggwave/build-linux \
 && cd /src/ggwave/build-linux \
 && cmake -DGGWAVE_SUPPORT_SDL2=ON -DGGWAVE_BUILD_EXAMPLES=ON -DUSE_FINDSDL2=ON .. \
 && cmake --build . --config Release -j $(nproc)
RUN mkdir -p /opt/ggwave/bin \
 && cp /src/ggwave/build-linux/bin/ggwave-to-file /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/bin/ggwave-from-file /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/bin/ggwave-cli /opt/ggwave/bin/

# -------- Stage 2: build client
FROM node:20-bullseye AS client-build
WORKDIR /app
COPY app/client /app
RUN npm ci || npm i \
 && npm run build

# -------- Stage 3: runtime
FROM node:20-bullseye
ENV NODE_ENV=production
WORKDIR /app
COPY app/server /app
COPY --from:client-build /app/dist /app/../client/dist
COPY --from=ggwave-build /opt/ggwave/bin /opt/ggwave/bin
ENV GGWAVE_BIN_DIR=/opt/ggwave/bin
ENV GGWAVE_CLI=/opt/ggwave/bin/ggwave-cli
RUN npm ci --omit=dev || npm i --omit=dev
EXPOSE 5055
CMD ["node", "src/index.js"]
