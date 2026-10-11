# archify-nolink skill

Run [archify](https://github.com/) `finalize` on filesystems where `fs.linkSync`
is blocked (`EACCES` / `EPERM`, e.g. Android Termux on f2fs as `u0_a920` with
SELinux `untrusted_app`, where `rename`/`copyFile`/`symlink`/`unlink` work but
hardlinks fail device-wide).

The fix is a Node preload that emulates hardlinks via copy + virtual
`dev/ino/nlink` groups so archify's atomic-publish identity checks still pass:

- `nolink-preload.mjs` — patches `linkSync` (copy fallback on
  `EACCES/EPERM/EOPNOTSUPP/EXDEV/EROFS`, preserving `EEXIST` no-clobber),
  tracks link groups across `rename`/`unlink`/`rm`, pins open fds to their
  group (`fstat` stays stable after renames), and floors unstable `ino 0` /
  `nlink 0` reports. Propagates to archify child processes via `NODE_OPTIONS`.
- `archify-nolink.sh` — portable wrapper. Set `ARCHIFY_BIN` to your
  `archify/bin/archify.mjs`, optionally `ARCHIFY_CHROME` for `browser-check`:

```sh
ARCHIFY_BIN=/path/to/archify/bin/archify.mjs \
ARCHIFY_CHROME=/path/to/chrome-or-headless_shell \
sh archify-nolink.sh finalize architecture candidate.json overview.html \
  --quality showcase --json
```

## Why the stock flow fails here

archify's atomic publish relies on `fs.linkSync` as a no-clobber primitive
plus `dev/ino/nlink` identity checks. `finalize` publishes the same receipt
path twice (`running`, then final), so the second publish exercises the
previous-output backup path (`backupPublicRegularFileBinding`): single-publish
tests pass while `finalize` fails with
`previous-output-backup-finalization-failed` / `previous-output-identity-changed`.

The preload's copy-emulated links had to survive three things the naive
version missed:

1. The render happens in an archify-spawned child process — the preload must
   ride `NODE_OPTIONS`, not a one-shot `node --import`.
2. A second `rename` over an existing group member must first evict the
   victim's group (real hardlinks replace the name's inode).
3. `fstat` on an open binding fd must report the pinned group identity even
   after the names move (rename/unlink), otherwise the backup-final verify
   sees `identity-changed`.

## Example

`example/` holds a real `finalize` run that passes all four gates with this
shim (`validate` / `deliver` / strict `check` / real-browser `browser-check`):

- `candidate.json` — 13 components / 11 connections / 2 region boundaries,
  `viewBox 1270x712`, `meta.quality_profile: showcase`.
- `overview.html` — delivered artifact (all gates pass).
- `overview.finalize-summary.json`, `overview.browser-check.json` — receipts.

## Debug notes

During development, `backupPublicRegularFileBinding` in isolation passed
(`backed-up`) while a double-publish to the same path failed and left the
target `ENOENT` — that gap is exactly what the fd-pinning + rename-eviction
fixes above close. `ARCHIFY_NOLINK_DEBUG=1` logs preload activation.
`ARCHIFY_NOLINK=0` disables the fallback and restores stock `linkSync`.
