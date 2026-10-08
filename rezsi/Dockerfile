# Build stage: compile the web UI and bundle the server (arch-independent JavaScript).
FROM node:22-alpine AS build
RUN npm install -g pnpm@10.28.0
WORKDIR /src
COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml app/
COPY app/shared/package.json app/shared/
COPY app/server/package.json app/server/
COPY app/web/package.json app/web/
# Only what the web and server builds need (and their workspace dependencies).
RUN cd app && pnpm install --frozen-lockfile --filter "@rezsi/web..." --filter "@rezsi/server..."
COPY config.yaml ./
COPY app app
RUN cd app && pnpm build

# Runtime stage: Home Assistant base image (multi-arch) with Node.js and git.
FROM ghcr.io/home-assistant/base:3.23
RUN apk add --no-cache nodejs git icu-data-full
WORKDIR /opt/rezsi
COPY --from=build /src/app/server/dist/ server/dist/
COPY --from=build /src/app/web/dist web/dist
ENV NODE_ENV=production
# Node runs directly (under Docker's init, see `init: true`) and handles SIGTERM itself.
ENTRYPOINT []
CMD ["node", "--enable-source-maps", "/opt/rezsi/server/dist/index.js"]

LABEL \
  io.hass.type="app" \
  io.hass.name="Rezsi" \
  io.hass.description="Household utility tracker with reminders and git export" \
  io.hass.arch="aarch64|amd64" \
  org.opencontainers.image.title="Rezsi" \
  org.opencontainers.image.source="https://github.com/gulyasfeccferenc/home-assistant-rezsi-daemon"
