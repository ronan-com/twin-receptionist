# Twin Receptionist: one Bun process serving the API and the built dashboard.
FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.0
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 API_PORT=8791
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
RUN mkdir -p data && chown -R bun:bun data
USER bun
EXPOSE 8791
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD bun -e "fetch('http://127.0.0.1:8791/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server/index.ts"]
