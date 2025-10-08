# -------- Stage 1: build ggwave (Linux)
FROM debian:bookworm-slim AS ggwave-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config libsdl2-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ggwave /src/ggwave
RUN mkdir -p /src/ggwave/build-linux \
 && cd /src/ggwave/build-linux \
 && cmake -DGGWAVE_SUPPORT_SDL2=ON -DGGWAVE_BUILD_EXAMPLES=ON -DUSE_FINDSDL2=ON .. \
 && cmake --build . --config Release -j $(nproc)

# <--- DEBUGGING STEP: This will show us where the .so file really is.
RUN echo "--- Listing build directory contents ---" && ls -R /src/ggwave/build-linux

# --- The build is expected to fail on the next line ---
RUN mkdir -p /opt/ggwave/bin /opt/ggwave/lib \
 && cp /src/ggwave/build-linux/bin/ggwave-cli /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/libggwave.so /opt/ggwave/lib/

# -------- Stage 2: build client
FROM node:20-bullseye AS client-build
WORKDIR /app
COPY app/client/package*.json ./
RUN npm ci || npm i
COPY app/client .
RUN npm run build

# -------- Stage 3: runtime
FROM node:20-bullseye-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsdl2-2.0-0 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/server
COPY app/server/package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY app/server .
COPY --from=client-build /app/dist /app/client/dist
COPY --from=ggwave-build /opt/ggwave/bin /opt/ggwave/bin
COPY --from=ggwave-build /opt/ggwave/lib /opt/ggwave/lib
ENV LD_LIBRARY_PATH=/opt/ggwave/lib:$LD_LIBRARY_PATH
ENV GGWAVE_BIN_DIR=/opt/ggwave/bin
ENV GGWAVE_CLI=/opt/ggwave/bin/ggwave-cli
EXPOSE 5055
USER node
CMD ["node", "src/index.js"]