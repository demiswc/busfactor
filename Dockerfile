# busfactor container image. Normally built by docker compose (see docker-compose.yml).
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build --chown=1000:1000 /app /app
USER 1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health?live=1').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/app/docker/entrypoint.sh"]
