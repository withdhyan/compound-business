#!/bin/sh
# One steward run: kill switch, one-run lock, log. Usage:
#   run.sh <job-name> -- <command...>
# Env: STEWARD_HOME (default ./steward) holds STOP, locks/ and logs/.
# Job names are [A-Za-z0-9_-] only. Logs and locks are mode 600/700.
# This script contains no network code; the command you pass is the agent.
# Never route founder-level output (a digest) through these logs: use
# `cb digest --out <founder-only file>`, which prints only a count.
set -eu
umask 077
job="${1:-}"; [ -n "$job" ] || { echo "run.sh: job name required" >&2; exit 2; }
case "$job" in *[!A-Za-z0-9_-]*) echo "run.sh: bad job name" >&2; exit 2;; esac
shift
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "run.sh: no command" >&2; exit 2; }
home="${STEWARD_HOME:-./steward}"
mkdir -p "$home/locks" "$home/logs"
log="$home/logs/$job.log"
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# 1. Kill switch: if STOP exists, no job runs.
if [ -e "$home/STOP" ]; then echo "$(stamp) $job skipped: STOP present" >> "$log"; exit 0; fi

# 2. One-run lock: mkdir is atomic; the lock records its owner. A lock older
# than STEWARD_MAX_MIN (default 120) is stale and is moved aside atomically
# (only one waiter wins the mv), then the lock is taken again with mkdir.
lock="$home/locks/$job.lock"
max="${STEWARD_MAX_MIN:-120}"
token="$$.$(date +%s)"
if [ -d "$lock" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +"$max" 2>/dev/null)" ]; then
  if mv "$lock" "$lock.stale.$token" 2>/dev/null; then
    echo "$(stamp) $job cleared stale lock (owner $(cat "$lock.stale.$token/owner" 2>/dev/null || echo unknown))" >> "$log"
    rm -rf "$lock.stale.$token"
  fi
fi
if ! mkdir "$lock" 2>/dev/null; then echo "$(stamp) $job skipped: already running" >> "$log"; exit 0; fi
echo "$token" > "$lock/owner"
# The trap removes the lock only if it is still ours.
release() { [ "$(cat "$lock/owner" 2>/dev/null || true)" = "$token" ] && rm -rf "$lock"; return 0; }
trap release EXIT INT TERM

echo "$(stamp) $job start" >> "$log"
rc=0; "$@" >> "$log" 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then echo "$(stamp) $job ok" >> "$log"; else echo "$(stamp) $job FAILED ($rc)" >> "$log"; exit 1; fi
