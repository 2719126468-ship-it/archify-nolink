// archify nolink preload: emulate hardlinks via copy + virtual nlink.
// Usage: node --import ./nolink-preload.mjs <archify...> 
// Intercepts fs.linkSync EACCES/EPERM/EOPNOTSUPP and falls back to copy,
// while faking dev/ino/nlink so archify's identity checks still pass.
import fs from 'node:fs';
import path from 'node:path';

const origLink = fs.linkSync;
const origLstat = fs.lstatSync;
const origStat = fs.statSync;
const origFstat = fs.fstatSync;
const origOpen = fs.openSync;
const origClose = fs.closeSync;
const origUnlink = fs.unlinkSync;
const origRename = fs.renameSync;
const origCopy = fs.copyFileSync;
const origChmod = fs.chmodSync;
const origFchmod = fs.fchmodSync;

const NOLINK = process.env.ARCHIFY_NOLINK !== '0';

function res(p) {
  try { return path.resolve(String(p)); } catch { return String(p); }
}

// groupId -> { dev, ino, members:Set }
const groups = new Map();
const pathGroup = new Map();
const fdPath = new Map();
const fdGroup = new Map();
let seq = 1;

function realLstat(p, opts) {
  return origLstat(p, opts);
}

function keyOf(dev, ino) {
  return `${String(dev)}:${String(ino)}`;
}

// Tracks renames so a descriptor opened before a move still reports the
// CURRENT name for that inode (archify verifies by path, but the binding
// identity lives on the old inode). Both old and new spellings must map
// transiently, with the verified live spelling winning lstat.
const pathAlias = new Map(); // staleR -> liveR

function resolveLive(pR) {
  let cur = pR;
  const seen = new Set();
  while (pathAlias.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = pathAlias.get(cur);
  }
  return cur;
}

function getGroup(p) {
  const pR = res(p);
  const direct = pathGroup.get(pR);
  if (direct) return direct;
  // fd opened pre-rename: live path carries the group
  for (const [stale, live] of pathAlias) {
    if (stale === pR) {
      const g = pathGroup.get(live);
      if (g) return g;
    }
    if (live === pR) {
      const g = pathGroup.get(stale);
      if (g) return g;
    }
  }
  return undefined;
}

function groupSize(gid) {
  const g = groups.get(gid);
  return g ? g.members.size : 0;
}

function createGroup(canonicalPath) {
  let st;
  try { st = origLstat(canonicalPath, { bigint: true }); }
  catch { return null; }
  const gid = `vg${seq++}`;
  const g = { dev: st.dev, ino: st.ino, members: new Set([canonicalPath]) };
  groups.set(gid, g);
  pathGroup.set(canonicalPath, gid);
  return gid;
}

function joinGroup(srcR, dstR) {
  let gid = pathGroup.get(srcR);
  if (!gid) gid = createGroup(srcR);
  if (!gid) return null;
  const g = groups.get(gid);
  g.members.add(dstR);
  pathGroup.set(dstR, gid);
  return gid;
}

function leaveGroup(pR) {
  const gid = pathGroup.get(pR);
  if (!gid) return;
  const g = groups.get(gid);
  if (!g) { pathGroup.delete(pR); return; }
  g.members.delete(pR);
  pathGroup.delete(pR);
  if (g.members.size === 0) groups.delete(gid);
}

function fakeStat(st, gid, isBig) {
  const g = groups.get(gid);
  if (!g) return st;
  try {
    st.dev = isBig ? g.dev : Number(g.dev);
    st.ino = isBig ? g.ino : Number(g.ino);
    st.nlink = isBig ? BigInt(g.members.size) : g.members.size;
  } catch {}
  return st;
}

function isBigOpts(o) {
  return !!(o && o.bigint === true);
}

// ---- patch open/close to track fd -> path ----
fs.openSync = function (p, ...rest) {
  const fd = origOpen.call(this, p, ...rest);
  try {
    const pR = res(p);
    fdPath.set(fd, pR);
    const gid = getGroup(p);
    if (gid && groups.has(gid)) fdGroup.set(fd, gid);
  } catch {}
  return fd;
};
fs.closeSync = function (fd) {
  try { fdPath.delete(fd); } catch {}
  try { fdGroup.delete(fd); } catch {}
  return origClose.call(this, fd);
};

// identity floor: some filesystems report ino 0 / nlink 0-1 unstably.
// Give every observed regular file a stable nonzero dev/ino so archify's
// captureRegularFileBinding never hits *-identity-unavailable.
let floorSeq = 1n;
const floorMap = new Map(); // realpath -> { dev, ino }
function floorKey(st) {
  return `${String(st.dev)}:${String(st.ino)}:${String(st.size)}:${String(st.mtimeNs)}`;
}
function floorFor(pR, st) {
  const k = `${pR}::${floorKey(st)}`;
  let f = floorMap.get(k);
  if (!f) {
    f = { dev: 0xA8C41Fn, ino: (BigInt(Date.now() % 1000000) * 1000000n) + (floorSeq++) };
    floorMap.set(k, f);
  }
  return f;
}
function applyFloor(st, pR, isBig) {
  try {
    if (st.ino === 0 || st.ino === 0n) {
      const f = floorFor(pR, st);
      st.dev = isBig ? BigInt(f.dev) : Number(f.dev);
      st.ino = isBig ? f.ino : Number(f.ino & 0xffffffffn);
    }
    if (st.nlink === 0 || st.nlink === 0n) {
      st.nlink = isBig ? 1n : 1;
    }
  } catch {}
  return st;
}

// ---- patch lstat/stat ----
fs.lstatSync = function (p, opts) {
  const st = origLstat.call(this, p, opts);
  const gid = getGroup(p);
  if (gid) return fakeStat(st, gid, isBigOpts(opts));
  return applyFloor(st, res(p), isBigOpts(opts));
};
fs.statSync = function (p, opts) {
  const st = origStat.call(this, p, opts);
  // stat follows symlinks; resolve to real path for group lookup
  let rp = null;
  try { rp = fs.realpathSync.native(String(p)); } catch { rp = res(p); }
  const gid = pathGroup.get(res(rp)) ?? getGroup(p);
  if (gid) return fakeStat(st, gid, isBigOpts(opts));
  return st;
};
fs.fstatSync = function (fd, opts) {
  const st = origFstat.call(this, fd, opts);
  const isBig = isBigOpts(opts);
  // A descriptor pinned to a copy-emulated link group must report the group's
  // virtual identity even after renames/unlinks move the names around.
  // fdGroup is pinned at open; the group survives as long as members exist.
  const pinned = fdGroup.get(fd);
  if (pinned) {
    const g = groups.get(pinned);
    if (g) return fakeStat(st, pinned, isBig);
    fdGroup.delete(fd);
  }
  const p = fdPath.get(fd);
  if (p) {
    const gid = getGroup(p);
    if (gid) {
      fdGroup.set(fd, gid);
      return fakeStat(st, gid, isBig);
    }
  }
  try {
    for (const [gid, g] of groups) {
      if (g.dev === st.dev && g.ino === st.ino) {
        fdGroup.set(fd, gid);
        return fakeStat(st, gid, isBig);
      }
    }
  } catch {}
  if (p) return applyFloor(st, p, isBig);
  return st;
};

// ---- patch rename/unlink to maintain groups ----
fs.renameSync = function (oldP, newP) {
  const oR = res(oldP), nR = res(newP);
  // renaming over an existing path: drop the victim's group first so the
  // live target name is free for the incoming group (real hardlinks would
  // replace the name's inode; our copy emulation must do the same).
  if (pathGroup.has(nR)) leaveGroup(nR);
  pathAlias.delete(nR);
  const r = origRename.call(this, oldP, newP);
  const gid = pathGroup.get(oR);
  if (gid) {
    const g = groups.get(gid);
    if (g) {
      g.members.delete(oR);
      g.members.add(nR);
    }
    pathGroup.delete(oR);
    pathGroup.set(nR, gid);
    // keep old spelling resolving to the group via the live path
    pathAlias.set(oR, nR);
  } else {
    pathAlias.set(oR, nR);
  }
  // fd mappings pointing at old path now point at new path
  for (const [fd, pp] of fdPath) {
    if (pp === oR) fdPath.set(fd, nR);
  }
  return r;
};

fs.unlinkSync = function (p) {
  const r = origUnlink.call(this, p);
  leaveGroup(res(p));
  pathAlias.delete(res(p));
  return r;
};

// ---- patch linkSync with copy fallback ----
fs.linkSync = function (existing, newPath) {
  if (!NOLINK) return origLink.call(this, existing, newPath);
  try {
    return origLink.call(this, existing, newPath);
  } catch (e) {
    const code = e && e.code;
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EOPNOTSUPP' && code !== 'EXDEV' && code !== 'EROFS') throw e;
    const srcR = res(existing), dstR = res(newPath);
    // no-clobber: fail EEXIST if dst exists (match link semantics)
    try {
      origLstat(dstR);
      const err = new Error(`EEXIST: file already exists, link '${existing}' -> '${newPath}'`);
      err.code = 'EEXIST'; err.errno = -17; err.syscall = 'link'; err.path = String(newPath);
      throw err;
    } catch (ee) {
      if (ee && ee.code !== 'ENOENT') throw ee;
    }
    // copy bytes + mode
    origCopy(srcR, dstR);
    try {
      const m = origLstat(srcR).mode & 0o777;
      try { origChmod(dstR, m); } catch {}
    } catch {}
    joinGroup(srcR, dstR);
    return undefined;
  }
};

// rmSync may be used for cleanup; keep groups consistent (best effort)
const origRm = fs.rmSync;
if (typeof origRm === 'function') {
  fs.rmSync = function (p, opts) {
    const r = origRm.call(this, p, opts);
    try { leaveGroup(res(p)); } catch {}
    return r;
  };
}

if (process.env.ARCHIFY_NOLINK_DEBUG === '1') {
  console.error('[nolink-preload] active: linkSync falls back to copy on EACCES/EPERM');
}
