/**
 * Cached infinite world: lazy per-super-cell generation over the pure
 * office generator. O(1) tile lookups; door frames (2) count as walls.
 */
import { genSuper, mailSpots, SUPER, T_FLOOR, type SuperCell } from "./office-gen.ts";
import { SET } from "./settings.ts";
import type { TileInfo } from "./textures.ts";

export interface WorldHooks {
  /** Called once per fresh super-cell so game.ts can assign queued mail. */
  onFirstGen?: (cell: SuperCell) => void;
}

export class World {
  seed: number;
  cache = new Map<string, SuperCell & { spots: Set<string> | null; spotDen: number }>();
  px = 1.5;
  py = 1.5;
  hooks: WorldHooks;

  constructor(seed: number, hooks: WorldHooks = {}) {
    this.seed = seed;
    this.hooks = hooks;
  }

  setPlayer(x: number, y: number): void {
    this.px = x;
    this.py = y;
  }

  getSuper(sx: number, sy: number): SuperCell & { spots: Set<string> | null; spotDen: number } {
    const key = sx + "," + sy;
    type C = SuperCell & { spots: Set<string> | null; spotDen: number; assigned?: boolean };
    let o = this.cache.get(key) as C | undefined;
    if (o) {
      if (this.hooks.onFirstGen) this.hooks.onFirstGen(o);
      return o;
    }
    if (this.cache.size > 384) {
      const psx = Math.floor(this.px / SUPER),
        psy = Math.floor(this.py / SUPER);
      for (const [k, v] of this.cache) {
        if (Math.max(Math.abs(v.sx - psx), Math.abs(v.sy - psy)) > 4) {
          this.cache.delete(k);
          if (this.cache.size < 300) break;
        }
      }
      if (this.cache.size > 500) this.cache.clear();
    }
    const fresh = genSuper(sx, sy, this.seed) as C;
    fresh.spots = null;
    fresh.spotDen = -1;
    fresh.assigned = false;
    this.cache.set(key, fresh);
    if (this.hooks.onFirstGen) this.hooks.onFirstGen(fresh);
    return fresh;
  }

  wall(tx: number, ty: number): boolean {
    const sx = Math.floor(tx / SUPER),
      sy = Math.floor(ty / SUPER),
      c = this.getSuper(sx, sy);
    return c.tiles[(ty - sy * SUPER) * SUPER + (tx - sx * SUPER)] !== T_FLOOR;
  }

  infoAt(tx: number, ty: number): TileInfo {
    const sx = Math.floor(tx / SUPER),
      sy = Math.floor(ty / SUPER),
      c = this.getSuper(sx, sy),
      lx = tx - sx * SUPER,
      ly = ty - sy * SUPER,
      o = lx + ly * SUPER,
      t = c.tiles[o];
    if (t === T_FLOOR) {
      const ri = c.roomMap[o];
      return { t, corr: lx < c.vw || ly < c.hw, hue: ri >= 0 ? c.rooms[ri].hue : -1 };
    }
    return { t, corr: false, hue: -1 };
  }

  superSpots(c: SuperCell & { spots: Set<string> | null; spotDen: number }): Set<string> {
    const dn = +SET.density || 0;
    if (c.spotDen !== dn) {
      c.spotDen = dn;
      c.spots = dn > 0 ? new Set(mailSpots(c.sx, c.sy, this.seed, dn).map((p) => p[0] + "," + p[1])) : new Set();
    }
    return c.spots as Set<string>;
  }
}
