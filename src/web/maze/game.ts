/**
 * Game state: player, queue, autopilot, mail assignment, live-report sync.
 * Imports world + hud (toast only); render.ts and main.ts read this state.
 */
import { H2, RNG, SUPER, T_FLOOR, astar, mailSpots, pull, type SuperCell } from "./office-gen.ts";
import { SET } from "./settings.ts";
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

  hit(x: number, y: number, r: number): boolean {
    return (
      this.world.wall(Math.floor(x - r), Math.floor(y - r)) ||
      this.world.wall(Math.floor(x + r), Math.floor(y - r)) ||
      this.world.wall(Math.floor(x - r), Math.floor(y + r)) ||
      this.world.wall(Math.floor(x + r), Math.floor(y + r))
    );
  }

  planAuto(): void {
    const PW = 128,
      x0 = Math.floor(this.px) - 64,
      y0 = Math.floor(this.py) - 64;
    const walk = (x: number, y: number): boolean => !this.world.wall(x0 + x, y0 + y);
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
    } else this.path = null;
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
      const ht = document.querySelector(".ht");
      if (ht) ht.textContent = "WASD or arrows to walk · two-finger swipe to turn · Space for auto-walk · M for map · live inbox data";
      if (!msgs.length) toast("Report is empty — the maze stays walkable. Run scan again for fresh data.");
      else toast(msgs.length + " messages loaded — walk into envelopes to queue them. Gold ones are protected.");
    } catch {
      toast("Walk into envelopes to queue them. Gold ones are protected and stay put.");
    }
  }

  update(dt: number, onHud: () => void): void {
    this.wx *= Math.pow(0.02, dt);
    const clq = (v: number): number => Math.max(-1, Math.min(1, v));
    const K = this.keys;
    let f = (K.w || K.arrowup ? 1 : 0) - (K.s || K.arrowdown ? 1 : 0);
    let tr = (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0) + clq(this.wx / 120);
    if (this.aw && (f || tr)) this.setAuto(false);
    if (this.aw) {
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
        const mt = 3.2 * dt;
        this.ang += Math.max(-mt, Math.min(mt, da));
        f = +SET.auto || 0.85;
        this.stuckT += dt;
        if (this.stuckT > 2.5) {
          if (Math.hypot(this.px - this.stuckX, this.py - this.stuckY) < 0.5) this.planAuto();
          this.stuckT = 0;
          this.stuckX = this.px;
          this.stuckY = this.py;
        }
      } else f = 0.2;
    }
    f = Math.max(-1, Math.min(1, f));
    tr = Math.max(-1, Math.min(1, tr));
    const k = Math.min(1, dt * 9);
    this.vf += (f - this.vf) * k;
    this.vt += (tr - this.vt) * k;
    this.ang += this.vt * dt * (+SET.turn || 2.4);
    const nx = this.px + Math.cos(this.ang) * this.vf * (+SET.move || 10) * dt;
    const ny = this.py + Math.sin(this.ang) * this.vf * (+SET.move || 10) * dt;
    if (!this.hit(nx, this.py, 0.3)) this.px = nx;
    if (!this.hit(this.px, ny, 0.3)) this.py = ny;
    this.world.setPlayer(this.px, this.py);
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
        if (m.p) {
          if (!this.kp.has(key)) {
            this.kp.add(key);
            this.KP++;
            toast("Kept safe: " + m.cat.toLowerCase() + " from " + m.from);
            onHud();
          }
        } else {
          this.done.add(key);
          m.key = key;
          this.Q.push(m);
          toast("Queued: " + m.from + " · " + m.sub);
          onHud();
        }
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
