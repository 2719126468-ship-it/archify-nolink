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
PRELOAD=${ARCHIFY_NOLINK_PRELOAD:-$SCRIPT_DIR/nolink-preload.mjs}
command -v node >/dev/null 2>&1 || { echo "archify-nolink: 找不到 node / node not found" >&2; exit 2; }
# 未指定 ARCHIFY_BIN 时，自动按优先级定位 archify 主程序：
# 1) $ARCHIFY_SKILL_DIR/bin/archify.mjs（标准 skill 布局）
# 2) require.resolve('@tt-a1i/archify-dsh') 包内 skills/archify/bin/archify.mjs
# 3) find 扫描 ~/.dsh/profiles 树下的 *archify-dsh*/skills/archify/bin/archify.mjs
# 4) npm 全局 / 常见本地路径
if [ -z "${ARCHIFY_BIN:-}" ] && [ -n "${ARCHIFY_SKILL_DIR:-}" ] && [ -f "${ARCHIFY_SKILL_DIR}/bin/archify.mjs" ]; then
  ARCHIFY_BIN="${ARCHIFY_SKILL_DIR}/bin/archify.mjs"
fi
if [ ! -f "${ARCHIFY_BIN:-}" ]; then
  ARCHIFY_BIN=$(node -e '
    const p=require("node:path"),fs=require("node:fs");
    const cand=[];
    try{cand.push(p.join(p.dirname(require.resolve("@tt-a1i/archify-dsh/package.json")),"skills","archify","bin","archify.mjs"))}catch{}
    try{cand.push(p.join(p.dirname(require.resolve("archify-dsh/package.json")),"skills","archify","bin","archify.mjs"))}catch{}
    for(const c of cand){if(fs.existsSync(c)){console.log(c);process.exit(0)}}
    process.exit(1)
  ' 2>/dev/null || true)
fi
if [ ! -f "${ARCHIFY_BIN:-}" ]; then
  ARCHIFY_BIN=$(node -e '
    const {execSync}=require("node:child_process");
    const base=process.env.HOME+"/.dsh/profiles";
    try{
      const out=execSync("find \""+base+"\" -path \"*archify-dsh*/skills/archify/bin/archify.mjs\" 2>/dev/null | head -n1").toString().trim();
      if(out){console.log(out);process.exit(0)}
    }catch{}
    process.exit(1)
  ' 2>/dev/null || true)
fi
if [ ! -f "${ARCHIFY_BIN:-}" ]; then
  ARCHIFY_BIN=$(ls -1 \
    "$(npm root -g 2>/dev/null)/archify-dsh/skills/archify/bin/archify.mjs" \
    2>/dev/null | head -n1 || true)
fi
if [ -z "${ARCHIFY_BIN:-}" ] || [ ! -f "$ARCHIFY_BIN" ]; then
  echo "archify-nolink: 找不到 archify 主程序，请设置 ARCHIFY_BIN=/path/to/archify/bin/archify.mjs" >&2
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
