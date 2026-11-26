# The setup app the buyer runs on their own computer (see README.md).
# Build with ./build.sh, which first makes the server bundle and copies it to bundle/.
FROM oven/bun:1.4.0
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends openssh-client ca-certificates >/dev/null \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY src ./src
COPY public ./public
COPY bundle/selfhost-bundle.tgz ./bundle/selfhost-bundle.tgz
ENV STATE_DIR=/state PORT=4400 NODE_ENV=production
VOLUME /state
EXPOSE 4400
CMD ["bun", "src/server.ts"]
