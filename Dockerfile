# -------- Stage 1: build ggwave (Linux)
# This stage compiles the ggwave C++ source code.
FROM debian:bookworm-slim AS ggwave-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config libsdl2-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY ggwave /src/ggwave
RUN mkdir -p /src/ggwave/build-linux \
 && cd /src/ggwave/build-linux \
 && cmake -DBUILD_SHARED_LIBS=ON -DGGWAVE_SUPPORT_SDL2=ON -DGGWAVE_BUILD_EXAMPLES=ON -DUSE_FINDSDL2=ON .. \
 && cmake --build . --config Release -j $(nproc)

# --- CORRECTED PART ---
# The build logs show the library is created in the 'src' subdirectory.
# This copies the executable and the shared library from their exact locations.
RUN mkdir -p /opt/ggwave/bin /opt/ggwave/lib \
 && cp /src/ggwave/build-linux/bin/ggwave-cli /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/bin/ggwave-to-file /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/bin/ggwave-from-file /opt/ggwave/bin/ \
 && cp /src/ggwave/build-linux/src/libggwave.so /opt/ggwave/lib/ \
 && cp /src/ggwave/build-linux/examples/libggwave-common*.so /opt/ggwave/lib/ \
 && chmod +x /opt/ggwave/bin/*

# -------- Stage 2: build client
# This stage builds the frontend React/Vue/etc. application.
FROM node:20-bullseye AS client-build
WORKDIR /app
COPY app/client/package*.json ./
RUN npm ci || npm i
COPY app/client .
RUN npm run build

# -------- Stage 3: runtime
# This is the final, lightweight image that will run your application.
FROM node:20-bullseye-slim
# Install runtime dependencies needed by ggwave and ffmpeg.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsdl2-2.0-0 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/server
COPY app/server/package*.json ./
RUN npm ci --omit=dev || npm i --omit=dev
COPY app/server .
# Copy built assets from previous stages.
COPY --from=client-build /app/dist /app/client/dist
COPY --from=ggwave-build /opt/ggwave/bin /opt/ggwave/bin
COPY --from=ggwave-build /opt/ggwave/lib /opt/ggwave/lib

# Ensure binaries have execute permissions
RUN chmod +x /opt/ggwave/bin/ggwave-cli /opt/ggwave/bin/ggwave-to-file /opt/ggwave/bin/ggwave-from-file

# Set the library path for the OS, and set app-specific paths.
ENV LD_LIBRARY_PATH=/opt/ggwave/lib:$LD_LIBRARY_PATH
ENV GGWAVE_BIN_DIR=/opt/ggwave/bin
ENV GGWAVE_CLI=/opt/ggwave/bin/ggwave-cli

EXPOSE 5055

# Run as a non-root user for better security.
USER node

CMD ["node", "src/index.js"]