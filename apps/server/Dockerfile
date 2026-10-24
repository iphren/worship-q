# Build from the repository root:  docker build -f apps/server/Dockerfile -t worship-q-server .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @worship-q/server... --filter @worship-q/remote-web...
RUN pnpm --filter @worship-q/remote-web build && pnpm --filter @worship-q/server build
# Only the server's runtime dependencies go into the image.
RUN pnpm --filter @worship-q/server deploy --prod /out

FROM node:22-slim
# Slide deck import: LibreOffice lays out the slides, Ghostscript draws them, and the fonts
# keep text where the author put it. Noto CJK covers Chinese; Carlito, Caladea and Liberation
# have the same widths as Calibri, Cambria, Arial and Times New Roman.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress ghostscript \
      fonts-noto-cjk fonts-liberation2 fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*
# Microsoft's free core fonts (Arial, Trebuchet MS, Georgia, Verdana…) are fetched from their
# mirror while building. Without them the image still works; those fonts are substituted.
RUN sed -i 's/^Components: main$/Components: main contrib/' /etc/apt/sources.list.d/debian.sources \
 && echo 'ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true' | debconf-set-selections \
 && apt-get update \
 && (apt-get install -y --no-install-recommends ttf-mscorefonts-installer \
     || echo 'Microsoft core fonts unavailable; continuing without them.') \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production WORSHIP_Q_DATA=/data PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/remote/dist ./remote
# The server runs as `node`; a new volume takes this folder's owner.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "--no-warnings", "dist/main.js"]
