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
  drawPickups(g, W, Hh, game, t * 1000);
  drawGuide(g, W, Hh, game);
  drawFx(g, W, Hh, game, t * 1000);
}

// Pickup juice: freshly grabbed envelopes rush toward the crosshair, swelling
// and fading over ~450 ms (game.pickups, spawned by notePick, drained by age).
function drawPickups(g: CanvasRenderingContext2D, W: number, Hh: number, game: Game, now: number): void {
  if (!game.pickups.length) return;
  game.pickups = game.pickups.filter((p) => now - p.t0 < 450);
  if (!game.pickups.length) return;
  const dx0 = Math.cos(game.ang),
    dy0 = Math.sin(game.ang),
    fov = Math.max(0.55, Math.min(1, (0.55 * W) / Hh)) * (+SET.fov || 1),
    plx = -dy0 * fov,
    ply = dx0 * fov,
    inv = 1 / (plx * dy0 - dx0 * ply);
  g.save();
  for (const p of game.pickups) {
    const k = Math.min(1, (now - p.t0) / 450),
      ease = k * k;
    const sx = p.x - game.px,
      sy = p.y - game.py,
      tx = inv * (dy0 * sx - dx0 * sy),
      ty = inv * (-ply * sx + plx * sy);
    if (ty < 0.2) continue;
    const s = (Hh / ty) * 0.3,
      X = (W / 2) * (1 + tx / ty),
      Y = Hh / 2 + s * 0.2;
    const X2 = X + (W / 2 - X) * ease,
      Y2 = Y + (Hh * 0.45 - Y) * ease;
    drawEnvelope(g, p.m, X2, Y2, s * (1 + 1.8 * ease), (1 - k) * 0.95, 0);
  }
  g.restore();
}

// Follow-the-dot guide: projects the nearest mail's bearing onto the screen
// (same camera convention as the envelope projection, no wall awareness).
// Turn until the marker sits mid-screen, walk straight, reach mail.
// Behind you it clamps to the screen edge on the correct turn side.
function drawGuide(g: CanvasRenderingContext2D, W: number, Hh: number, game: Game): void {
  const tgt = game.guide;
  if (!tgt || game.done.has(tgt.key)) return;
  const dx = tgt.x - game.px,
    dy = tgt.y - game.py,
    dist = Math.hypot(dx, dy);
  if (dist > 75) return;
  const dx0 = Math.cos(game.ang),
    dy0 = Math.sin(game.ang),
    fov = Math.max(0.55, Math.min(1, (0.55 * W) / Hh)) * (+SET.fov || 1),
    plx = -dy0 * fov,
    ply = dx0 * fov,
    inv = 1 / (plx * dy0 - dx0 * ply);
  const tx = inv * (dy0 * dx - dx0 * dy),
    ty = inv * (-ply * dx + plx * dy);
  const behind = ty < 0.5;
  let X = behind ? (tx >= 0 ? W - 30 : 30) : (W / 2) * (1 + tx / ty);
  X = Math.max(24, Math.min(W - 24, X));
  const Y = Hh * 0.4,
    col = tgt.mail.p ? "#e9c46a" : tgt.mail.c || "#fff",
    r = Math.max(7, Math.min(11, W * 0.014));
  g.save();
  g.globalAlpha = 0.95;
  g.fillStyle = "rgba(5,8,12,.72)";
  g.beginPath();
  g.arc(X, Y, r + 4, 0, 6.3);
  g.fill();
  g.fillStyle = col;
  g.beginPath();
  g.arc(X, Y, r, 0, 6.3);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,.9)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(X, Y, r + 4, 0, 6.3);
  g.stroke();
  if (behind) {
    // Edge chevron: which way to turn.
    const s = tx >= 0 ? 1 : -1;
    g.fillStyle = "rgba(238,242,245,.9)";
    g.beginPath();
    g.moveTo(X + s * (r + 12), Y);
    g.lineTo(X + s * (r + 4), Y - 6);
    g.lineTo(X + s * (r + 4), Y + 6);
    g.closePath();
    g.fill();
  }
  g.fillStyle = "#eef2f5";
  g.font = "500 " + Math.max(11, Math.min(15, Hh * 0.024)) + "px 'IBM Plex Sans',system-ui,sans-serif";
  g.textAlign = "center";
  g.textBaseline = "top";
  g.fillText(Math.max(1, Math.round(dist)) + "m", X, Y + r + 6);
  g.restore();
}

// Floating pickup pops: "+1 Queued" pills that rise and fade near the
// crosshair for ~1.2 s after each envelope pickup (game.fx, capped at 6).
export function drawFx(
  g: CanvasRenderingContext2D,
  W: number,
  Hh: number,
  game: Game,
  nowMs: number,
): void {
  if (!game.fx.length) return;
  game.fx = game.fx.filter((f) => nowMs - f.t0 < 1300);
  g.save();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cx = W / 2;
  game.fx.forEach((f, idx) => {
    const age = nowMs - f.t0;
    const k = age / 1300;
    const rise = age * 0.045;
    const y = Hh * 0.6 - rise - idx * Math.max(18, Hh * 0.045);
    const pop = age < 160 ? 1 + (1 - age / 160) * 0.35 : 1;
    const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    const fs = Math.max(13, Math.min(22, Hh * 0.032)) * pop;
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.font = "600 " + fs + "px 'IBM Plex Sans',system-ui,sans-serif";
    const label = (f.prot ? "Kept safe " : "+1 ") + f.label;
    const w = g.measureText(label).width + 28;
    const h = fs + 16;
    g.fillStyle = "rgba(5,8,12,.82)";
    g.beginPath();
    const bx = cx - w / 2,
      by = y - h / 2;
    const r = h / 2;
    g.moveTo(bx + r, by);
    g.arcTo(bx + w, by, bx + w, by + h, r);
    g.arcTo(bx + w, by + h, bx, by + h, r);
    g.arcTo(bx, by + h, bx, by, r);
    g.arcTo(bx, by, bx + w, by, r);
    g.closePath();
    g.fill();
    g.fillStyle = f.color;
    g.beginPath();
    g.arc(bx + 14, y, fs * 0.32, 0, 6.3);
    g.fill();
    g.fillStyle = "#eef2f5";
    g.fillText(label, cx + 8, y + 1);
  });
  g.restore();
}
// Bird's-eye view: overhead tiles around the player (walls dim, door frames
// wood, mail as dots, gold squares = protected) plus a heading arrow. ~8 Hz.
// Fog of war: only revealed tiles/dots draw (see drawMapInto).
export function drawMap(
  mx: CanvasRenderingContext2D,
  mm: HTMLCanvasElement,
  game: Game,
  world: World,
): void {
  // Always on: the minimap doubles as the button that opens the full map.
  const S = Math.max(96, Math.min(260, +SET.mapSize || 148));
  if (mm.width !== S) mm.width = mm.height = S;
  const R = Math.max(8, Math.min(40, +SET.mapRange || 24));
  drawMapInto(mx, game, world, R, S);
}

/** Fullscreen tactical map (click the minimap): wide radius, same symbology. */
export function drawBigMap(
  mx: CanvasRenderingContext2D,
  big: HTMLCanvasElement,
  game: Game,
  world: World,
): void {
  const S = Math.max(280, Math.min(620, Math.min(innerWidth, innerHeight) - 40));
  if (big.width !== S) big.width = big.height = S;
  drawMapInto(mx, game, world, 60, S);
}

function drawMapInto(
  mx: CanvasRenderingContext2D,
  game: Game,
  world: World,
  R: number,
  S: number,
): void {
  const n = 2 * R + 1,
    s = S / n,
    ptx = Math.floor(game.px),
    pty = Math.floor(game.py);
  // Fog of war: a tile renders only once revealed (game.seen) or while it is
  // right around the player, so the map fills in as you explore. Mail dots are
  // gated the same way — the compass still guides you to hidden envelopes.
  const vis = (tx: number, ty: number, i: number, j: number): boolean =>
    Math.max(Math.abs(i), Math.abs(j)) <= 6 || game.seen.has(tx + "," + ty);
  mx.fillStyle = "rgba(5,8,12,.94)";
  mx.fillRect(0, 0, S, S);
  for (let j = -R; j <= R; j++)
    for (let i = -R; i <= R; i++) {
      const tx = ptx + i,
        ty = pty + j;
      if (!vis(tx, ty, i, j)) continue;
      const sx = Math.floor(tx / SUPER),
        sy = Math.floor(ty / SUPER),
        c = world.getSuper(sx, sy),
        t = c.tiles[(ty - sy * SUPER) * SUPER + (tx - sx * SUPER)];
      if (t !== 0) {
        mx.fillStyle = t === 2 ? "#a9743c" : "#31404f";
        mx.fillRect((i + R) * s, (j + R) * s, s + 0.5, s + 0.5);
      }
    }
  // Mail across the whole visible range (was radius 14): trashable = circle
  // in category color, protected = gold square. White edge keeps dots legible
  // on dark tiles at small sizes.
  for (let j = -R; j <= R; j++)
    for (let i = -R; i <= R; i++) {
      const cx = ptx + i,
        cy = pty + j;
      if (!vis(cx, cy, i, j)) continue;
      const m = game.mail(cx, cy);
      if (!m || game.done.has(cx + "," + cy)) continue;
      const X = (i + R) * s + s / 2,
        Y = (j + R) * s + s / 2;
      if (X < 0 || Y < 0 || X > S || Y > S) continue;
      const r = Math.max(2, s * 0.42);
      mx.fillStyle = m.p ? "#e9c46a" : m.c || "#fff";
      mx.strokeStyle = "rgba(255,255,255,.85)";
      mx.lineWidth = Math.max(1, s * 0.08);
      if (m.p) {
        mx.fillRect(X - r * 0.8, Y - r * 0.8, r * 1.6, r * 1.6);
        mx.strokeRect(X - r * 0.8, Y - r * 0.8, r * 1.6, r * 1.6);
      } else {
        mx.beginPath();
        mx.arc(X, Y, r, 0, 6.3);
        mx.fill();
        mx.stroke();
      }
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
