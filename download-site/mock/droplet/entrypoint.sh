#!/bin/bash
# cgroup v2 nesting (same idea as moby's hack/dind): move our processes out of the
# root cgroup so dockerd can enable controllers for its own containers.
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  mkdir -p /sys/fs/cgroup/init
  xargs -rn1 < /sys/fs/cgroup/cgroup.procs > /sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true
  sed -e 's/ / +/g' -e 's/^/+/' < /sys/fs/cgroup/cgroup.controllers > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
fi
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -n "${AUTHORIZED_KEYS:-}" ] && printf '%s\n' "$AUTHORIZED_KEYS" > /root/.ssh/authorized_keys
start_dockerd() { (dockerd > /var/log/dockerd.log 2>&1 &) ; }
# Test switch: NO_DOCKERD=1 boots without Docker running, so install.sh fails and the retry path can be tested.
[ "${NO_DOCKERD:-}" = 1 ] || start_dockerd
echo "mock droplet up"
exec sleep infinity
