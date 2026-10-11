#!/usr/bin/env sh
# archify-nolink: 硬链接被禁时跑通 archify finalize（中文说明见 README.zh-CN.md）
# Run archify where fs.linkSync is blocked (EACCES/EPERM): copy-fallback +
# virtual dev/ino/nlink via Node preload. See README.md / README.zh-CN.md.
# 用法 Usage:
#   ARCHIFY_BIN=/path/to/archify/bin/archify.mjs \
#   ARCHIFY_CHROME=/path/to/chrome-or-headless_shell \
#   sh archify-nolink.sh finalize architecture candidate.json overview.html --quality showcase --json
set -eu
usage() {
  echo "用法：ARCHIFY_BIN=/path/to/archify/bin/archify.mjs [ARCHIFY_CHROME=/path/to/chrome] sh archify-nolink.sh finalize <type> <candidate.json> <output.html> --quality showcase --json" >&2
  echo "Usage: ARCHIFY_BIN=... [ARCHIFY_CHROME=...] sh archify-nolink.sh finalize <type> <candidate.json> <output.html> --quality showcase --json" >&2
}
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "$#" -eq 0 ]; then
  usage
  exit "$([ "$#" -eq 0 ] && echo 2 || echo 0)"
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ARCHIFY_BIN=${ARCHIFY_BIN:-${ARCHIFY_SKILL_DIR:-}/bin/archify.mjs}
PRELOAD=${ARCHIFY_NOLINK_PRELOAD:-$SCRIPT_DIR/nolink-preload.mjs}
command -v node >/dev/null 2>&1 || { echo "archify-nolink: 找不到 node / node not found" >&2; exit 2; }
if [ -z "${ARCHIFY_BIN:-}" ] || [ ! -f "$ARCHIFY_BIN" ]; then
  echo "archify-nolink: 请设置 ARCHIFY_BIN 为 /path/to/archify/bin/archify.mjs / set ARCHIFY_BIN first" >&2
  usage
  exit 2
fi
if [ ! -f "$PRELOAD" ]; then
  echo "archify-nolink: 找不到补丁 $PRELOAD / preload not found" >&2
  exit 2
fi
if [ -n "${ARCHIFY_CHROME:-}" ]; then
  export ARCHIFY_CHROME
fi
export ARCHIFY_CHROME_NO_SANDBOX=${ARCHIFY_CHROME_NO_SANDBOX:-1}
case "${NODE_OPTIONS:-}" in
  *"$PRELOAD"*) ;;
  *) export NODE_OPTIONS="--import $PRELOAD ${NODE_OPTIONS:-}" ;;
esac
exec node "$ARCHIFY_BIN" "$@"
