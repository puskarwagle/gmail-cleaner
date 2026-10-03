import { describe, expect, test } from "bun:test";

// The office generator's single source of truth is the pure block inside
// mail-maze.html (delimited by OFFICE-GEN-BEGIN/END, no DOM). These tests
// extract that block verbatim and verify its properties, so the shipped game
// logic itself is tested — not a duplicate copy.

const BEGIN = "// ===== OFFICE-GEN-BEGIN";
const END = "// ===== OFFICE-GEN-END";

interface RoomRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  hue: number;
}
interface Door {
  tx: number;
  ty: number;
  horiz: boolean;
  w: number;
}
interface SuperCell {
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
interface OfficeGen {
  SUPER: number;
  T_FLOOR: number;
  T_WALL: number;
  T_FRAME: number;
  H2: (x: number, y: number, s: number, seed: number) => number;
  RNG: (seed: number) => () => number;
  corrWidth: (line: number, seed: number) => number;
  genSuper: (sx: number, sy: number, seed: number) => SuperCell;
  buildArea: (seed: number, x0: number, y0: number, w: number, h: number) => { tiles: Uint8Array; W: number; H: number };
  astar: (
    W: number,
    H: number,
    walk: (x: number, y: number) => boolean,
    sx: number,
    sy: number,
    gx: number,
    gy: number,
  ) => number[][] | null;
  losClear: (walkR: (x: number, y: number) => boolean, ax: number, ay: number, bx: number, by: number) => boolean;
  pull: (walkR: (x: number, y: number) => boolean, path: number[][] | null) => number[][] | null;
  mailSpots: (sx: number, sy: number, seed: number, density: number) => number[][];
}

const html = await Bun.file(new URL("../mail-maze.html", import.meta.url)).text();

function loadGen(): OfficeGen {
  const s = html.indexOf(BEGIN);
  const e = html.indexOf(END);
  if (s < 0 || e < 0 || e <= s) throw new Error("office generator block not found in mail-maze.html");
  const code = html.slice(s, e); // keep the BEGIN marker: it is a full // comment line
  const factory = new Function(
    `${code}\n;return {SUPER,T_FLOOR,T_WALL,T_FRAME,H2,RNG,corrWidth,genSuper,buildArea,astar,losClear,pull,mailSpots};`,
  ) as () => OfficeGen;
  return factory();
}

const G = loadGen();
const SEEDS = [7, 1234, 99991, 20261003, 555];

function floodCount(area: { tiles: Uint8Array; W: number; H: number }, sx: number, sy: number): number {
  const seen = new Uint8Array(area.W * area.H);
  const stack = [sy * area.W + sx];
  seen[sy * area.W + sx] = 1;
  let n = 0;
  while (stack.length) {
    const c = stack.pop() as number;
    n++;
    const cx = c % area.W;
    const cy = (c / area.W) | 0;
    if (cx > 0 && !seen[c - 1] && !area.tiles[c - 1]) {
      seen[c - 1] = 1;
      stack.push(c - 1);
    }
    if (cx < area.W - 1 && !seen[c + 1] && !area.tiles[c + 1]) {
      seen[c + 1] = 1;
      stack.push(c + 1);
    }
    if (cy > 0 && !seen[c - area.W] && !area.tiles[c - area.W]) {
      seen[c - area.W] = 1;
      stack.push(c - area.W);
    }
    if (cy < area.H - 1 && !seen[c + area.W] && !area.tiles[c + area.W]) {
      seen[c + area.W] = 1;
      stack.push(c + area.W);
    }
  }
  return n;
}

describe("office html shell", () => {
  test("generator block exists and old cell maze is gone", () => {
    expect(html).toContain("OFFICE-GEN-BEGIN");
    expect(html).toContain("OFFICE-GEN-END");
    expect(html).not.toContain("openE(");
    expect(html).not.toContain("openS(");
    expect(html).not.toContain("const N=8");
    // wall() is an O(1) lookup into cached super-cell tile arrays
    expect(html).toContain("c.tiles[(ty-sy*SUPER)*SUPER+(tx-sx*SUPER)]");
    // YES-confirm flow and queue-only autopilot preserved
    expect(html).toContain('confirm:yes.value');
    expect(html).toContain("Type YES to continue");
  });
});

describe("office generator purity", () => {
  test("deterministic per (seed, coords), varies by seed", () => {
    const a = G.genSuper(3, -2, 42);
    const b = G.genSuper(3, -2, 42);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.roomMap).toEqual(b.roomMap);
    expect(JSON.stringify(a.rooms)).toBe(JSON.stringify(b.rooms));
    const c = G.genSuper(3, -2, 43);
    expect(c.tiles).not.toEqual(a.tiles);
    const d = G.genSuper(4, -2, 42);
    expect(d.tiles).not.toEqual(a.tiles);
  });

  test("corridor widths are 3 or 5, mains ~1/4 of lines", () => {
    let mains = 0;
    for (let l = -20; l < 20; l++) {
      const w = G.corrWidth(l, 99);
      expect(w === 3 || w === 5).toBe(true);
      if (w === 5) mains++;
    }
    expect(mains).toBeGreaterThan(4);
    expect(mains).toBeLessThan(18);
  });
});

describe("office layout", () => {
  test("corridor bands are floor and line up across super-cell seams", () => {
    for (const seed of SEEDS) {
      for (const L of [-3, -1, 0, 2]) {
        const vw = G.corrWidth(L, seed);
        const hw = G.corrWidth(L, seed);
        // vertical band tiles (local x=1) are floor for every row
        for (let y = -80; y < 120; y += 7) {
          const sx = Math.floor((L * G.SUPER + 1) / G.SUPER);
          void sx;
          const area = G.buildArea(seed, L * G.SUPER + 1, y, 1, 1);
          expect(area.tiles[0]).toBe(0);
        }
        // horizontal band tiles (local y=1) are floor for every column
        for (let x = -80; x < 120; x += 7) {
          const area = G.buildArea(seed, x, L * G.SUPER + 1, 1, 1);
          expect(area.tiles[0]).toBe(0);
        }
        expect(vw === 3 || vw === 5).toBe(true);
        expect(hw === 3 || hw === 5).toBe(true);
      }
    }
  });

  test("office rooms are 6..14 tiles per side", () => {
    for (const seed of SEEDS) {
      let checked = 0;
      for (let sy = -2; sy <= 2 && checked < 4; sy++) {
        for (let sx = -2; sx <= 2 && checked < 4; sx++) {
          const c = G.genSuper(sx, sy, seed);
          if (c.mode !== "off") continue;
          checked++;
          expect(c.rooms.length).toBeGreaterThan(0);
          for (const r of c.rooms) {
            expect(r.x1 - r.x0).toBeGreaterThanOrEqual(6);
            expect(r.y1 - r.y0).toBeGreaterThanOrEqual(6);
            expect(r.x1 - r.x0).toBeLessThanOrEqual(14);
            expect(r.y1 - r.y0).toBeLessThanOrEqual(14);
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
    }
  });

  test("every super-cell has at least one corridor doorway on a floor gap", () => {
    for (const seed of SEEDS) {
      for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
          const c = G.genSuper(sx, sy, seed);
          expect(c.doors.length).toBeGreaterThanOrEqual(1);
          for (const d of c.doors) {
            expect(d.w).toBeGreaterThanOrEqual(2);
            expect(c.gaps.has(`${d.tx},${d.ty}`)).toBe(true);
          }
        }
      }
    }
  });

  test("5x5 super-cell area is fully connected for several seeds", () => {
    for (const seed of SEEDS) {
      const area = G.buildArea(seed, -80, -80, 200, 200);
      let total = 0;
      for (let i = 0; i < area.tiles.length; i++) if (!area.tiles[i]) total++;
      expect(total).toBeGreaterThan(10000);
      // tile (1,1): local (1,1) of super (0,0) is corridor floor (widths >= 3)
      const startX = 1 + 80;
      const startY = 1 + 80;
      expect(area.tiles[startY * area.W + startX]).toBe(0);
      expect(floodCount(area, startX, startY)).toBe(total);
    }
  });
});

describe("office mail placement", () => {
  test("spots are floor, never inside doorways, ~1 per 60-100 tiles", () => {
    for (const seed of SEEDS) {
      let spots = 0;
      let floor = 0;
      for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
          const c = G.genSuper(sx, sy, seed);
          for (let i = 0; i < c.tiles.length; i++) if (c.tiles[i] === G.T_FLOOR) floor++;
          for (const [tx, ty] of G.mailSpots(sx, sy, seed, 7)) {
            spots++;
            const lx = tx - sx * G.SUPER;
            const ly = ty - sy * G.SUPER;
            expect(c.tiles[ly * G.SUPER + lx]).toBe(G.T_FLOOR);
            expect(c.gaps.has(`${tx},${ty}`)).toBe(false);
          }
        }
      }
      const per = floor / Math.max(1, spots);
      expect(per).toBeGreaterThan(50);
      expect(per).toBeLessThan(130);
    }
  });

  test("density 0 yields no spots", () => {
    expect(G.mailSpots(0, 0, 42, 0)).toEqual([]);
  });
});

describe("office autopilot planner", () => {
  test("A* finds a walkable mid-corridor path in a bounded window", () => {
    const seed = 20261003;
    const x0 = -64;
    const y0 = -64;
    const W = 128;
    const H = 128;
    const area = G.buildArea(seed, x0, y0, W, H);
    const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && !area.tiles[y * W + x];
    // start on the corridor near origin, goal ~50 tiles away on floor
    const s = { x: 1 - x0, y: 1 - y0 };
    expect(walk(s.x, s.y)).toBe(true);
    let g = { x: 50 - x0, y: 40 - y0 };
    if (!walk(g.x, g.y)) {
      let found = false;
      for (let r = 1; r <= 6 && !found; r++)
        for (let dy = -r; dy <= r && !found; dy++)
          for (let dx = -r; dx <= r && !found; dx++)
            if (walk(g.x + dx, g.y + dy)) {
              g = { x: g.x + dx, y: g.y + dy };
              found = true;
            }
      expect(found).toBe(true);
    }
    const path = G.astar(W, H, walk, s.x, s.y, g.x, g.y);
    expect(path).not.toBeNull();
    const p = path as number[][];
    expect(p.length).toBeGreaterThan(10);
    for (const [x, y] of p) expect(walk(x, y)).toBe(true);
    const walkR = (wx: number, wy: number) => {
      const ix = Math.floor(wx - x0);
      const iy = Math.floor(wy - y0);
      return walk(ix, iy);
    };
    const world = p.map(([x, y]) => [x0 + x + 0.5, y0 + y + 0.5]);
    const pulled = G.pull(walkR, world) as number[][];
    expect(pulled.length).toBeLessThanOrEqual(world.length);
    expect(pulled.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < pulled.length - 1; i++) {
      expect(G.losClear(walkR, pulled[i][0], pulled[i][1], pulled[i + 1][0], pulled[i + 1][1])).toBe(true);
    }
  });
});
