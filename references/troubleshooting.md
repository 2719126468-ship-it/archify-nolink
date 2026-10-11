# 排障：修不好时看这页

> 先确认：`validate` 能过 ≠ `finalize` 能过。`finalize` 会对同一收据路径发布两次
> （先 `running` 再终版），第二次才会走 `backupPublicRegularFileBinding` 备份老文件的逻辑。
> 所以“单发测试能过、`finalize` 挂”，几乎就是本页的问题。

## 1. 确认是不是硬链接问题

同时满足两条，方向就没错：

1. 直接调原生 `linkSync` 必挂。最快验证：`ARCHIFY_NOLINK=0` 跑一次，
   看到原生 `EACCES: permission denied, link ...` 即实锤。
2. `rename` / `copyFile` / `symlink` / `unlink` 可用，只是硬链接全挂。
   （本 skill 的前提；如果连 `rename` 都禁，补丁也救不了。）

关键词对照：

- `candidate-publication-link-failed` / `output/target-indeterminate`：第一次发布就链不上。
- `previous-output-backup-finalization-failed` / `previous-output-identity-changed`：
  第二次发布（备份老文件那步）身份对不上，朴素复制版补丁最常死在这里。
- `candidate-link-count-unavailable`：文件系统报 `ino 0 / nlink 0` 不稳定，
  需要身份兜底（本补丁已带）。

## 2. 补丁没生效？先看这三处

朴素版补丁漏掉的三件事，也是本 skill 修掉的三处：

1. **子进程穿透**：真正渲染在 archify 拉起的子进程里。
   补丁必须靠 `NODE_OPTIONS="--import .../nolink-preload.mjs"` 继承，
   单次 `node --import` 包一层没用。检查：`ARCHIFY_NOLINK_DEBUG=1` 重跑，
   日志里必须出现 `[nolink-preload] active`（含子进程）。
2. **二次 rename 顶替**：第二次 `rename` 压到已在组里的名字时，
   先把被压掉的名字踢出组（`leaveGroup(nR)` 再 `origRename`）。
   真硬链接就是这么替换 inode 的，复制模拟必须照做。
3. **fd 身份钉住**：`open` 时把 fd 钉到当时的组（`fdGroup`），
   `fstat` 永远报钉住的组身份，不随 `rename/unlink` 漂移。
   否则备份收尾校验看到的就是 `identity-changed`。

隔离复现时：`backupPublicRegularFileBinding` 单测报 `backed-up` 很正常，
一定要用“同一路径发两次”的用例（如本仓开发期的 `dbg-backup2.mjs`：
`writeJsonAtomicLike` 两次写同一 `receipt.json`，第二次目标会 `ENOENT`）
去验上面的 2、3。

## 3. 重试前的清理

`finalize` 失败会留残留状态，直接重跑会把旧错带进来。先清：

- `.archify-remove-*`
- `*.delivery.json`、`*.finalize*.json`（含 `overview.delivery.json` 等）
- 锁文件

再跑完整 `finalize`，不要只跑单个门。

## 4. 开关

- `ARCHIFY_NOLINK=0`：关补丁，恢复原生 `linkSync`（对比定位）。
- `ARCHIFY_NOLINK_DEBUG=1`：打印补丁激活日志。
- `ARCHIFY_CHROME` 为空会报 `viewer/chrome-unavailable`，
  这是缺浏览器，不是硬链接问题：装 chromium 或指向 `headless_shell`。
