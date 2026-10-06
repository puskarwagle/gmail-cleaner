/**
 * Gunplay: queue-only fire path, cooldown, gold rules, combo table, pellet spread.
 */
import { describe, expect, test } from "bun:test";
import { losClear } from "../src/web/maze/office-gen.ts";
import { World } from "../src/web/maze/world.ts";
import { Game } from "../src/web/maze/game.ts";
import { PTS_TRASH, WEAPONS, comboMult, pelletOffsets } from "../src/web/maze/weapons.ts";

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

function makeGame(seed: number): Game {
  const world = new World(seed);
  const game = new Game(world);
  game.seed = seed;
  world.seed = seed;
  return game;
}

function findTrashLos(seed: number, maxDist: number) {
  const game = makeGame(seed);
  for (let sy = -40; sy <= 40; sy++)
    for (let sx = -40; sx <= 40; sx++) {
      const px = sx + 0.5,
        py = sy + 0.5;
      if (!game.walkW(px, py)) continue;
      for (let ty = sy - maxDist; ty <= sy + maxDist; ty++)
        for (let tx = sx - maxDist; tx <= sx + maxDist; tx++) {
          const m = game.mail(tx, ty);
          if (!m || m.p) continue;
          const mx = tx + 0.5,
            my = ty + 0.5;
          const d = Math.hypot(mx - px, my - py);
          if (d < 0.5 || d > maxDist) continue;
          if (!losClear((x, y) => game.walkW(x, y), px, py, mx, my)) continue;
          game.px = px;
          game.py = py;
          game.ang = Math.atan2(my - py, mx - px);
          return { game, tx, ty, key: tx + "," + ty };
        }
    }
  return null;
}

function findGoldLos(seed: number, maxDist: number) {
  const game = makeGame(seed);
  for (let sy = -40; sy <= 40; sy++)
    for (let sx = -40; sx <= 40; sx++) {
      const px = sx + 0.5,
        py = sy + 0.5;
      if (!game.walkW(px, py)) continue;
      for (let ty = sy - maxDist; ty <= sy + maxDist; ty++)
        for (let tx = sx - maxDist; tx <= sx + maxDist; tx++) {
          const m = game.mail(tx, ty);
          if (!m || !m.p) continue;
          const mx = tx + 0.5,
            my = ty + 0.5;
          const d = Math.hypot(mx - px, my - py);
          if (d < 0.5 || d > maxDist) continue;
          if (!losClear((x, y) => game.walkW(x, y), px, py, mx, my)) continue;
          game.px = px;
          game.py = py;
          game.ang = Math.atan2(my - py, mx - px);
          return { game, tx, ty, key: tx + "," + ty };
        }
    }
  return null;
}

describe("fire (queue-only)", () => {
  test("Stampshot on trashable mail queues it and awards base score", () => {
    const sc = findTrashLos(11, 35);
    expect(sc).not.toBeNull();
    const { game, key } = sc!;
    const fetchSpy = (globalThis as any).fetch;
    let fetchCalls = 0;
    (globalThis as any).fetch = () => {
      fetchCalls++;
      return Promise.reject(new Error("no network"));
    };
    game.weapon = "stamp";
    expect(game.fire(() => {})).toBe(true);
    expect(game.done.has(key)).toBe(true);
    expect(game.score).toBe(PTS_TRASH);
    expect(game.Q.length).toBe(1);
    expect(fetchCalls).toBe(0);
    (globalThis as any).fetch = fetchSpy;
  });

  test("second fire during cooldown returns false", () => {
    const sc = findTrashLos(13, 35);
    expect(sc).not.toBeNull();
    const { game } = sc!;
    game.weapon = "stamp";
    expect(game.fire(() => {})).toBe(true);
    expect(game.fire(() => {})).toBe(false);
  });

  test("Stampshot on gold marks kept, never queues", () => {
    const sc = findGoldLos(5, 35);
    expect(sc).not.toBeNull();
    const { game, key } = sc!;
    game.weapon = "stamp";
    expect(game.fire(() => {})).toBe(true);
    expect(game.kp.has(key)).toBe(true);
    expect(game.KP).toBe(1);
    expect(game.Q.length).toBe(0);
  });

  test("Shredder collateral on gold penalizes score and resets streak", () => {
    const sc = findGoldLos(17, 8);
    expect(sc).not.toBeNull();
    const { game, key } = sc!;
    game.weapon = "shred";
    game.score = 100;
    game.streak = 4;
    game.lastPickT = performance.now();
    expect(game.fire(() => {})).toBe(true);
    expect(game.score).toBe(75);
    expect(game.streak).toBe(0);
    expect(game.kp.has(key)).toBe(false);
    expect(game.Q.length).toBe(0);
  });
});

describe("weapons.ts pure helpers", () => {
  test("comboMult caps at ×5", () => {
    expect(comboMult(1)).toBe(1);
    expect(comboMult(4)).toBe(1);
    expect(comboMult(5)).toBe(2);
    expect(comboMult(9)).toBe(3);
    expect(comboMult(13)).toBe(4);
    expect(comboMult(17)).toBe(5);
    expect(comboMult(100)).toBe(5);
  });

  test("Shredder pellet offsets are deterministic and within the cone", () => {
    const a = pelletOffsets("shred");
    const b = pelletOffsets("shred");
    expect(a).toEqual(b);
    expect(a.length).toBe(WEAPONS.shred.pellets);
    const spreadRad = (WEAPONS.shred.spreadDeg * Math.PI) / 180;
    for (const off of a) expect(Math.abs(off)).toBeLessThanOrEqual(spreadRad + 1e-9);
  });
});
