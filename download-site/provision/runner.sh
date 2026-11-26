#!/bin/bash
# Started once by the first-boot script. Asks the setup site for work, installs, reports, stops.
# It only ever makes outgoing requests to the setup site; nothing can connect in through it.
export LC_ALL=C HOME=/root PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
R=/opt/receptionist; S=$R/setup
SITE=$(cat "$S/site"); DTOK=$(cat "$S/token")
#TEST_ENV#
c() { local t=$1; shift; curl -sS -f --connect-timeout 10 --max-time "$t" -A receptionist-setup "$@"; }

# Posts the new complete lines of $LOG, from byte $OFF. The site answers "ok <bytes it has>".
post_log() {
  local chunk resp before
  while :; do
    chunk=$(tail -c +$((OFF + 1)) "$LOG" 2>/dev/null | head -c 60000; echo .); chunk=${chunk%.}
    [ -n "$chunk" ] || return 0
    if [[ $chunk == *$'\n'* ]]; then chunk=${chunk%$'\n'*}$'\n'
    elif [ "$1" != final ] && [ ${#chunk} -lt 60000 ]; then return 0; fi
    before=$OFF
    resp=$(printf '%s' "$chunk" | c 30 -X POST -H 'Content-Type: text/plain' --data-binary @- "$SITE/p/$ATOK/log?offset=$OFF") || return 1
    case $resp in ok\ *) OFF=${resp#ok } ;; *) return 1 ;; esac
    [ "$OFF" -gt "$before" ] || return 1
    [ "$1" = final ] || return 0
  done
}

attempt() { # <attempt token> <bundle sha256> <attempt number>
  ATOK=$1; OFF=0; LOG=$S/install-$3.log; : > "$LOG"
  (
    umask 022
    echo "==> Downloading the app from the setup site"
    if c 900 -o "$S/bundle.tgz" "$SITE/p/$ATOK/bundle" && echo "$2  $S/bundle.tgz" | sha256sum -c --status -; then
      tar -xzf "$S/bundle.tgz" -C "$R" --no-same-owner && rm -f "$S/bundle.tgz" || { echo "INSTALL FAILED: the app download was damaged. Press Try again."; exit 1; }
      install -m 600 "$S/settings.env" "$R/.env"
      echo "    $(cat "$R/VERSION" 2>/dev/null || echo unpacked)"
      exec bash "$R/install.sh"
    fi
    echo "INSTALL FAILED: the app could not be downloaded from the setup site (the link may have expired). Press Try again."
    exit 1
  ) >> "$LOG" 2>&1 &
  local pid=$! rc i
  while kill -0 $pid 2>/dev/null; do sleep 2; post_log partial; done
  wait $pid; rc=$?
  for i in $(seq 1 360); do post_log final && break; sleep 5; done
  for i in $(seq 1 360); do c 30 -X POST "$SITE/p/$ATOK/exit?code=$rc&offset=$OFF" >/dev/null && break; sleep 5; done
  return $rc
}

started=$(date +%s)
while :; do
  r=$(c 30 "$SITE/p/$DTOK/next" 2>/dev/null) || r=
  case $r in
    go\ *) set -- $r; if attempt "$2" "$3" "$4"; then break; fi ;;
    stop*) break ;;
  esac
  [ $(( $(date +%s) - started )) -lt 259200 ] || break   # stop asking after 3 days
  sleep 10
done
# Finished: forget the setup site. The settings now live only in /opt/receptionist/.env.
rm -f "$S/settings.env" "$S/token" "$S/site"
