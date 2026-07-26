FROM node:18-bookworm-slim

# Install Chromium and FFmpeg for Remotion rendering
RUN apt-get update && \
    apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-color-emoji && \
    rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV REMOTION_BUNDLE_PATH=/app/remotion
ENV OUTPUT_DIR=/output

WORKDIR /app

# Shared master export policy used by Python and the renderer
COPY master-export-policy.json /app/master-export-policy.json

# Copy render service source
COPY render-service/package.json render-service/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY render-service/tsconfig.json ./
COPY render-service/src/ ./src/

# Copy remotion source for bundling
COPY remotion/package.json /app/remotion/package.json
COPY remotion/package-lock.json /app/remotion/package-lock.json
COPY remotion/tsconfig.json /app/remotion/tsconfig.json
COPY remotion/src/ /app/remotion/src/
COPY remotion/public/ /app/remotion/public/

# Install remotion deps
RUN --mount=type=cache,target=/root/.npm cd /app/remotion && npm ci --no-audit --no-fund

# Build TypeScript
RUN npm run build

EXPOSE 3100
CMD ["node", "dist/server.js"]
