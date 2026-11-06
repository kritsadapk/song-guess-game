FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY client/package.json client/
COPY server/package.json server/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/shared shared
COPY --from=build /app/server server
COPY --from=build /app/client/dist client/dist
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000
VOLUME /app/server/data
CMD ["bun", "server/src/index.ts"]
