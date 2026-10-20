FROM node:24-alpine

WORKDIR /app
COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY --chown=node:node server.js product-store.js profile-media.js analytics-store.js global-rave-presence.js realtime-hub.js scalable-chat-store.js direct-video-upload.js edge-broadcast.js broadcast-admissions.js broadcast-event-plan.js mass-broadcast-readiness.js billing-store.js star-economy.js custom-room-pricing.js wompi.js account-mailer.js push-notifications.js ./
COPY --chown=node:node db ./db
COPY --chown=node:node music-library.js music-playlists.js music-feedback.js music-owned-library.js music-audio-profile.js qdj-intent.js autopilot-dj-prototype.js ./
COPY --chown=node:node music-data ./music-data
COPY --chown=node:node scripts/migrate.js scripts/check-mass-broadcast.cjs ./scripts/
COPY --chown=node:node public ./public
RUN mkdir -p /data/profile-media /data/private-media /data/promotion-media /data/original-music && chown -R node:node /data

ENV NODE_ENV=production \
    QSESSION_BROADCAST_AUDIENCE_TARGET=10000 \
    QSESSION_PORT=8090 \
    QSESSION_DATA_FILE=/data/qsession-state.json \
    QSESSION_PROFILE_MEDIA_DIR=/data/profile-media \
    QSESSION_PRIVATE_MEDIA_DIR=/data/private-media \
    QSESSION_PROMOTION_MEDIA_DIR=/data/promotion-media \
    QSESSION_ORIGINAL_MUSIC_DIR=/data/original-music \
    QSESSION_ANALYTICS_DATA_FILE=/data/qsession-analytics.ndjson \
    QSESSION_STORAGE_DRIVER=file

EXPOSE 8090
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8090/api/status').then(response=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.js && exec node server.js"]
