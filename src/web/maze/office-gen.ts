/**
 * Office floor generator (pure; no DOM, no I/O).
 *
 * Single source of truth for the maze world. `mail-maze.html` embeds the
 * transpiled output of this module between OFFICE-GEN-BEGIN/END
 * (see scripts/build-maze.ts); `tests/office.test.ts` imports this module
 * directly.
 *
 * RULE: no `document`, no `localStorage`, no `fetch`, no `process`.
 * Everything must be a pure function of (seed, x, y).
 */

export const SUPER = 40;
export const T_FLOOR = 0;
export const T_WALL = 1;
export const T_FRAME = 2;

export interface RoomRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  hue: number;
}

export interface Door {
  tx: number;
  ty: number;
  horiz: boolean;
  w: number;
}

export interface SuperCell {
  sx: number;
  sy: number;
  vw: number;
  hw: number;
  mode: string;
  lobby: boolean;
  tiles: Uint8Array;
  roomMap: Int16Array;
  rooms: RoomRect[];
  doors: Door[];
  gaps: Set<string>;
}

export interface TileArea {
  tiles: Uint8Array;
  W: number;
  H: number;
}

export function H2(x: number, y: number, s: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s + seed) | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function RNG(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function corrWidth(line: number, seed: number): number {
  return H2(line, 7919, 31, seed) % 4 === 0 ? 5 : 3;
}

interface Leaf {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Split {
  v: number;
  p: number;
  a: number;
  b: number;
  dc: number;
  dw: number;
}

export function genSuper(sx: number, sy: number, seed: number): SuperCell {
  const N = SUPER,
    vw = corrWidth(sx, seed),
    hw = corrWidth(sy, seed);
  const tiles = new Uint8Array(N * N).fill(T_WALL);
  const roomMap = new Int16Array(N * N).fill(-1);
  const at = (x: number, y: number): number => y * N + x;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x < vw || y < hw) tiles[at(x, y)] = T_FLOOR;
  const lobby = H2(sx, sy, 101, seed) % 10 === 0;
  if (lobby) {
    const L = Math.max(vw, hw) + 2;
    for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) tiles[at(x, y)] = T_FLOOR;
  }
  const gaps = new Set<string>();
  const gk = (lx: number, ly: number): string => sx * N + lx + "," + (sy * N + ly);
  const ix0 = vw + 1,
    iy0 = hw + 1;
  const rng = RNG(H2(sx, sy, 7, seed));
  const pick = H2(sx, sy, 8, seed) % 100;
  const mode = pick < 75 ? "off" : pick < 95 ? "open" : "atrium";
  const leaves: Leaf[] = [],
    splits: Split[] = [];
  let cuts = 0;
  function doorPos(a: number, b: number, dw: number): number {
    const lo = a + 1,
      hi = b - dw - 1;
    if (hi <= lo) return lo;
    return lo + Math.floor(rng() * (hi - lo + 1));
  }
  function rec(x0: number, y0: number, x1: number, y1: number): void {
    const w = x1 - x0,
      h = y1 - y0,
      canV = w >= 13,
      canH = h >= 13;
    let stop: boolean;
    if (mode === "atrium") stop = true;
    else if (mode === "open") stop = cuts >= 4 || (w <= 16 && h <= 16 && rng() < 0.6);
    else stop = w <= 14 && h <= 14;
    if ((!canV && !canH) || stop) {
      leaves.push({ x0, y0, x1, y1 });
      return;
    }
    let v: boolean;
    if (canV && canH) v = w > h ? rng() < 0.75 : rng() < 0.25;
    else v = canV;
    if (v) {
      const p = x0 + 6 + Math.floor(rng() * (x1 - 7 - (x0 + 6) + 1));
      const span = y1 - y0,
        wdw = mode === "open" ? Math.max(2, Math.min(4, span - 2)) : 2 + (rng() < 0.4 ? 1 : 0);
      splits.push({ v: 1, p, a: y0, b: y1, dc: doorPos(y0, y1, wdw), dw: wdw });
      cuts++;
      rec(x0, y0, p, y1);
      rec(p + 1, y0, x1, y1);
    } else {
      const p = y0 + 6 + Math.floor(rng() * (y1 - 7 - (y0 + 6) + 1));
      const span = x1 - x0,
        wdw = mode === "open" ? Math.max(2, Math.min(4, span - 2)) : 2 + (rng() < 0.4 ? 1 : 0);
      splits.push({ v: 0, p, a: x0, b: x1, dc: doorPos(x0, x1, wdw), dw: wdw });
      cuts++;
      rec(x0, y0, x1, p);
      rec(x0, p + 1, x1, y1);
    }
  }
  rec(ix0, iy0, N, N);
  const rooms: RoomRect[] = leaves.map((r, i) => ({
    x0: r.x0,
    y0: r.y0,
    x1: r.x1,
    y1: r.y1,
    cx: (r.x0 + r.x1) / 2,
    cy: (r.y0 + r.y1) / 2,
    hue: H2(i, (sx * 4096 + sy) | 0, 55, seed) % 360,
  }));
  rooms.forEach((r, i) => {
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) {
      tiles[at(x, y)] = T_FLOOR;
      roomMap[at(x, y)] = i;
    }
  });
  function carveV(x: number, a: number, dc: number, dw: number): void {
    for (let y = dc; y < dc + dw; y++) {
      tiles[at(x, y)] = T_FLOOR;
      gaps.add(gk(x, y));
    }
    if (dc - 1 >= a && tiles[at(x, dc - 1)] === T_WALL) tiles[at(x, dc - 1)] = T_FRAME;
    if (tiles[at(x, dc + dw)] === T_WALL) tiles[at(x, dc + dw)] = T_FRAME;
  }
  function carveH(y: number, a: number, dc: number, dw: number): void {
    for (let x = dc; x < dc + dw; x++) {
      tiles[at(x, y)] = T_FLOOR;
      gaps.add(gk(x, y));
    }
    if (dc - 1 >= a && tiles[at(dc - 1, y)] === T_WALL) tiles[at(dc - 1, y)] = T_FRAME;
    if (tiles[at(dc + dw, y)] === T_WALL) tiles[at(dc + dw, y)] = T_FRAME;
  }
  for (const s of splits) {
    if (s.v) carveV(s.p, s.a, s.dc, s.dw);
    else carveH(s.p, s.a, s.dc, s.dw);
  }
  const doors: Door[] = [];
  function cdoorLeft(r: RoomRect): boolean {
    for (let t = 0; t < 6; t++) {
      const dw = 2 + (rng() < 0.4 ? 1 : 0),
        dr = doorPos(r.y0, r.y1, dw);
      let ok = true;
      for (let y = dr - 1; y <= dr + dw; y++)
        if (gaps.has(gk(vw, y))) {
          ok = false;
          break;
        }
      if (!ok) continue;
      for (let y = dr; y < dr + dw; y++) {
        tiles[at(vw, y)] = T_FLOOR;
        gaps.add(gk(vw, y));
      }
      if (tiles[at(vw, dr - 1)] === T_WALL) tiles[at(vw, dr - 1)] = T_FRAME;
      if (tiles[at(vw, dr + dw)] === T_WALL) tiles[at(vw, dr + dw)] = T_FRAME;
      doors.push({ tx: sx * N + vw, ty: sy * N + dr + (dw >> 1), horiz: false, w: dw });
      return true;
    }
    return false;
  }
  function cdoorTop(r: RoomRect): boolean {
    for (let t = 0; t < 6; t++) {
      const dw = 2 + (rng() < 0.4 ? 1 : 0),
        dc = doorPos(r.x0, r.x1, dw);
      let ok = true;
      for (let x = dc - 1; x <= dc + dw; x++)
        if (gaps.has(gk(x, hw))) {
          ok = false;
          break;
        }
      if (!ok) continue;
      for (let x = dc; x < dc + dw; x++) {
        tiles[at(x, hw)] = T_FLOOR;
        gaps.add(gk(x, hw));
      }
      if (tiles[at(dc - 1, hw)] === T_WALL) tiles[at(dc - 1, hw)] = T_FRAME;
      if (tiles[at(dc + dw, hw)] === T_WALL) tiles[at(dc + dw, hw)] = T_FRAME;
      doors.push({ tx: sx * N + dc + (dw >> 1), ty: sy * N + hw, horiz: true, w: dw });
      return true;
    }
    return false;
  }
  // Every BSP split wall already has a doorway (carved above), so all rooms
  // in the super-cell connect; corridor doors below attach rooms to the
  // corridor grid, which is itself continuous across super-cells.
  const touching = rooms
    .map((r, i) => ({ r, i, left: r.x0 === ix0, top: r.y0 === iy0 }))
    .filter((o) => o.left || o.top);
  let made = 0;
  const withDoor = new Set<number>();
  for (const o of touching) {
    let n = 0;
    if (o.left && rng() < 0.55 && cdoorLeft(o.r)) {
      n++;
      made++;
    }
    if (o.top && rng() < 0.55 && cdoorTop(o.r)) {
      n++;
      made++;
    }
    if (n > 0) withDoor.add(o.i);
  }
  if (made === 0 && touching.length) {
    const o = touching[Math.floor(rng() * touching.length)];
    if (o.left) cdoorLeft(o.r);
    else cdoorTop(o.r);
    made++;
  }
  for (const o of touching) {
    if (withDoor.has(o.i) && rng() < 0.12) {
      if (o.left && o.top) {
        if (rng() < 0.5) cdoorLeft(o.r);
        else cdoorTop(o.r);
      } else if (o.left) cdoorLeft(o.r);
      else cdoorTop(o.r);
    }
  }
  return { sx, sy, vw, hw, mode, lobby, tiles, roomMap, rooms, doors, gaps };
}

export function buildArea(seed: number, x0: number, y0: number, w: number, h: number): TileArea {
  const tiles = new Uint8Array(w * h),
    cache = new Map<string, SuperCell>();
  function cell(sx: number, sy: number): SuperCell {
    const k = sx + "," + sy;
    let c = cache.get(k);
    if (!c) {
      c = genSuper(sx, sy, seed);
      cache.set(k, c);
    }
    return c;
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const wx = x0 + x,
        wy = y0 + y,
        sx = Math.floor(wx / SUPER),
        sy = Math.floor(wy / SUPER),
        c = cell(sx, sy);
      tiles[y * w + x] = c.tiles[(wy - sy * SUPER) * SUPER + (wx - sx * SUPER)] === T_FLOOR ? 0 : 1;
    }
  return { tiles, W: w, H: h };
}

// A* on a tile grid (walk(x,y) in local coords). 8-dir, no corner cutting,
// +6 cost within 1 tile of a wall so paths stay mid-corridor / centred doors.
export function astar(
  W: number,
  H: number,
  walk: (x: number, y: number) => boolean,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
): number[][] | null {
  function ok(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < W && y < H && walk(x, y);
  }
  if (!ok(sx, sy)) return null;
  if (!ok(gx, gy)) {
    let f: number[] | null = null;
    outer: for (let r = 1; r <= 4 && !f; r++)
      for (let dy = -r; dy <= r && !f; dy++)
        for (let dx = -r; dx <= r && !f; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (ok(gx + dx, gy + dy)) f = [gx + dx, gy + dy];
        }
    if (!f) return null;
    gx = f[0];
    gy = f[1];
  }
  const g = new Float64Array(W * H).fill(Infinity),
    px = new Int32Array(W * H).fill(-1),
    closed = new Uint8Array(W * H),
    near = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!walk(x, y)) continue;
      let nw = 0;
      for (let dy = -1; dy <= 1 && !nw; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !walk(nx, ny)) {
            nw = 1;
            break;
          }
        }
      near[y * W + x] = nw;
    }
  const DIRS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.4142],
    [1, -1, 1.4142],
    [-1, 1, 1.4142],
    [-1, -1, 1.4142],
  ];
  const hx: number[] = [],
    hf: number[] = [];
  function push(i: number, v: number): void {
    hx.push(i);
    hf.push(v);
    let c = hx.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hf[p] <= hf[c]) break;
      const ti = hx[p];
      hx[p] = hx[c];
      hx[c] = ti;
      const tv = hf[p];
      hf[p] = hf[c];
      hf[c] = tv;
      c = p;
    }
  }
  function pop(): number {
    const top = hx[0],
      li = hx.length - 1;
    hx[0] = hx[li];
    hf[0] = hf[li];
    hx.pop();
    hf.pop();
    let p = 0;
    for (;;) {
      let c = p * 2 + 1;
      if (c >= hx.length) break;
      if (c + 1 < hx.length && hf[c + 1] < hf[c]) c++;
      if (hf[p] <= hf[c]) break;
      const ti = hx[p];
      hx[p] = hx[c];
      hx[c] = ti;
      const tv = hf[p];
      hf[p] = hf[c];
      hf[c] = tv;
      p = c;
    }
    return top;
  }
  const oct = (x: number, y: number): number => {
    const dx = Math.abs(x - gx),
      dy = Math.abs(y - gy);
    return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
  };
  const s = sy * W + sx,
    goal = gy * W + gx;
  g[s] = 0;
  push(s, oct(sx, sy));
  let found = false,
    iter = 0;
  const maxIter = W * H * 2;
  while (hx.length && iter++ < maxIter) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % W,
      cy = (cur / W) | 0;
    for (let di = 0; di < DIRS.length; di++) {
      const dx = DIRS[di][0],
        dy = DIRS[di][1],
        base = DIRS[di][2];
      const nx = cx + dx,
        ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closed[ni] || !walk(nx, ny)) continue;
      if (dx && dy && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
      const ng = g[cur] + base + (near[ni] ? 6 : 0);
      if (ng < g[ni]) {
        g[ni] = ng;
        px[ni] = cur;
        push(ni, ng + oct(nx, ny));
      }
    }
  }
  if (!found) return null;
  const path: number[][] = [];
  let c = goal;
  while (c !== -1) {
    path.push([c % W, (c / W) | 0]);
    c = px[c];
  }
  path.reverse();
  return path;
}

// Line-of-sight with player-radius clearance, then greedy string-pulling.
export function losClear(
  walkR: (x: number, y: number) => boolean,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const dx = bx - ax,
    dy = by - ay,
    d = Math.hypot(dx, dy),
    steps = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 0; i <= steps; i++) {
    const x = ax + (dx * i) / steps,
      y = ay + (dy * i) / steps;
    if (!walkR(x - 0.3, y - 0.3) || !walkR(x + 0.3, y - 0.3) || !walkR(x - 0.3, y + 0.3) || !walkR(x + 0.3, y + 0.3))
      return false;
  }
  return true;
}

export function pull(walkR: (x: number, y: number) => boolean, path: number[][] | null): number[][] | null {
  if (!path || path.length < 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !losClear(walkR, path[i][0], path[i][1], path[j][0], path[j][1])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}

export interface CastHit {
  d: number;
  side: number;
  t: number;
  mx: number;
  my: number;
}

export function raycast(w: { wall(x: number, y: number): boolean }, px: number, py: number, dx: number, dy: number): CastHit {
  if (!dx) dx = 1e-9;
  if (!dy) dy = 1e-9;
  let mx = Math.floor(px),
    my = Math.floor(py);
  const ax = Math.abs(1 / dx),
    ay = Math.abs(1 / dy);
  let sx: number, sy: number, qx: number, qy: number;
  if (dx < 0) {
    sx = -1;
    qx = (px - mx) * ax;
  } else {
    sx = 1;
    qx = (mx + 1 - px) * ax;
  }
  if (dy < 0) {
    sy = -1;
    qy = (py - my) * ay;
  } else {
    sy = 1;
    qy = (my + 1 - py) * ay;
  }
  let side = 0;
  for (let i = 0; i < 100; i++) {
    if (qx < qy) {
      qx += ax;
      mx += sx;
      side = 0;
    } else {
      qy += ay;
      my += sy;
      side = 1;
    }
    if (w.wall(mx, my)) {
      const d = Math.max(0.05, side ? qy - ay : qx - ax),
        w_val = side ? px + d * dx : py + d * dy;
      return { d, side, t: w_val - Math.floor(w_val), mx, my };
    }
  }
  return { d: 99, side: 0, t: 0, mx, my };
}

// Mail spots: per room + per corridor segment by hash, ~1 per 80 floor tiles
// at density 7 (scaled by SET.density), never inside a doorway gap.
export function mailSpots(sx: number, sy: number, seed: number, density: number): number[][] {
  if (!(density > 0)) return [];
  const c = genSuper(sx, sy, seed),
    rate = density / (7 * 80);
  const rng = RNG((H2(sx, sy, 203, seed) ^ Math.floor(density * 13)) >>> 0);
  const out: number[][] = [];
  function keep(wx: number, wy: number): boolean {
    if ((wx - 1.5) * (wx - 1.5) + (wy - 1.5) * (wy - 1.5) < 9) return false;
    return !c.gaps.has(Math.floor(wx) + "," + Math.floor(wy));
  }
  for (const r of c.rooms) {
    const area = (r.x1 - r.x0) * (r.y1 - r.y0),
      exp = area * rate;
    let k = Math.floor(exp);
    if (rng() < exp - k) k++;
    for (let t = 0; t < k; t++) {
      const x = r.x0 + Math.floor(rng() * (r.x1 - r.x0)),
        y = r.y0 + Math.floor(rng() * (r.y1 - r.y0));
      const wx = sx * SUPER + x,
        wy = sy * SUPER + y;
      if (c.tiles[y * SUPER + x] !== T_FLOOR || !keep(wx, wy)) continue;
      out.push([wx, wy]);
    }
  }
  function seg(x0: number, y0: number, x1: number, y1: number): void {
    const area = (x1 - x0) * (y1 - y0),
      exp = area * rate;
    let k = Math.floor(exp);
    if (rng() < exp - k) k++;
    for (let t = 0; t < k; t++) {
      const x = x0 + Math.floor(rng() * (x1 - x0)),
        y = y0 + Math.floor(rng() * (y1 - y0));
      if (c.tiles[y * SUPER + x] !== T_FLOOR) continue;
      const wx = sx * SUPER + x,
        wy = sy * SUPER + y;
      if (!keep(wx, wy)) continue;
      out.push([wx, wy]);
    }
  }
  for (let y0 = c.hw; y0 < SUPER; y0 += 10) seg(0, y0, c.vw, Math.min(SUPER, y0 + 10));
  for (let x0 = 0; x0 < SUPER; x0 += 10) seg(x0, 0, Math.min(SUPER, x0 + 10), c.hw);
  return out;
}
