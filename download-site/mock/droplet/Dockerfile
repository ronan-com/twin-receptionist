# Test mode only: stands in for a fresh DigitalOcean Ubuntu 24.04 droplet.
# A real droplet has no Docker; install.sh normally installs it. In test mode
# (SELFHOST_TEST=1) install.sh skips the system steps, so Docker is baked in here
# and started by the entrypoint (privileged container, Docker inside Docker).
# The fake DigitalOcean API runs the droplet's user_data script in it, like cloud-init.
FROM ubuntu:24.04
RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      docker.io docker-compose-v2 curl ca-certificates openssl iptables procps sudo tar gzip coreutils >/dev/null \
 && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
