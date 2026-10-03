/**
 * Juice + progression tests: pickup streak, fly-animation spawns, fog-of-war
 * exploration, and run stats (clock freeze at clear). Simulates Game.update()
 * headlessly with the same stubbed document as auto.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { World } from "../src/web/maze/world.ts";
import { Game, type MailItem } from "../src/web/maze/game.ts";
import { fmtMs } from "../src/web/maze/hud.ts";

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

const mail = (cat: string): MailItem => ({ cat, from: "x@example", sub: "hi", c: "#fff" });

/** First floor start within dMin..dMax of a trashable demo envelope. */
function findMail(seed: number, dMin: number, dMax: number) {
  const game = makeGame(seed);
  for (let sy = -30; sy <= 30; sy++)
    for (let sx = -30; sx <= 30; sx++) {
      const px = sx + 0.5,
        py = sy + 0.5;
      if (!game.walkW(px, py)) continue;
      const r = Math.ceil(dMax);
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const d = Math.hypot(i, j);
          if (d < dMin || d > dMax) continue;
          const m = game.mail(sx + i, sy + j);
          if (!m || m.p) continue;
          return { game, px, py, tx: sx + i, ty: sy + j };
        }
    }
  return null;
}

describe("pickup streak + fly animation", () => {
  test("walking into mail queues it, starts a streak, and spawns a pickup", () => {
    const sc = findMail(7, 1, 6);
    expect(sc).not.toBeNull();
    const { game, tx, ty } = sc!;
    game.px = tx + 0.5;
    game.py = ty + 0.5;
    game.update(1 / 60, () => {});
    expect(game.done.has(tx + "," + ty)).toBe(true);
    expect(game.streak).toBe(1);
    expect(game.pickups.length).toBe(1);
    expect(game.pickedCats.size).toBe(1);
    expect(game.Q.length).toBe(1);
  });

  test("streak chains inside 3s and resets after a gap", () => {
    const game = makeGame(1);
    game.notePick(mail("newsletter"), 0, 0, false);
    expect(game.streak).toBe(1);
    game.notePick(mail("newsletter"), 0, 0, false);
    expect(game.streak).toBe(2);
    expect(game.streakLive()).toBe(2);
    game.lastPickT -= 4000;
    game.notePick(mail("marketing"), 0, 0, false);
    expect(game.streak).toBe(1);
    expect(game.streakLive()).toBe(0); // chain broke: HUD hides it
    expect(game.pickups.length).toBe(3);
  });
});

describe("fog-of-war exploration", () => {
  test("reveals tiles around the player and reports a bounded percent", async () => {
    const game = makeGame(3);
    game.px = 1.5;
    game.py = 1.5;
    expect(game.explore().pct).toBe(0);
    game.update(1 / 60, () => {});
    await Bun.sleep(150); // reveal throttle is 100 ms
    game.update(1 / 60, () => {});
    expect(game.seen.size).toBeGreaterThan(0);
    const ex = game.explore();
    expect(ex.pct).toBeGreaterThan(0);
    expect(ex.pct).toBeLessThanOrEqual(100);
    expect(ex.walk).toBeGreaterThan(ex.seen); // unfogged remainder remains
  });
});

describe("run stats", () => {
  test("clock starts on first step, freezes at clear, distance accumulates", () => {
    const game = makeGame(9);
    expect(game.elapsed()).toBe(0);
    game.px = 1.5;
    game.py = 1.5;
    game.keys.w = 1;
    game.update(1 / 60, () => {});
    expect(game.startT).not.toBeNull();
    expect(game.dist).toBeGreaterThan(0);
    game.clearMs = 1234;
    expect(game.elapsed()).toBe(1234);
    const s = game.runStats();
    expect(s.timeMs).toBe(1234);
    expect(s.dist).toBeCloseTo(game.dist, 6);
    expect(s.picked).toBe(0);
    expect(s.kept).toBe(0);
  });

  test("fmtMs formats minutes, padded seconds, and hours", () => {
    expect(fmtMs(0)).toBe("0:00");
    expect(fmtMs(65_000)).toBe("1:05");
    expect(fmtMs(3_725_000)).toBe("1:02:05");
  });
});
