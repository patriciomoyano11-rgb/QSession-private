FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app/analysis
COPY analysis/package.json analysis/pnpm-lock.yaml ./
# CPU ONNX binaries are bundled. Skip optional native/GPU download scripts.
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate && pnpm install --prod --frozen-lockfile --ignore-scripts
COPY analysis/*.mjs analysis/*.cjs ./
COPY public/dj-mixer.js /app/public/dj-mixer.js
RUN node prepare-model.mjs
ENV QSESSION_ORIGINAL_MUSIC_DIR=/data/original-music
USER node
CMD ["node", "worker.mjs"]
