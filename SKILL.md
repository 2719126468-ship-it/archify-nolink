---
name: archify-nolink
description: "finalize 兜底：archify finalize 在 linkSync 被禁（EACCES/EPERM）时失败，改用复制+虚拟 dev/ino/nlink 预加载跑通。命中 link 报错、backup-finalization 失败、Termux/手机环境跑 archify 时用它。"
license: MIT
metadata:
  version: "1.0"
  author: 2719126468-ship-it
  based_on: archify finalize + Termux f2fs link() 修复实践
---

# archify-nolink

在 `fs.linkSync`（硬链接）被禁的文件系统上跑通 archify `finalize`。
只做一件事：硬链接失败时自动改用复制，并伪造文件身份让 archify 的原子发布检查通过。

## 何时用它

- `finalize` 报 `EACCES: permission denied, link ...`
- 报 `candidate-publication-link-failed` / `output/target-indeterminate`
- 报 `previous-output-backup-finalization-failed` / `previous-output-identity-changed`
- 报 `candidate-link-count-unavailable`
- 在 Termux / Android / 容器里跑 archify，且 `rename`/`copyFile`/`symlink` 可用但硬链接全挂

`validate` 能过不代表 `finalize` 能过：`finalize` 对同一收据发布两次，
第二次才走备份逻辑，单测通过但 `finalize` 挂就是这个坑。确认方法见
[排障](references/troubleshooting.md)。

## 步骤

1. 定位 archify 主程序 `.../archify/bin/archify.mjs`，记为 `ARCHIFY_BIN`；
   跑 `browser-check` 另需浏览器可执行文件，记为 `ARCHIFY_CHROME`。
2. 用本 skill 的包装脚本代替直接调 `node`，在图所在工作目录执行：

   ```sh
   ARCHIFY_BIN=/path/to/archify/bin/archify.mjs \
   ARCHIFY_CHROME=/path/to/chrome-or-headless_shell \
   sh archify-nolink.sh finalize architecture candidate.json overview.html \
     --quality showcase --json
   ```

3. 以 `overview.finalize-summary.json` 为准：`"ok": true` 且
   `gates.validate/deliver/check/browser-check` 全 `pass` 即完成；
   非零退出一律按失败处理，去[排障](references/troubleshooting.md)修。
   完成标准：收据全绿，而不是“看着像跑完了”。

## 文件

- `nolink-preload.mjs` — Node 预加载补丁（`linkSync` 复制回退 + 虚拟身份组，
  靠 `NODE_OPTIONS` 传给 archify 及其子进程）。
- `archify-nolink.sh` — 可移植包装脚本。
- `example/` — 一次真实全绿 `finalize`（`candidate.json` + `overview.html` + 两份收据）。
- `references/troubleshooting.md` — 修不好时再看的细节。

## 开关

- `ARCHIFY_NOLINK=0`：关补丁，恢复原生 `linkSync`（对比定位用）。
- `ARCHIFY_NOLINK_DEBUG=1`：打印 `[nolink-preload] active`。
- 重试 `finalize` 前先清残留：`.archify-remove-*`、`*.delivery.json`、
  `*.finalize*.json` 和锁文件。
