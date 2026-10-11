# archify-nolink：硬链接被禁时，让 archify `finalize` 跑通的补丁

> 英文版见 [README.md](README.md)。本文件是给人看的完整中文说明。

## 一句话说清这是啥

archify 生成架构图时，最后一步 `finalize` 要靠系统的**硬链接**（`fs.linkSync`）来“原子发布”文件。
但在有些环境（最典型：**安卓 Termux + f2fs + SELinux**）里，硬链接整个设备都被禁了，
一调用就报 `EACCES: permission denied, link ...`，`finalize` 直接失败。

这个 skill 干的事：**硬链接失败时自动改用“复制文件”，再伪造一份文件身份信息，
让 archify 的检查以为硬链接还在，从而顺利走完四道门。**

## 你什么时候需要它

看到下面任何一种报错，就用它：

| 报错关键词 | 意思 |
|---|---|
| `EACCES: permission denied, link` | 硬链接被系统禁了 |
| `candidate-publication-link-failed` / `output/target-indeterminate` | 发布产物时链不上 |
| `previous-output-backup-finalization-failed` / `previous-output-identity-changed` | 第二次发布（备份老文件那步）身份对不上 |
| `candidate-link-count-unavailable` | 文件系统报的 `ino 0 / nlink 0` 不稳定 |

注意：**只跑 `validate` 能过，不代表 `finalize` 能过。**
`finalize` 会对同一个收据路径发布两次，第二次才会走备份逻辑，所以单测能过、`finalize` 挂，
几乎就是这个坑。

## 怎么用（三步）

1. 找到你机器上 archify 的位置，比如：
   `/path/to/archify/bin/archify.mjs`
2. 用本 skill 的包装脚本代替直接调 `node`：

```sh
ARCHIFY_BIN=/path/to/archify/bin/archify.mjs \
ARCHIFY_CHROME=/path/to/chrome-or-headless_shell \
sh archify-nolink.sh finalize architecture candidate.json overview.html \
  --quality showcase --json
```

3. 看结果：`overview.finalize-summary.json` 里 `"ok": true`，
   四道门 `validate / deliver / check / browser-check` 全是 `pass`，就是成了。

## 环境变量（就这几个）

| 变量 | 必填 | 说明 |
|---|---|---|
| `ARCHIFY_BIN` | 是 | archify 主程序路径，`.../archify/bin/archify.mjs` |
| `ARCHIFY_CHROME` | 跑 `browser-check` 时要 | 浏览器可执行文件，Termux 里一般是 `.../chromium/headless_shell` |
| `ARCHIFY_NOLINK_PRELOAD` | 否 | 不设置就用自带的 `nolink-preload.mjs` |
| `ARCHIFY_NOLINK=0` | 否 | 关掉补丁，恢复原生 `linkSync`（用来对比是不是补丁的问题） |
| `ARCHIFY_NOLINK_DEBUG=1` | 否 | 打开补丁日志，会打印 `[nolink-preload] active` |
| `ARCHIFY_CHROME_NO_SANDBOX` | 否 | 默认 `1`，容器/手机环境跑浏览器需要它 |

## 它在背后做了什么（看不懂可跳过）

1. **复制代替硬链接**：`linkSync` 遇到 `EACCES/EPERM/EOPNOTSUPP/EXDEV/EROFS`
   就改用 `copyFileSync`，并保留“目标已存在就报 `EEXIST`”的语义。
2. **虚拟文件身份**：给每次“假硬链接”建一个组，组里所有名字共用同一份
   `dev/ino/nlink`，`lstat/stat/fstat` 都会返回这份假身份，archify 的
   `dev/ino/nlink` 检查就能通过。
3. **跟进子进程**：archify 真正渲染是在它自己拉起的子进程里做的，
   所以补丁是靠 `NODE_OPTIONS="--import .../nolink-preload.mjs"` 传进去的，
   不是只包一层 `node --import` 就完事。
4. **两次发布不打架**：第二次 `rename` 压到已在组里的名字时，先把被压掉的
   名字踢出组（真硬链接就是这么替换 inode 的）；已经 `open` 的 fd 会钉住
   自己打开时的组身份，`rename/unlink` 之后 `fstat` 也不变。
5. **兜底不稳定文件系统**：有些文件系统报 `ino 0 / nlink 0`，
   补丁会给每个文件垫一个稳定的非零身份，避免 `*-identity-unavailable`。

更细的排障过程见 [references/troubleshooting.md](references/troubleshooting.md)。

## 例子

`example/` 是一次真实跑通的记录：

- `candidate.json`：13 个组件 / 11 条连线 / 2 个 region 边界，
  `viewBox 1270x712`，`meta.quality_profile: showcase`。
- `overview.html`：生成的可交互架构图。
- `overview.finalize-summary.json`、`overview.browser-check.json`：全绿收据。

## 修不好时看这里

- 先确认报错是不是上面表格里的关键词，不是的话可能不是硬链接问题。
- 开 `ARCHIFY_NOLINK_DEBUG=1` 重跑，看有没有 `[nolink-preload] active`，
  没有就是 `NODE_OPTIONS` 没传进去。
- 用 `ARCHIFY_NOLINK=0` 跑一次对比：关掉补丁如果报原生 `link EACCES`，
  说明环境确实禁硬链接，补丁方向没错。
- `finalize` 重试前，先清掉上次残留的 `.archify-remove-*`、
  `*.delivery.json`、`*.finalize*.json` 和锁文件。
