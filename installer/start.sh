#!/usr/bin/env bash
# Starts the setup app and opens it in your browser (Mac and Linux).
set -euo pipefail
cd "$(dirname "$0")"
IMAGE=${IMAGE:-receptionist-installer:latest}
NAME=receptionist-setup
URL=http://localhost:4400

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker isn't installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ then run this again."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Open Docker Desktop, wait until it says it's running, then run this again."
  exit 1
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  if [ -f receptionist-installer-image.tar.gz ]; then
    echo "Loading the installer (first time only, about a minute)..."
    docker load -i receptionist-installer-image.tar.gz >/dev/null
  else
    docker pull "$IMAGE"
  fi
fi
docker rm -f "$NAME" >/dev/null 2>&1 || true
# Only this computer can reach the page (127.0.0.1). Progress is kept in the
# "receptionist-setup-data" Docker volume, so running this again resumes.
docker run -d --rm --name "$NAME" -p 127.0.0.1:4400:4400 -v receptionist-setup-data:/state "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$URL/api/state" 2>/dev/null && break
  sleep 0.5
done
echo "Setup is running at $URL"
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
fi
echo "When you're finished, you can stop it with:  docker stop $NAME"
