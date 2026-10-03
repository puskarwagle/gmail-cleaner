/**
 * Raycaster: DDA walls, procedural carpet/ceiling floor casting, envelope
 * sprites, and the bird's-eye minimap. All functions take explicit contexts
 * and state — no module-level canvas globals.
 */
import { SUPER } from "./office-gen.ts";
import { SET } from "./settings.ts";
import { texFor } from "./textures.ts";
import type { Game, MailItem } from "./game.ts";
import type { World } from "./world.ts";

export interface CastHit {
  d: number;
  side: number;
  t: number;
  mx: number;
  my: number;
}

export function cast(world: World, px: number, py: number, dx: number, dy: number): CastHit {
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
    if (world.wall(mx, my)) {
      const d = Math.max(0.05, side ? qy - ay : qx - ax),
        w = side ? px + d * dx : py + d * dy;
      return { d, side, t: w - Math.floor(w), mx, my };
    }
  }
  return { d: 99, side: 0, t: 0, mx, my };
}

export function drawEnvelope(
  g: CanvasRenderingContext2D,
  m: MailItem,
  x: number,
  y: number,
  s: number,
  a: number,
  t: number,
): void {
  g.save();
  g.globalAlpha = a;
  g.translate(x, y);
  g.rotate(Math.sin(t * 1.6 + x) * 0.08);
  g.fillStyle = "rgba(255,255,255,.14)";
  g.beginPath();
  g.arc(0, 0, s * 0.95, 0, 6.3);
  g.fill();
  const w = s * 0.7,
    h = s * 0.48;
  g.fillStyle = m.p ? "#f6e7b4" : "#f3efe6";
  g.fillRect(-w, -h, 2 * w, 2 * h);
  g.strokeStyle = "#7d766a";
  g.lineWidth = Math.max(1, s * 0.04);
  g.strokeRect(-w, -h, 2 * w, 2 * h);
  g.beginPath();
  g.moveTo(-w, -h);
  g.lineTo(0, s * 0.08);
  g.lineTo(w, -h);
  g.stroke();
  g.fillStyle = m.c;
  g.beginPath();
  g.arc(0, s * 0.08, s * 0.13, 0, 6.3);
  g.fill();
  if (m.p) {
    g.fillStyle = "#14171C";
    g.fillRect(-s * 0.07, s * 0.07, s * 0.14, s * 0.1);
    g.strokeStyle = "#14171C";
    g.lineWidth = s * 0.035;
    g.beginPath();
    g.arc(0, s * 0.07, s * 0.045, Math.PI, 0);
    g.stroke();
  }
  g.restore();
}

// Floor + ceiling: procedural carpet/lino and acoustic tile with light
// panels, fogged to black at ~45 tiles so long corridors fade into darkness.
export function renderFloor(
  g: CanvasRenderingContext2D,
  img: ImageData,
  W: number,
  Hh: number,
  world: World,
  px: number,
  py: number,
  ang: number,
): void {
  const d = img.data,
    dirX = Math.cos(ang),
    dirY = Math.sin(ang);
  const fov = Math.max(0.55, Math.min(1, (0.55 * W) / Hh)) * (+SET.fov || 1),
    plx = -dirY * fov,
    ply = dirX * fov;
  const r0x = dirX - plx,
    r0y = dirY - ply,
    r1x = dirX + plx,
    r1y = dirY + ply,
    horizon = Hh >> 1;
  let lsx = 1e9,
    lsy = 1e9,
    lc: ReturnType<World["getSuper"]> | null = null;
  for (let y = 0; y < Hh; y += 2) {
    let p = y - horizon;
    if (p === 0) p = 1;
    const ceil = p < 0,
      ap = p < 0 ? -p : p;
    const raw = 0.5 * Hh / ap,
      far = raw >= 45,
      rowDist = far ? 45 : raw;
    const stepx = (rowDist * (r1x - r0x)) / W,
      stepy = (rowDist * (r1y - r0y)) / W;
    let wx = px + rowDist * r0x,
      wy = py + rowDist * r0y;
    for (let x = 0; x < W; x++) {
      let r: number, gg: number, b: number;
      if (far) {
        r = 5;
        gg = 8;
        b = 12;
      } else {
        const tx = Math.floor(wx),
          ty = Math.floor(wy);
        const sx = Math.floor(tx / SUPER),
          sy = Math.floor(ty / SUPER);
        if (sx !== lsx || sy !== lsy) {
          lsx = sx;
          lsy = sy;
          lc = world.getSuper(sx, sy);
        }
        const cell = lc as NonNullable<typeof lc>;
        const lx = tx - sx * SUPER,
          ly = ty - sy * SUPER;
        const corr = lx < cell.vw || ly < cell.hw;
        const fx = wx - tx,
          fy = wy - ty;
        const ix = (fx * 8) | 0,
          iy = (fy * 8) | 0;
        const spk = (((tx * 31 + ty * 57 + ix * 7 + iy * 13) & 63) - 32) * 0.28;
        if (!ceil) {
          if (corr) {
            const grid = fx < 0.05 || fy < 0.05 ? 0.7 : 1;
            r = (168 * grid + spk) | 0;
            gg = (172 * grid + spk) | 0;
            b = (175 * grid + spk) | 0;
          } else {
            const chk = (tx + ty) & 1 ? 0.93 : 1;
            r = (62 * chk + spk) | 0;
            gg = (66 * chk + spk) | 0;
            b = (80 * chk + spk) | 0;
          }
        } else {
          const lpx = ((tx % 6) + 6) % 6,
            lpy = ((ty % 6) + 6) % 6;
          if (corr && lpx < 2 && lpy < 2) {
            r = 255;
            gg = 248;
            b = 225;
          } else {
            const grid = fx < 0.06 || fy < 0.06 ? 0.78 : 1;
            r = (186 * grid + spk) | 0;
            gg = (189 * grid + spk) | 0;
            b = (192 * grid + spk) | 0;
          }
        }
        let kk = 1 - rowDist / 45;
        if (kk < 0) kk = 0;
        if (!ceil || !(corr && ((tx % 6) + 6) % 6 < 2 && ((ty % 6) + 6) % 6 < 2)) kk = kk * kk;
        else kk = 1 - (1 - kk) * 0.25;
        r = (r * kk) | 0;
        gg = (gg * kk) | 0;
        b = (b * kk) | 0;
      }
      const o4 = (y * W + x) * 4;
      d[o4] = r;
      d[o4 + 1] = gg;
      d[o4 + 2] = b;
      d[o4 + 3] = 255;
      if (y + 1 < Hh) {
        const o5 = o4 + W * 4;
        d[o5] = r;
        d[o5 + 1] = gg;
        d[o5 + 2] = b;
        d[o5 + 3] = 255;
      }
      wx += stepx;
      wy += stepy;
    }
  }
  g.putImageData(img, 0, 0);
}

export interface FrameBuffers {
  W: number;
  Hh: number;
  zb: Float32Array;
  img: ImageData;
}

export function draw(
  g: CanvasRenderingContext2D,
  fb: FrameBuffers,
  game: Game,
  world: World,
  t: number,
): void {
  const { W, Hh, zb } = fb;
  const px = game.px,
    py = game.py,
    ang = game.ang;
  const dx0 = Math.cos(ang),
    dy0 = Math.sin(ang),
    fov = Math.max(0.55, Math.min(1, (0.55 * W) / Hh)) * (+SET.fov || 1),
    plx = -dy0 * fov,
    ply = dx0 * fov;
  renderFloor(g, fb.img, W, Hh, world, px, py, ang);
  for (let x = 0; x < W; x++) {
    const cm = (2 * x) / W - 1;
    const hit = cast(world, px, py, dx0 + plx * cm, dy0 + ply * cm);
    zb[x] = hit.d;
    if (hit.d >= 45) continue;
    const lh = Hh / hit.d,
      top = (Hh - lh) / 2;
    g.drawImage(texFor(hit.mx, hit.my, (tx, ty) => world.infoAt(tx, ty)), (hit.t * 64) | 0, 0, 1, 64, x, top, 1, lh);
    const sh = Math.min(1, hit.d / 45 + (hit.side ? 0.22 : 0));
    if (sh > 0.01) {
      g.fillStyle = "rgba(6,9,13," + sh.toFixed(2) + ")";
      g.fillRect(x, top, 1, lh);
    }
  }
  const pcx = Math.floor(px),
    pcy = Math.floor(py),
    L: Array<[number, MailItem, number, number, number, number]> = [],
    inv = 1 / (plx * dy0 - dx0 * ply);
  const MR = 24;
  for (let j = -MR; j <= MR; j++)
    for (let i = -MR; i <= MR; i++) {
      const cx = pcx + i,
        cy = pcy + j,
        m = game.mail(cx, cy);
      if (!m || game.done.has(cx + "," + cy)) continue;
      const sx = cx + 0.5 - px,
        sy = cy + 0.5 - py,
        tx = inv * (dy0 * sx - dx0 * sy),
        ty = inv * (-ply * sx + plx * sy);
      if (ty < 0.25 || ty > 45) continue;
      const s = (Hh / ty) * 0.3,
        X = (W / 2) * (1 + tx / ty);
      if (X < -s || X > W + s) continue;
      const cl = (c: number): boolean => zb[Math.max(0, Math.min(W - 1, c | 0))] > ty;
      if (!(cl(X) || cl(X - s * 0.6) || cl(X + s * 0.6))) continue;
      L.push([ty, m, X, s, i, j]);
    }
  L.sort((a, b) => b[0] - a[0]);
  for (const e of L)
    drawEnvelope(g, e[1], e[2], Hh / 2 + Math.sin(t * 2 + e[4] * 3 + e[5]) * e[3] * 0.1 + e[3] * 0.2, e[3], Math.max(0.2, 1 - e[0] / 45), t);
}

// Bird's-eye view: overhead tiles around the player (walls dim, door frames
// wood, mail as dots, gold = protected) plus a heading arrow. ~8 Hz.
export function drawMap(
  mx: CanvasRenderingContext2D,
  mm: HTMLCanvasElement,
  game: Game,
  world: World,
): void {
  if (!SET.minimap) {
    mm.style.display = "none";
    return;
  }
  mm.style.display = "block";
  const S = Math.max(96, Math.min(260, +SET.mapSize || 148));
  if (mm.width !== S) mm.width = mm.height = S;
  const R = Math.max(8, Math.min(40, +SET.mapRange || 24)),
    n = 2 * R + 1,
    s = S / n,
    ptx = Math.floor(game.px),
    pty = Math.floor(game.py);
  mx.fillStyle = "rgba(5,8,12,.9)";
  mx.fillRect(0, 0, S, S);
  for (let j = -R; j <= R; j++)
    for (let i = -R; i <= R; i++) {
      const tx = ptx + i,
        ty = pty + j;
      const sx = Math.floor(tx / SUPER),
        sy = Math.floor(ty / SUPER),
        c = world.getSuper(sx, sy),
        t = c.tiles[(ty - sy * SUPER) * SUPER + (tx - sx * SUPER)];
      if (t !== 0) {
        mx.fillStyle = t === 2 ? "#a9743c" : "#31404f";
        mx.fillRect((i + R) * s, (j + R) * s, s + 0.5, s + 0.5);
      }
    }
  const cr = Math.min(R, 14);
  for (let j = -cr; j <= cr; j++)
    for (let i = -cr; i <= cr; i++) {
      const cx = ptx + i,
        cy = pty + j,
        m = game.mail(cx, cy);
      if (!m || game.done.has(cx + "," + cy)) continue;
      const X = (i + cr) * s + s / 2 + (R - cr) * s,
        Y = (j + cr) * s + s / 2 + (R - cr) * s;
      if (X < 0 || Y < 0 || X > S || Y > S) continue;
      mx.fillStyle = m.p ? "#e9c46a" : m.c || "#fff";
      mx.beginPath();
      mx.arc(X, Y, Math.max(1.5, s * 0.32), 0, 6.3);
      mx.fill();
    }
  mx.save();
  mx.translate(S / 2, S / 2);
  mx.rotate(game.ang);
  mx.fillStyle = "#2fb5a8";
  mx.beginPath();
  mx.moveTo(s * 0.9, 0);
  mx.lineTo(-s * 0.5, -s * 0.55);
  mx.lineTo(-s * 0.5, s * 0.55);
  mx.closePath();
  mx.fill();
  mx.restore();
}
