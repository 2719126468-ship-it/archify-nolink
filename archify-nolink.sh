#!/usr/bin/env sh
# archify-nolink: run archify where fs.linkSync is blocked (EACCES/EPERM).
# Ports the Termux f2fs fix: copy-fallback + virtual dev/ino/nlink via preload.
# Usage:
#   ARCHIFY_BIN=/path/to/archify/bin/archify.mjs \
#   ARCHIFY_CHROME=/path/to/chrome-or-headless_shell \
#   sh archify-nolink.sh finalize architecture candidate.json overview.html --quality showcase --json
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ARCHIFY_BIN=${ARCHIFY_BIN:-${ARCHIFY_SKILL_DIR:-}/bin/archify.mjs}
PRELOAD=${ARCHIFY_NOLINK_PRELOAD:-$SCRIPT_DIR/nolink-preload.mjs}
if [ -z "${ARCHIFY_BIN:-}" ] || [ ! -f "$ARCHIFY_BIN" ]; then
  echo "archify-nolink: set ARCHIFY_BIN to /path/to/archify/bin/archify.mjs" >&2
  exit 2
fi
if [ -n "${ARCHIFY_CHROME:-}" ]; then
  export ARCHIFY_CHROME
fi
export ARCHIFY_CHROME_NO_SANDBOX=${ARCHIFY_CHROME_NO_SANDBOX:-1}
export NODE_OPTIONS="--import $PRELOAD ${NODE_OPTIONS:-}"
exec node "$ARCHIFY_BIN" "$@"
