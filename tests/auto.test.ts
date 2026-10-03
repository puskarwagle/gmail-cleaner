/**
 * Autopilot regression tests (the "bangs on the wall next to visible mail" bug).
 * Simulates Game.update() headlessly with a stubbed document: auto-walk must
 * pick up nearby visible mail even when starting faced away from it, must not
 * wander off when nearly on top of a mail, and must keep gathering over time.
 */
import { describe, expect, test } from "bun:test";
import { World } from "../src/web/maze/world.ts";
import { Game } from "../src/web/maze/game.ts";
import { losClear } from "../src/web/maze/office-gen.ts";

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

/** First floor start with a trashable demo mail dMin..dMax away (optionally LOS-clear). */
function findScenario(seed: number, dMin: number, dMax: number, needLos: boolean) {
  const game = makeGame(seed);
  for (let sy = -30; sy <= 30; sy++)
    for (let sx = -30; sx <= 30; sx++) {
      const px = sx + 0.5,
        py = sy + 0.5;
      if (!game.walkW(px, py)) continue;
      const r = Math.ceil(dMax);
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++) {
          const tx = sx + i,
            ty = sy + j;
          const d = Math.hypot(i, j);
          if (d < dMin || d > dMax) continue;
          const m = game.mail(tx, ty);
          if (!m || m.p) continue;
          const clear = losClear((x, y) => game.walkW(x, y), px, py, tx + 0.5, ty + 0.5);
          if (needLos && !clear) continue;
          return { game, px, py, tx, ty };
        }
    }
  return null;
}

function run(game: Game, seconds: number): void {
  const steps = Math.floor(seconds * 60);
  for (let s = 0; s < steps; s++) game.update(1 / 60, () => {});
}

describe("auto-walk mail hunting", () => {
  test("picks up visible mail 3-8m away while starting faced away", () => {
    // Seeds 2/12/22 failed before the steering fix.
    for (const seed of [1, 2, 12, 22]) {
      const sc = findScenario(seed, 3, 8, true);
      expect(sc).not.toBeNull();
      const { game, px, py, tx, ty } = sc!;
      game.px = px;
      game.py = py;
      game.ang = Math.atan2(py - (ty + 0.5), px - (tx + 0.5)); // facing away
      game.setAuto(true);
      run(game, 20);
      expect(game.done.has(tx + "," + ty)).toBe(true);
    }
  });

  test("does not wander off when nearly on top of mail", () => {
    const sc = findScenario(7, 0.9, 1.5, true);
    expect(sc).not.toBeNull();
    const { game, px, py, tx, ty } = sc!;
    game.px = px;
    game.py = py;
    game.ang = 0;
    game.setAuto(true);
    run(game, 5);
    expect(game.done.has(tx + "," + ty)).toBe(true);
  });

  test("guide prefers the mail you face over a nearer one behind you", () => {
    // Seed 2: mail at (-31,-34) is 4.1m ahead, another at (-28,-27) is 3.6m
    // behind-ish. Pure distance would point at the screen edge; the guide
    // must lock the one in front.
    const game = makeGame(2);
    game.px = -29.5;
    game.py = -29.5;
    game.ang = Math.atan2(-34 + 0.5 - game.py, -31 + 0.5 - game.px);
    const pick = game.nearestMail(70);
    expect(pick).not.toBeNull();
    expect(pick!.key).toBe("-31,-34");
  });

  test("keeps gathering over a 60s roam (no stall loop)", () => {
    const game = makeGame(103);
    game.px = 1.5;
    game.py = 1.5;
    game.ang = 0;
    game.setAuto(true);
    run(game, 60);
    expect(game.Q.length + game.KP).toBeGreaterThanOrEqual(3);
  });
});
