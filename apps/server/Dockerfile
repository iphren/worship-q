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
ENV NODE_ENV=production WORSHIP_Q_DATA=/data PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/remote/dist ./remote
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "--no-warnings", "dist/main.js"]
