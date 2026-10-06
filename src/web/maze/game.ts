/**
 * Game state: player, queue, autopilot, mail assignment, live-report sync.
 * Imports world + hud (toast only); render.ts and main.ts read this state.
 */
import { H2, RNG, SUPER, T_FLOOR, astar, losClear, mailSpots, pull, raycast, type CastHit, type SuperCell } from "./office-gen.ts";
import { SET } from "./settings.ts";
import { sfxFire, sfxKeep, sfxPenalty, sfxPickup } from "./audio.ts";
import {
  PTS_GOLD,
  PTS_PENALTY,
  PTS_TRASH,
  WEAPONS,
  comboMult,
  pelletOffsets,
} from "./weapons.ts";
import { toast } from "./hud.ts";
import type { World } from "./world.ts";

export interface MailItem {
  key?: string;
  id?: string;
  p?: number;
  cat: string;
  from: string;
  sub: string;
  c: string;
}

export interface ReportMessage {
  id: string;
  from: string;
  subject: string;
  category: string;
  trashCandidate: boolean;
}

const CA: Array<[string, string, string[], string[]]> = [
  ["Newsletter", "#3fb8af", ["digest@newsletter.example"], ["This week in design: 12 links", "Your Sunday reading list"]],
  ["Marketing", "#f2a03d", ["deals@shop.example"], ["48 hours only: 30% off", "We miss you. Come back?"]],
  ["GitHub", "#9a9eff", ["noreply@github.example"], ["Pull request #212 was merged", "New issue opened in repo"]],
  ["Job alert", "#5bb0f0", ["jobs@careers.example"], ["12 new roles match your search", "Your weekly job digest"]],
  ["Social", "#f06d9a", ["notify@social.example"], ["You have 5 new followers", "Someone tagged you in a post"]],
  ["Automated", "#9fb0bf", ["no-reply@system.example"], ["Your report is ready", "Scheduled backup completed"]],
];
const PR: Array<[string, string, string]> = [
  ["Receipt", "noreply@bank.example", "Your statement is ready"],
  ["Security", "security@account.example", "New sign-in to your account"],
  ["Personal", "alex@mail.example", "Dinner on Sunday?"],
];

export const MCOL: Record<string, string> = {
  newsletter: "#3fb8af",
  marketing: "#f2a03d",
  github_notification: "#9a9eff",
  job_alert: "#5bb0f0",
  social_notification: "#f06d9a",
  automated_notification: "#9fb0bf",
};

export function seedH(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tok(): string {
  try {
    return new URLSearchParams(location.search).get("token") || "";
  } catch {
    return "";
  }
}

export function hdrs(): Record<string, string> {
  const t = tok();
  return t ? { "Content-Type": "application/json", "x-maze-token": t } : { "Content-Type": "application/json" };
}

export interface NearestMail {
  key: string;
  x: number;
  y: number;
  dist: number;
  mail: MailItem;
}

function nowMs(): number {
  try {
    if (typeof performance !== "undefined" && performance.now) return performance.now();
  } catch {
    // non-DOM (tests)
  }
  return Date.now();
}

export class Game {
  seed = (Math.random() * 1e9) | 0;
  world: World;

  px = 1.5;
  py = 1.5;
  ang = 0;
  vf = 0;
  vt = 0;
  aw = 0;
  wx = 0;
  /** Playable map mode: movement is top-down instead of raycaster-relative. */
  mapMode = 0;

  path: number[][] | null = null;
  followI = 0;
  stuckT = 0;
  stuckX = 0;
  stuckY = 0;
  planCoolUntil = 0;
  recentT: number[][] = [];

  done = new Set<string>();
  kp = new Set<string>();
  keys: Record<string, number> = {};
  Q: MailItem[] = [];
  T = 0;
  KP = 0;
  LB: MailItem[] = [];

  MSGS: ReportMessage[] | null = null;
  SHUF: ReportMessage[] = [];
  SHUFI = 0;
  INCLEAR = false;
  ASG = new Map<string, MailItem | null>();

  /** Recent pickups for the pop animation (render.ts drains by age). */
  fx: Array<{ t0: number; label: string; color: string; prot: boolean }> = [];
  /** Set once the player dismisses the inbox-clear overlay for this report. */
  DONEACK = false;
  /** Mail tile key the autopilot is currently hunting (drives stuck logic). */
  autoKey: string | null = null;
  lastStuckKey: string | null = null;
  stuckCount = 0;
  /** Tile keys that beat the autopilot twice: ignored for 20 s so it moves on. */
  blacklist = new Map<string, number>();
  /** Sticky close-range hunt target: validated cheaply each frame, re-acquired on demand. */
  huntKey: string | null = null;
  huntX = 0;
  huntY = 0;
  /** Nearest-mail snapshot refreshed by main.ts (~8 Hz) for the compass + guide marker. */
  guide: NearestMail | null = null;

  /** Pickup fly-animation spawns (render.ts projects them, then drains by age). */
  pickups: Array<{ x: number; y: number; t0: number; m: MailItem }> = [];
  /** Consecutive pickups within 3 s: streak counter + rising pickup pitch. */
  streak = 0;
  lastPickT = 0;
  /** Run stats: clock starts on the first step, distance accumulates live. */
  startT: number | null = null;
  dist = 0;
  /** Trashable pickups per category (finish-overlay breakdown). */
  pickedCats = new Map<string, number>();
  /** Wall-clock ms of the first inbox-clear (frozen run time), once. */
  clearMs: number | null = null;
  /** Fog of war: tiles revealed near the player; floor tiles per super-cell. */
  seen = new Set<string>();
  cellSeen = new Map<string, number>();
  private cellWalk = new Map<string, number>();
  private lastSeenT = 0;

  /** Active weapon id (`stamp` | `shred`). */
  weapon = "stamp";
  /** Run score from pickups and trash hits. */
  score = 0;
  /** Cooldown gate: timestamp of last fire. */
  lastFireT = 0;
  /** Muzzle flash decay (0–1). */
  flashT = 0;
  /** Recent impact spark positions for render.ts. */
  sparks: Array<{ x: number; y: number; t0: number; color: string }> = [];

  constructor(world: World) {
    this.world = world;
  }

  // Lazily assign queued messages to mail spots when a super-cell is first
  // generated (order shuffled, seeded RNG). Spots never sit inside doorways.
  assignSuper(o: SuperCell & { assigned?: boolean }): void {
    if (o.assigned || !this.MSGS) return;
    o.assigned = true;
    const spots = mailSpots(o.sx, o.sy, this.seed, SET.density || 7);
    const rr = RNG(H2(o.sx, o.sy, 11, this.seed));
    for (let i = spots.length - 1; i > 0; i--) {
      const k = (rr() * (i + 1)) | 0;
      const tmp = spots[i];
      spots[i] = spots[k];
      spots[k] = tmp;
    }
    for (const sp of spots) {
      const key = sp[0] + "," + sp[1];
      if (this.ASG.has(key)) continue;
      if (this.SHUFI < this.SHUF.length) {
        const m = this.SHUF[this.SHUFI++];
        if (m.trashCandidate)
          this.ASG.set(key, { id: m.id, cat: m.category, c: MCOL[m.category] || "#9fb0bf", from: m.from, sub: m.subject });
        else this.ASG.set(key, { id: m.id, p: 1, cat: m.category, from: m.from, sub: m.subject, c: "#e9c46a" });
      } else this.ASG.set(key, null);
    }
    if (this.SHUFI >= this.SHUF.length && !this.INCLEAR && this.SHUF.length) {
      this.INCLEAR = true;
      toast("Inbox clear — the maze stays walkable.");
    }
  }

  mail(tx: number, ty: number): MailItem | null {
    const sx = Math.floor(tx / SUPER),
      sy = Math.floor(ty / SUPER),
      c = this.world.getSuper(sx, sy);
    if (!this.world.superSpots(c).has(tx + "," + ty)) return null;
    const key = tx + "," + ty;
    if (this.MSGS) {
      if (!this.ASG.has(key)) return null;
      return this.ASG.get(key) as MailItem | null;
    }
    const v = H2(tx, ty, 4, this.seed);
    if (v % 7 === 0) {
      const p = PR[v % 3];
      return { p: 1, cat: p[0], from: p[1], sub: p[2], c: "#e9c46a" };
    }
    const c2 = CA[v % 6];
    return { cat: c2[0], c: c2[1], from: c2[2][0], sub: c2[3][(v >> 3) & 1] };
  }

  walkW(wx: number, wy: number): boolean {
    return !this.world.wall(Math.floor(wx), Math.floor(wy));
  }

  /**
   * Guidance target for the compass + follow-the-dot marker. Same candidate
   * pool as the planner, but scored by distance *and* viewing angle: the mail
   * you are already facing wins over a slightly nearer one behind you through
   * a wall. Small hysteresis keeps the marker from flickering between two
   * equidistant targets. The autopilot planner deliberately keeps using pure
   * distance (it paths there anyway).
   */
  nearestMail(maxDist = 70): NearestMail | null {
    const list = this.collectMailTargets(maxDist, 8);
    if (!list.length) return null;
    let best = list[0],
      bs = Infinity;
    for (const t of list) {
      let rel = Math.atan2(t.y - this.py, t.x - this.px) - this.ang;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      let s = t.dist + 8 * Math.abs(rel) + (t.mail.p ? 8 : 0);
      if (this.guide && this.guide.key === t.key && !this.done.has(t.key)) s -= 4;
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  }

  /** Up to `limit` uncollected mail targets, nearest-first (trashable preferred). */
  collectMailTargets(maxDist = 65, limit = 8): NearestMail[] {
    const out: NearestMail[] = [];
    const psx = Math.floor(this.px / SUPER),
      psy = Math.floor(this.py / SUPER);
    const sr = Math.min(3, Math.ceil(maxDist / SUPER) + 1);
    for (let sy = psy - sr; sy <= psy + sr; sy++)
      for (let sx = psx - sr; sx <= psx + sr; sx++) {
        let c;
        try {
          c = this.world.getSuper(sx, sy);
        } catch {
          continue;
        }
        let spots: Set<string>;
        try {
          spots = this.world.superSpots(c);
        } catch {
          continue;
        }
        for (const key of spots) {
          if (this.done.has(key) || this.kp.has(key)) continue;
          const ci = key.indexOf(",");
          const tx = +key.slice(0, ci),
            ty = +key.slice(ci + 1);
          const dx = tx + 0.5 - this.px,
            dy = ty + 0.5 - this.py;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist || dist < 0.9) continue;
          let m: MailItem | null;
          try {
            m = this.mail(tx, ty);
          } catch {
            continue;
          }
          if (!m) continue;
          out.push({ key, x: tx + 0.5, y: ty + 0.5, dist, mail: m });
        }
      }
    out.sort((a, b) => a.dist + (a.mail.p ? 8 : 0) - (b.dist + (b.mail.p ? 8 : 0)));
    return out.slice(0, limit);
  }

  /**
   * Stuck bookkeeping: replans, and blacklists the hunted mail tile for 20 s
   * after it beats the autopilot twice in a row so it moves on instead of
   * looping into the same wall forever.
   */
  noteStuck(): void {
    const k = this.autoKey;
    if (k && k === this.lastStuckKey) this.stuckCount++;
    else {
      this.stuckCount = 1;
      this.lastStuckKey = k;
    }
    if (k && this.stuckCount >= 2) {
      this.blacklist.set(k, nowMs() + 20000);
      this.stuckCount = 0;
    }
    this.path = null;
    this.planAuto();
    this.stuckT = 0;
    this.stuckX = this.px;
    this.stuckY = this.py;
  }

  /** Revalidate the sticky hunt target without a full spot scan. */
  validateHunt(): NearestMail | null {
    const hk = this.huntKey;
    if (!hk || this.done.has(hk) || this.kp.has(hk)) {
      this.huntKey = null;
      return null;
    }
    const exp = this.blacklist.get(hk);
    if (exp !== undefined && exp > nowMs()) {
      this.huntKey = null;
      return null;
    }
    const dx = this.huntX - this.px,
      dy = this.huntY - this.py,
      dist = Math.hypot(dx, dy);
    if (dist > 12 || dist < 0.5) {
      if (dist > 12) this.huntKey = null;
      return null;
    }
    try {
      if (!losClear((x, y) => this.walkW(x, y), this.px, this.py, this.huntX, this.huntY)) {
        this.huntKey = null;
        return null;
      }
    } catch {
      return null;
    }
    const ci = hk.indexOf(","),
      tx = +hk.slice(0, ci),
      ty = +hk.slice(ci + 1);
    let m: MailItem | null = null;
    try {
      m = this.mail(tx, ty);
    } catch {
      return null;
    }
    if (!m) {
      this.huntKey = null;
      return null;
    }
    return { key: hk, x: this.huntX, y: this.huntY, dist, mail: m };
  }

  /** Nearest unblacklisted mail within maxDist that has clear walking LOS. */
  directMail(maxDist = 9): NearestMail | null {
    let cands: NearestMail[];
    try {
      cands = this.collectMailTargets(maxDist, 3);
    } catch {
      return null;
    }
    const now = nowMs();
    for (const c of cands) {
      const exp = this.blacklist.get(c.key);
      if (exp !== undefined && exp > now) continue;
      try {
        if (losClear((x, y) => this.walkW(x, y), this.px, this.py, c.x, c.y)) return c;
      } catch {
        continue;
      }
    }
    return null;
  }
  /** Live-report progress for the inbox-clear overlay. Null totals = demo mode. */
  progress(): { total: number | null; trashTotal: number | null; gathered: number; kept: number; done: boolean } {
    if (!this.MSGS || !this.MSGS.length) return { total: null, trashTotal: null, gathered: 0, kept: this.KP, done: false };
    const total = this.MSGS.length;
    let trashTotal = 0;
    for (const m of this.MSGS) if (m.trashCandidate) trashTotal++;
    const gathered = this.Q.length + this.T;
    const done = trashTotal > 0 ? gathered >= trashTotal : this.KP >= total;
    return { total, trashTotal, gathered, kept: this.KP, done };
  }

  pushFx(label: string, color: string, prot: boolean): void {
    this.fx.push({ t0: nowMs(), label, color, prot });
    if (this.fx.length > 6) this.fx.splice(0, this.fx.length - 6);
  }

  /**
   * Shared pickup bookkeeping: streak, fly-animation spawn, sfx pitch, and
   * first-clear freeze of the run clock. Called from both pickup branches.
   */
  notePick(m: MailItem, x: number, y: number, prot: boolean): void {
    const n = nowMs();
    this.streak = n - this.lastPickT < 3000 ? this.streak + 1 : 1;
    this.lastPickT = n;
    this.pickups.push({ x, y, t0: n, m });
    if (this.pickups.length > 8) this.pickups.shift();
    if (prot) sfxKeep();
    else sfxPickup(this.streak);
    if (this.clearMs === null && this.MSGS) {
      const p = this.progress();
      if (p.done && p.total) this.clearMs = this.startT === null ? 0 : n - this.startT;
    }
  }

  /** Streak shown on the HUD only while the chain is still alive. */
  streakLive(): number {
    return this.streak >= 2 && nowMs() - this.lastPickT < 3500 ? this.streak : 0;
  }

  /** Run time in ms (frozen at inbox clear once it happens). */
  elapsed(): number {
    if (this.clearMs !== null) return this.clearMs;
    return this.startT === null ? 0 : Math.max(0, nowMs() - this.startT);
  }

  /** Reveal tiles in a radius around the player (fog-of-war map memory). */
  private markSeen(): void {
    const cx = Math.floor(this.px),
      cy = Math.floor(this.py),
      R = 9;
    for (let j = -R; j <= R; j++)
      for (let i = -R; i <= R; i++) {
        if (i * i + j * j > R * R) continue;
        const tx = cx + i,
          ty = cy + j,
          key = tx + "," + ty;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        if (this.world.wall(tx, ty)) continue;
        const ck = Math.floor(tx / SUPER) + "," + Math.floor(ty / SUPER);
        this.cellSeen.set(ck, (this.cellSeen.get(ck) || 0) + 1);
      }
  }

  /** Walkable (floor) tiles in a super-cell, cached forever (cells are immutable). */
  private walkable(sx: number, sy: number): number {
    const ck = sx + "," + sy;
    const hit = this.cellWalk.get(ck);
    if (hit !== undefined) return hit;
    const c = this.world.getSuper(sx, sy);
    let n = 0;
    for (let i = 0; i < c.tiles.length; i++) if (c.tiles[i] === T_FLOOR) n++;
    this.cellWalk.set(ck, n);
    return n;
  }

  /**
   * Exploration progress: floor tiles revealed vs. total floor tiles in every
   * super-cell the player has stepped into (new cells lower it — fog games
   * work this way). Percent is clamped to 100.
   */
  explore(): { seen: number; walk: number; pct: number } {
    let sn = 0,
      wk = 0;
    for (const ck of this.cellSeen.keys()) {
      const ci = ck.indexOf(",");
      sn += this.cellSeen.get(ck) as number;
      wk += this.walkable(+ck.slice(0, ci), +ck.slice(ci + 1));
    }
    if (!wk) return { seen: 0, walk: 0, pct: 0 };
    return { seen: sn, walk: wk, pct: Math.min(100, Math.round((sn / wk) * 100)) };
  }

  /** Finish-overlay run summary (time frozen at clear, distance walked live). */
  runStats(): { timeMs: number; dist: number; cats: Record<string, number>; picked: number; kept: number; score: number } {
    const cats: Record<string, number> = {};
    let picked = 0;
    for (const [k, v] of this.pickedCats) {
      cats[k] = v;
      picked += v;
    }
    return { timeMs: this.elapsed(), dist: this.dist, cats, picked, kept: this.KP, score: this.score };
  }

  private addScore(base: number): number {
    const pts = base * comboMult(this.streak);
    this.score += pts;
    return pts;
  }

  /** Trashable mail: queue + score (walk-over and fire share this). */
  queueMail(m: MailItem, key: string, x: number, y: number, onHud?: () => void): boolean {
    if (this.done.has(key)) return false;
    this.done.add(key);
    m.key = key;
    this.Q.push(m);
    this.notePick(m, x, y, false);
    const pts = this.addScore(PTS_TRASH);
    this.pushFx("+" + pts + " Queued", m.c || "#fff", false);
    this.pickedCats.set(m.cat, (this.pickedCats.get(m.cat) || 0) + 1);
    toast("Queued: " + m.from + " · " + m.sub);
    onHud?.();
    return true;
  }

  /** Protected mail (Stampshot / walk-over): mark kept + score, never queue. */
  keepMail(m: MailItem, key: string, x: number, y: number, onHud?: () => void): boolean {
    if (this.kp.has(key)) return false;
    this.kp.add(key);
    this.KP++;
    this.notePick(m, x, y, true);
    const pts = this.addScore(PTS_GOLD);
    this.pushFx("Kept safe +" + pts, "#e9c46a", true);
    toast("Kept safe: " + m.cat.toLowerCase() + " from " + m.from);
    onHud?.();
    return true;
  }

  /**
   * Fire the active weapon: raycast pellets, queue/keep/penalize mail client-side
   * only (same path as walking into envelopes). Returns false on cooldown.
   */
  fire(onHud?: () => void): boolean {
    const wdef = WEAPONS[this.weapon];
    if (!wdef) return false;
    const n = nowMs();
    if (n - this.lastFireT < wdef.cooldown) return false;
    this.lastFireT = n;
    this.flashT = 1;
    sfxFire(wdef.isStampshot ? "stamp" : "shred");

    const hitKeys = new Set<string>();
    const goldPen = new Set<string>();
    let anyHit = false;

    for (const off of pelletOffsets(this.weapon)) {
      const a = this.ang + off;
      const dx = Math.cos(a),
        dy = Math.sin(a);
      const wall = raycast(this.world, this.px, this.py, dx, dy);
      const maxD = Math.min(wall.d, wdef.range);
      const steps = Math.max(1, Math.ceil(maxD / 0.35));
      let impactX = this.px + dx * maxD;
      let impactY = this.py + dy * maxD;
      let sparkColor = "#9fb0bf";

      for (let si = 0; si <= steps; si++) {
        const t = (si / steps) * maxD;
        const rx = this.px + dx * t,
          ry = this.py + dy * t;
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) {
            const tx = Math.floor(rx) + i,
              ty = Math.floor(ry) + j;
            const key = tx + "," + ty;
            if (hitKeys.has(key)) continue;
            const m = this.mail(tx, ty);
            if (!m) continue;
            const mx = tx + 0.5,
              my = ty + 0.5;
            const vx = mx - this.px,
              vy = my - this.py;
            const tproj = vx * dx + vy * dy;
            if (tproj <= 0.05 || tproj > maxD) continue;
            const perp = Math.abs(vx * dy - vy * dx);
            if (perp > 0.4) continue;
            if (m.p) {
              if (wdef.isStampshot) {
                if (this.keepMail(m, key, mx, my, onHud)) {
                  hitKeys.add(key);
                  impactX = mx;
                  impactY = my;
                  sparkColor = "#e9c46a";
                }
              } else if (!goldPen.has(key)) {
                goldPen.add(key);
                this.streak = 0;
                this.score += PTS_PENALTY;
                this.pushFx("−25 Gold hit!", "#f06d9a", true);
                sfxPenalty();
                toast("Gold hit — protected mail stays put (−25)");
                onHud?.();
                anyHit = true;
                impactX = mx;
                impactY = my;
                sparkColor = "#f06d9a";
              }
            } else if (!this.done.has(key)) {
              if (this.queueMail(m, key, mx, my, onHud)) {
                hitKeys.add(key);
                anyHit = true;
                impactX = mx;
                impactY = my;
                sparkColor = m.c || "#fff";
              }
            }
          }
      }
      this.sparks.push({ x: impactX, y: impactY, t0: n, color: sparkColor });
      if (this.sparks.length > 24) this.sparks.splice(0, this.sparks.length - 24);
    }
    return true;
  }

  hit(x: number, y: number, r: number): boolean {
    return (
      this.world.wall(Math.floor(x - r), Math.floor(y - r)) ||
      this.world.wall(Math.floor(x + r), Math.floor(y - r)) ||
      this.world.wall(Math.floor(x - r), Math.floor(y + r)) ||
      this.world.wall(Math.floor(x + r), Math.floor(y + r))
    );
  }

  /**
   * Axis-separated collision clamp. Each axis resolves on its own so a blocked
   * move slides along the wall instead of sticking to it. `y` is re-read from
   * the live position after the x step, so callers can pass a target for one
   * axis at a time.
   */
  private step(x: number, y: number): void {
    if (!this.hit(x, this.py, 0.3)) this.px = x;
    if (!this.hit(this.px, y, 0.3)) this.py = y;
  }

  planAuto(): void {
    const PW = 128,
      x0 = Math.floor(this.px) - 64,
      y0 = Math.floor(this.py) - 64;
    const walk = (x: number, y: number): boolean => !this.world.wall(x0 + x, y0 + y);
    const now = nowMs();
    for (const [k, exp] of this.blacklist) if (exp <= now) this.blacklist.delete(k);
    const tryTarget = (wx: number, wy: number, key: string | null): boolean => {
      const gx = Math.floor(wx) - x0,
        gy = Math.floor(wy) - y0;
      if (gx < 1 || gy < 1 || gx >= PW - 1 || gy >= PW - 1) return false;
      const sxc = Math.floor(this.px) - x0,
        syc = Math.floor(this.py) - y0;
      let p = astar(PW, PW, walk, sxc, syc, gx, gy);
      if (!p || !p.length) return false;
      const world = this;
      p = p.map((q) => [x0 + q[0] + 0.5, y0 + q[1] + 0.5]);
      p = (pull((x, y) => world.walkW(x, y), p) || p) as number[][];
      this.path = p;
      this.followI = 0;
      this.stuckT = 0;
      this.stuckX = this.px;
      this.stuckY = this.py;
      this.autoKey = key;
      this.recentT.push([wx, wy]);
      if (this.recentT.length > 5) this.recentT.shift();
      return true;
    };
    // Prefer real mail: head for the nearest uncollected envelopes first so
    // auto-walk actually cleans the inbox instead of wandering rooms.
    // Close mail is NOT skipped: wandering off when 1 m away was a real bug.
    try {
      const mails = this.collectMailTargets(65, 4);
      for (const m of mails) {
        if (m.dist < 0.5) continue;
        const exp = this.blacklist.get(m.key);
        if (exp !== undefined && exp > now) continue;
        if (tryTarget(m.x, m.y, m.key)) return;
      }
    } catch {
      // fall through to wandering
    }
    const cand: number[][] = [];
    const psx = Math.floor(this.px / SUPER),
      psy = Math.floor(this.py / SUPER);
    for (let sy = psy - 2; sy <= psy + 2; sy++)
      for (let sx = psx - 2; sx <= psx + 2; sx++) {
        const c = this.world.getSuper(sx, sy);
        for (const d of c.doors) {
          const wx = d.tx + 0.5,
            wy = d.ty + 0.5,
            dd = Math.hypot(wx - this.px, wy - this.py);
          if (dd >= 20 && dd <= 60) cand.push([wx, wy]);
        }
        for (const r of c.rooms) {
          const wx = sx * SUPER + r.cx,
            wy = sy * SUPER + r.cy;
          if (this.world.wall(Math.floor(wx), Math.floor(wy))) continue;
          const dd = Math.hypot(wx - this.px, wy - this.py);
          if (dd >= 20 && dd <= 60) cand.push([wx, wy]);
        }
      }
    let tgt: number[] | null = null;
    if (cand.length) {
      let best = cand[0],
        bs = -1e18;
      for (const q of cand) {
        let m = 1e18;
        for (const r of this.recentT) {
          const d = Math.hypot(q[0] - r[0], q[1] - r[1]);
          if (d < m) m = d;
        }
        if (!this.recentT.length) m = Math.hypot(q[0] - this.px, q[1] - this.py);
        const s = m + Math.hypot(q[0] - this.px, q[1] - this.py) * 0.05;
        if (s > bs) {
          bs = s;
          best = q;
        }
      }
      tgt = best;
    } else {
      for (let t = 0; t < 40 && !tgt; t++) {
        const a = Math.random() * 6.2832,
          d = 20 + Math.random() * 40,
          wx = this.px + Math.cos(a) * d,
          wy = this.py + Math.sin(a) * d;
        if (this.walkW(wx, wy)) tgt = [wx, wy];
      }
      if (!tgt) tgt = [this.px + 1, this.py];
    }
    const gx = Math.floor(tgt[0]) - x0,
      gy = Math.floor(tgt[1]) - y0,
      sxc = Math.floor(this.px) - x0,
      syc = Math.floor(this.py) - y0;
    let p = astar(PW, PW, walk, sxc, syc, gx, gy);
    if (!p || !p.length) {
      this.path = null;
      this.planCoolUntil = performance.now() + 2000;
      return;
    }
    const world = this;
    p = p.map((q) => [x0 + q[0] + 0.5, y0 + q[1] + 0.5]);
    p = (pull((x, y) => world.walkW(x, y), p) || p) as number[][];
    this.path = p;
    this.followI = 0;
    this.stuckT = 0;
    this.stuckX = this.px;
    this.stuckY = this.py;
    this.autoKey = null;
    this.recentT.push(tgt);
    if (this.recentT.length > 5) this.recentT.shift();
  }

  setAuto(on: boolean): void {
    this.aw = on ? 1 : 0;
    try {
      document.getElementById("au")?.setAttribute("aria-pressed", on ? "true" : "false");
    } catch {
      // non-DOM (tests)
    }
    if (on) {
      this.path = null;
      this.planAuto();
    } else {
      this.path = null;
      this.autoKey = null;
      this.huntKey = null;
      this.stuckT = 0;
    }
  }

  async loadReport(): Promise<void> {
    try {
      const t = tok();
      const r = await fetch("api/report", { headers: t ? { "x-maze-token": t } : {} });
      if (!r.ok) throw 0;
      const j = await r.json();
      const msgs: ReportMessage[] = j.messages || [];
      this.MSGS = msgs;
      const rr = RNG(seedH(j.generatedAt || "maze"));
      this.SHUF = msgs.slice();
      for (let i = this.SHUF.length - 1; i > 0; i--) {
        const k = (rr() * (i + 1)) | 0;
        const tmp = this.SHUF[i];
        this.SHUF[i] = this.SHUF[k];
        this.SHUF[k] = tmp;
      }
      this.SHUFI = 0;
      this.DONEACK = false;
      this.fx.length = 0;
      this.pickups.length = 0;
      // Fresh report = fresh run: reset streak, clock, stats, and fog.
      this.streak = 0;
      this.startT = null;
      this.dist = 0;
      this.clearMs = null;
      this.pickedCats.clear();
      this.seen.clear();
      this.cellSeen.clear();
      this.cellWalk.clear();
      const ht = document.querySelector(".ht");
      if (ht) ht.textContent = "WASD or arrows to walk · two-finger swipe to turn · Space for auto-walk · click the map · live inbox data";
      if (!msgs.length) toast("Report is empty — the maze stays walkable. Run scan again for fresh data.");
      else toast(msgs.length + " messages loaded — walk into envelopes to queue them. Gold ones are protected.");
    } catch {
      toast("Walk into envelopes to queue them. Gold ones are protected and stay put.");
    }
  }

  update(dt: number, onHud: () => void): void {
    this.flashT = Math.max(0, this.flashT - dt * 5);
    this.wx *= Math.pow(0.02, dt);
    const clq = (v: number): number => Math.max(-1, Math.min(1, v));
    const K = this.keys;
    let f = (K.w || K.arrowup ? 1 : 0) - (K.s || K.arrowdown ? 1 : 0);
    let tr = (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0) + clq(this.wx / 120);
    if (this.aw && (f || tr)) this.setAuto(false);
    // Map mode steers top-down, so the autopilot's raycaster-heading steering
    // has nothing to drive. Drop it on entry rather than leaving it running and
    // spinning the heading arrow while the player cannot move.
    if (this.aw && this.mapMode) this.setAuto(false);
    if (this.aw) {
      // Close visible mail: drive straight at it every frame instead of
      // following a stale A* path. The hunt target is sticky (cheap LOS
      // revalidation); a full spot scan only runs to acquire a new one.
      let direct: NearestMail | null = this.validateHunt();
      if (!direct) {
        direct = this.directMail(9);
        if (direct) {
          this.huntKey = direct.key;
          this.huntX = direct.x;
          this.huntY = direct.y;
        }
      }
      if (direct) {
        this.path = null;
        this.autoKey = direct.key;
        const des = Math.atan2(direct.y - this.py, direct.x - this.px);
        let da = des - this.ang;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const mt = 4.5 * dt;
        this.ang += Math.max(-mt, Math.min(mt, da));
        const align = Math.abs(da);
        const auto = +SET.auto || 0.85;
        f = align > 1.1 ? 0 : auto * (1 - align / 1.1) * Math.max(0.3, Math.min(1, direct.dist / 3));
        this.stuckT += dt;
        if (this.stuckT > 2.5) {
          if (Math.hypot(this.px - this.stuckX, this.py - this.stuckY) < 0.5) this.noteStuck();
          this.stuckT = 0;
          this.stuckX = this.px;
          this.stuckY = this.py;
        }
      } else {
        if (!this.path || this.followI >= this.path.length) {
          if (performance.now() > this.planCoolUntil) this.planAuto();
        }
        if (this.path && this.followI < this.path.length) {
          const last = this.path[this.path.length - 1];
          if (Math.hypot(last[0] - this.px, last[1] - this.py) < 1.2) this.planAuto();
        }
        if (this.path && this.followI < this.path.length) {
          while (this.followI < this.path.length - 1 && Math.hypot(this.path[this.followI][0] - this.px, this.path[this.followI][1] - this.py) < 0.9)
            this.followI++;
          let li = this.followI;
          while (li < this.path.length - 1 && Math.hypot(this.path[li][0] - this.px, this.path[li][1] - this.py) < 2.4) li++;
          const des = Math.atan2(this.path[li][1] - this.py, this.path[li][0] - this.px);
          let da = des - this.ang;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          const mt = 4.0 * dt;
          this.ang += Math.max(-mt, Math.min(mt, da));
          // Don't charge forward while facing away: turn (nearly) in place
          // until aligned. This is what stops the wall-banging arcs.
          const align = Math.abs(da);
          f = align > 1.2 ? 0 : (+SET.auto || 0.85) * (1 - align / 1.2);
          this.stuckT += dt;
          if (this.stuckT > 2.5) {
            if (Math.hypot(this.px - this.stuckX, this.py - this.stuckY) < 0.5) this.noteStuck();
            this.stuckT = 0;
            this.stuckX = this.px;
            this.stuckY = this.py;
          }
        } else f = 0.2;
      }
    }
    f = Math.max(-1, Math.min(1, f));
    tr = Math.max(-1, Math.min(1, tr));
    const k = Math.min(1, dt * 9);
    const ox = this.px,
      oy = this.py;
    if (this.mapMode) {
      // Playable map mode: WASD/arrows step north/south/east/west across the
      // floor. The raycaster smoothing and the heading turn are skipped, so
      // `ang` is untouched and the view lines up on the switch back.
      const ix = (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0);
      const iy = (K.s || K.arrowdown ? 1 : 0) - (K.w || K.arrowup ? 1 : 0);
      if (ix || iy) {
        const il = Math.hypot(ix, iy),
          isp = (+SET.move || 10) * dt;
        this.step(ox + (ix / il) * isp, oy);
        this.step(this.px, oy + (iy / il) * isp);
      }
      this.vf += (0 - this.vf) * k;
      this.vt += (0 - this.vt) * k;
    } else {
      this.vf += (f - this.vf) * k;
      this.vt += (tr - this.vt) * k;
      this.ang += this.vt * dt * (+SET.turn || 2.4);
      const nx = this.px + Math.cos(this.ang) * this.vf * (+SET.move || 10) * dt;
      const ny = this.py + Math.sin(this.ang) * this.vf * (+SET.move || 10) * dt;
      this.step(nx, this.py);
      this.step(this.px, ny);
    }
    const mdx = this.px - ox,
      mdy = this.py - oy,
      md = mdx * mdx + mdy * mdy;
    if (md > 1e-9) {
      if (this.startT === null) this.startT = nowMs();
      this.dist += Math.sqrt(md);
    }
    this.world.setPlayer(this.px, this.py);
    const nt = nowMs();
    if (nt - this.lastSeenT > 100) {
      this.lastSeenT = nt;
      this.markSeen();
    }
    const pcx = Math.floor(this.px),
      pcy = Math.floor(this.py);
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const cx = pcx + i,
          cy = pcy + j,
          m = this.mail(cx, cy),
          key = cx + "," + cy;
        if (!m || this.done.has(key)) continue;
        const ex = cx + 0.5 - this.px,
          ey = cy + 0.5 - this.py;
        if (ex * ex + ey * ey > 0.64) continue;
          if (m.p) this.keepMail(m, key, cx + 0.5, cy + 0.5, onHud);
          else this.queueMail(m, key, cx + 0.5, cy + 0.5, onHud);
      }
  }

  /** Demo-only floor check used by tests (world is injectable). */
  floorAt(tx: number, ty: number): boolean {
    return !this.world.wall(tx, ty);
  }
}

export function demoMailKind(tx: number, ty: number, seed: number): string {
  const v = H2(tx, ty, 4, seed);
  if (v % 7 === 0) return "protected:" + PR[v % 3][0];
  return CA[v % 6][0];
}

export { T_FLOOR };
void SUPER;
