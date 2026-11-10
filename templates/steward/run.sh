#!/bin/sh
# One steward run: kill switch, one-run lock, log. Usage:
#   run.sh <job-name> -- <command...>
# Env: STEWARD_HOME (default ./steward) holds STOP, locks/ and logs/.
# This script contains no network code; the command you pass is the agent.
set -eu
job="${1:?job name}"; shift
[ "${1:-}" = "--" ] && shift
home="${STEWARD_HOME:-./steward}"
mkdir -p "$home/locks" "$home/logs"
log="$home/logs/$job.log"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# 1. Kill switch: if STOP exists, no job runs.
if [ -e "$home/STOP" ]; then echo "$(stamp) $job skipped: STOP present" >> "$log"; exit 0; fi

# 2. One-run lock: mkdir is atomic. A lock older than STEWARD_MAX_MIN (default 120) is stale.
lock="$home/locks/$job.lock"
max="${STEWARD_MAX_MIN:-120}"
if [ -d "$lock" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +"$max" 2>/dev/null)" ]; then
  echo "$(stamp) $job clearing stale lock" >> "$log"; rmdir "$lock" 2>/dev/null || true
fi
if ! mkdir "$lock" 2>/dev/null; then echo "$(stamp) $job skipped: already running" >> "$log"; exit 0; fi
trap 'rmdir "$lock" 2>/dev/null || true' EXIT INT TERM

echo "$(stamp) $job start" >> "$log"
rc=0; "$@" >> "$log" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then echo "$(stamp) $job ok" >> "$log"; else echo "$(stamp) $job FAILED ($rc)" >> "$log"; exit 1; fi
