/**
 * Playable map mode regression tests.
 *
 * The ported feature makes the fullscreen map navigable: WASD/arrows step
 * north/south/east/west across the floor instead of turning and walking the
 * raycaster forward. These tests pin the parts that are easy to break:
 * heading-independence, heading preservation, wall clamping, mail still being
 * gatherable, and the autopilot being dropped rather than left steering the
 * now-meaningless raycaster heading.
 */
import { describe, expect, test } from "bun:test";
import { World } from "../src/web/maze/world.ts";
import { Game } from "../src/web/maze/game.ts";

const dummyEl = () => ({
  textContent: "",
  value: "",
  disabled: false,
  hidden: false,
  style: {},
  classList: { add() {}, remove() {} },
  setAttribute() {},
});
(globalThis as any).document = {
  getElementById: () => dummyEl(),
  querySelector: () => ({ textContent: "" }),
};

function makeGame(seed = 7): Game {
  const world = new World(seed);
  const game = new Game(world);
  game.seed = seed;
  world.seed = seed;
  return game;
}

/** An open floor tile with room to move in all four directions. */
function openSpot(game: Game): { px: number; py: number } {
  for (let sy = -30; sy <= 30; sy++)
    for (let sx = -30; sx <= 30; sx++) {
      const px = sx + 0.5,
        py = sy + 0.5;
      let clear = true;
      for (let j = -1; j <= 1 && clear; j++)
        for (let i = -1; i <= 1 && clear; i++)
          if (!game.walkW(px + i, py + j)) clear = false;
      if (clear) return { px, py };
    }
  throw new Error("no open spot found");
}

function hold(game: Game, key: string, frames: number): void {
  game.keys[key] = 1;
  for (let i = 0; i < frames; i++) game.update(1 / 60, () => {});
  game.keys[key] = 0;
}

describe("playable map mode movement", () => {
  test("east steps +x regardless of heading, unlike real mode", () => {
    // Real mode: `d` turns, it does not strafe.
    const real = makeGame();
    const rs = openSpot(real);
    real.px = rs.px;
    real.py = rs.py;
    real.ang = 0;
    hold(real, "d", 30);
    expect(Math.abs(real.py - rs.py)).toBeLessThan(1e-6);

    // Map mode: same key walks east no matter which way the player faces.
    for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const map = makeGame();
      const s = openSpot(map);
      map.px = s.px;
      map.py = s.py;
      map.ang = ang;
      map.mapMode = 1;
      hold(map, "d", 30);
      expect(map.px).toBeGreaterThan(s.px + 0.5);
      expect(Math.abs(map.py - s.py)).toBeLessThan(1e-6);
    }
  });

  test("all four directions are screen-independent", () => {
    // Facing "down" (+y) on the map, up/north must still decrease py.
    const game = makeGame();
    const s = openSpot(game);
    game.px = s.px;
    game.py = s.py;
    game.ang = Math.PI / 2;
    game.mapMode = 1;
    hold(game, "w", 30);
    expect(game.py).toBeLessThan(s.py - 0.5);
    expect(Math.abs(game.px - s.px)).toBeLessThan(1e-6);
  });

  test("heading is preserved so the view lines up on switch back", () => {
    const game = makeGame();
    const s = openSpot(game);
    game.px = s.px;
    game.py = s.py;
    game.ang = 1.234;
    game.mapMode = 1;
    hold(game, "d", 60);
    hold(game, "w", 60);
    expect(game.ang).toBe(1.234);
    // Forward/turn velocity decays to zero, so no drift on return.
    expect(game.vf).toBeCloseTo(0, 6);
    expect(game.vt).toBeCloseTo(0, 6);
  });

  test("diagonal input is normalized (no faster diagonal movement)", () => {
    const game = makeGame();
    const s = openSpot(game);
    game.px = s.px;
    game.py = s.py;
    game.ang = 0;
    game.mapMode = 1;
    game.keys.d = 1;
    game.keys.s = 1;
    for (let i = 0; i < 30; i++) game.update(1 / 60, () => {});
    game.keys.d = 0;
    game.keys.s = 0;
    const d = Math.hypot(game.px - s.px, game.py - s.py);
    // 10 tiles/s * 0.5 s, normalized: 5.0 not 5.0*sqrt(2).
    expect(d).toBeGreaterThan(4.5);
    expect(d).toBeLessThan(5.5);
  });

  test("walls clamp movement and slide along them", () => {
    // Find a tile with a wall to the east but open to the north.
    const game = makeGame();
    let found: { px: number; py: number; wallX: number } | null = null;
    for (let sy = -30; sy <= 30 && !found; sy++)
      for (let sx = -30; sx <= 30 && !found; sx++) {
        const px = sx + 0.5,
          py = sy + 0.5;
        if (game.walkW(px, py) && !game.walkW(px + 1, py) && game.walkW(px, py - 1))
          found = { px, py, wallX: sx + 1 };
      }
    expect(found).not.toBeNull();
    const { px, py, wallX } = found!;

    game.px = px;
    game.py = py;
    game.mapMode = 1;
    // Push east into the wall for a second. The 0.3 collision radius lets the
    // player close to the tile edge but never cross into it.
    hold(game, "d", 60);
    expect(game.px).toBeGreaterThan(px);
    expect(game.px).toBeLessThan(wallX - 0.3);
    expect(game.walkW(game.px, game.py)).toBe(true);

    // East+north keeps the north component: sliding, not sticking. Past the
    // wall east opens up again, so only the north leg is pinned here.
    game.keys.d = 1;
    game.keys.w = 1;
    for (let i = 0; i < 60; i++) game.update(1 / 60, () => {});
    game.keys.d = 0;
    game.keys.w = 0;
    expect(game.py).toBeLessThan(py - 0.5);
    expect(game.walkW(game.px, game.py)).toBe(true);
  });

  test("map mode still gathers mail by walking onto it", () => {
    // Trashable mail adjacent to an open tile; walk onto it across the map.
    let placed: { game: Game; px: number; py: number; tx: number; ty: number } | null = null;
    for (let seed = 1; seed <= 40 && !placed; seed++) {
      const g = makeGame(seed);
      for (let sy = -30; sy <= 30 && !placed; sy++)
        for (let sx = -30; sx <= 30 && !placed; sx++) {
          const px = sx + 0.5,
            py = sy + 0.5;
          if (!g.walkW(px, py)) continue;
          // mail() keys off superSpots, not wall state, so the mail tile has
          // to be walkable too or it can never be stepped onto.
          if (!g.walkW(sx + 1, sy)) continue;
          const m = g.mail(sx + 1, sy);
          if (m && !m.p) placed = { game: g, px, py, tx: sx + 1, ty: sy };
        }
    }
    expect(placed).not.toBeNull();
    const { game, px, py, tx, ty } = placed!;
    game.px = px;
    game.py = py;
    game.ang = 0;
    game.mapMode = 1;
    hold(game, "d", 120);
    expect(game.done.has(tx + "," + ty)).toBe(true);
  });

  test("protected mail is kept, never queued, in map mode too", () => {
    let placed: { game: Game; px: number; py: number; tx: number; ty: number } | null = null;
    for (let seed = 1; seed <= 60 && !placed; seed++) {
      const g = makeGame(seed);
      for (let sy = -30; sy <= 30 && !placed; sy++)
        for (let sx = -30; sx <= 30 && !placed; sx++) {
          const px = sx + 0.5,
            py = sy + 0.5;
          if (!g.walkW(px, py)) continue;
          if (!g.walkW(sx + 1, sy)) continue;
          const m = g.mail(sx + 1, sy);
          if (m && m.p) placed = { game: g, px, py, tx: sx + 1, ty: sy };
        }
    }
    expect(placed).not.toBeNull();
    const { game, px, py, tx, ty } = placed!;
    game.px = px;
    game.py = py;
    game.ang = 0;
    game.mapMode = 1;
    hold(game, "d", 120);
    const key = tx + "," + ty;
    // keepMail() records gold in `kp` (not `done`) and bumps the keep counter.
    expect(game.kp.has(key)).toBe(true);
    expect(game.KP).toBe(1);
    // Gold is protected: it must never land in the trash queue.
    expect(game.Q.some((q: { from: string }) => q.from === game.mail(tx, ty)!.from)).toBe(false);
  });

  test("autopilot is dropped on entry instead of steering a dead heading", () => {
    const game = makeGame(103);
    const s = openSpot(game);
    game.px = s.px;
    game.py = s.py;
    game.ang = 0.7;
    game.setAuto(true);
    expect(game.aw).toBe(1);

    game.mapMode = 1;
    game.update(1 / 60, () => {});
    expect(game.aw).toBe(0);
    // No drift: with no keys held, nothing moves and the heading holds.
    const px = game.px,
      py = game.py;
    for (let i = 0; i < 60; i++) game.update(1 / 60, () => {});
    expect(game.px).toBe(px);
    expect(game.py).toBe(py);
    expect(game.ang).toBe(0.7);
  });

  test("real mode is unchanged: w walks forward along the heading", () => {
    const game = makeGame();
    const s = openSpot(game);
    game.px = s.px;
    game.py = s.py;
    game.ang = 0; // +x
    expect(game.mapMode).toBe(0);
    hold(game, "w", 60);
    expect(game.px).toBeGreaterThan(s.px + 1);
    expect(Math.abs(game.py - s.py)).toBeLessThan(0.2);
  });
});
