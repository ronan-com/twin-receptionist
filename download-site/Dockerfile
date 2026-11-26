# The setup site: one Bun process + SQLite. Data (buyers, setups, encrypted secrets,
# published server bundles) lives in the /data volume.
FROM oven/bun:1.4.0
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4500 DATA_DIR=/data TRUST_PROXY=1
COPY package.json ./
RUN bun install --production
# The app code, public/ and provision/; content/ too if you copied the how-tos in (see README).
COPY . .
RUN mkdir -p /data /incoming && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 4500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD bun -e "fetch('http://127.0.0.1:4500/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "server.ts"]
