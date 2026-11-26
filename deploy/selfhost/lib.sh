# Shared helpers for the self-host scripts (install, update, backup, restore, dc).
# Sourced, not run. Everything lives next to this file (normally /opt/receptionist).

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RUN="$ROOT/run"           # files install.sh generates on every run
BACKUPS="$ROOT/backups"   # nightly pg_dump files
PROJECT=${SELFHOST_PROJECT:-receptionist}   # docker compose project name (tests use another)
DB_USER=receptionist
DB_NAME=receptionist

# docker compose for this stack. Uses its own env file, so compose never parses /opt/receptionist/.env.
dc() {
  docker compose -p "$PROJECT" --project-directory "$ROOT" -f "$ROOT/compose.yml" --env-file "$RUN/compose.env" "$@"
}

# read_env FILE: loads KEY=VALUE lines into the CONF associative array.
# Values are taken literally (no inline comments, no $ expansion); one pair of
# matching surrounding quotes is stripped. Blank lines and # comments are skipped.
declare -gA CONF
read_env() {
  local f=$1 line k v q
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    line=${line#export }
    [[ $line == *=* ]] || continue
    k=${line%%=*}; v=${line#*=}
    k=${k//[[:space:]]/}
    [[ $k =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [ ${#v} -ge 2 ]; then
      q=${v:0:1}
      if [[ ( $q == '"' || $q == "'" ) && ${v: -1} == "$q" ]]; then
        v=${v:1:${#v}-2}
        if [ "$q" = '"' ]; then v=${v//\\\"/\"}; v=${v//\\\\/\\}; fi
      fi
    fi
    CONF[$k]=$v
  done < "$f"
}

# env_line KEY VALUE: one line for a docker compose env_file, quoted so compose
# keeps the value exactly (no $ interpolation, no comment stripping).
env_line() {
  local k=$1 v=$2
  if [[ $v != *"'"* ]]; then
    printf "%s='%s'\n" "$k" "$v"
  else
    v=${v//\\/\\\\}; v=${v//\"/\\\"}; v=${v//\$/\$\$}
    printf '%s="%s"\n' "$k" "$v"
  fi
}

# Container id of a service, or empty.
cid() { dc ps -q "$1" 2>/dev/null | head -n1; }

# wait_healthy SERVICE SECONDS: waits for the container's healthcheck to pass.
wait_healthy() {
  local svc=$1 limit=$2 s=0 id st
  while [ "$s" -lt "$limit" ]; do
    id=$(cid "$svc")
    st=$([ -n "$id" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)
    [ "$st" = healthy ] && return 0
    sleep 3; s=$((s + 3))
  done
  return 1
}
