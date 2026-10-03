/**
 * Maze entry point (browser only). Wires canvas, input, HUD dialog, the trash
 * API call, and the frame loop. All world/game/render logic is imported;
 * this file only owns DOM + timing.
 */
import { SET, SKEY, applySettingsObject, loadSettings } from "./settings.ts";
import { setTheme } from "./textures.ts";
import { World } from "./world.ts";
import { Game, hdrs, tok } from "./game.ts";
import { fmtMs, toast, updateCompass, updateHud } from "./hud.ts";
import { sfxClear, sfxTrash, unlockAudio } from "./audio.ts";
import { draw, drawBigMap, drawMap, type FrameBuffers } from "./render.ts";

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

loadSettings();
setTheme(SET.theme | 0);

const seed = (Math.random() * 1e9) | 0;
const world = new World(seed);
const game = new Game(world);
game.seed = seed;
world.seed = seed;
world.hooks.onFirstGen = (cell) => game.assignSuper(cell as Parameters<Game["assignSuper"]>[0]);

const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d") as CanvasRenderingContext2D;
const mm = document.getElementById("mm") as HTMLCanvasElement;
const mx = mm.getContext("2d") as CanvasRenderingContext2D;

let W = 0,
  Hh = 0,
  zb = new Float32Array(0),
  img = g.createImageData(1, 1);
let fps = 0;

function fit(): void {
  W = Math.max(160, Math.round(Math.min(640, innerWidth) * (+SET.quality || 1)));
  Hh = Math.round((W * innerHeight) / innerWidth);
  cv.width = W;
  cv.height = Hh;
  zb = new Float32Array(W);
  img = g.createImageData(W, Hh);
  g.imageSmoothingEnabled = false;
}
addEventListener("resize", fit);
fit();
function hud(): void {
  updateHud({
    queue: game.Q.length,
    trashed: game.T,
    kept: game.KP,
    fps,
    time: fmtMs(game.elapsed()),
    streak: game.streakLive(),
  });
  checkDone();
}

// ---- Personal best (browser-local; fastest full clear wins) ----
const PBKEY = "mailmaze.pb.v1";
interface Pb {
  best: number | null;
  last: number | null;
  clears: number;
}
function loadPB(): Pb {
  try {
    const s = JSON.parse(localStorage.getItem(PBKEY) as string);
    if (s && typeof s === "object") return { best: null, last: null, clears: 0, ...s };
  } catch {
    // first run / privacy mode
  }
  return { best: null, last: null, clears: 0 };
}
function savePB(p: Pb): void {
  try {
    localStorage.setItem(PBKEY, JSON.stringify(p));
  } catch {
    // ignore quota / privacy mode
  }
}
function fmtDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
}

/** Finish-overlay text, built once per clear (records PB + plays fanfare). */
let finishHtml: string | null = null;

function finishText(p: { total: number | null; trashTotal: number | null; gathered: number; kept: number }): string {
  const s = game.runStats();
  const cats = Object.entries(s.cats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => k.charAt(0).toUpperCase() + k.slice(1) + " " + v)
    .join(" · ");
  const ex = game.explore();
  const lines: string[] = [];
  lines.push(
    "Gathered " +
      p.gathered +
      " of " +
      (p.trashTotal ?? p.total) +
      " disposable messages" +
      (p.kept ? " · " + p.kept + " protected kept safe" : "") +
      ".",
  );
  if (s.timeMs > 0) {
    lines.push(
      "Time " + fmtMs(s.timeMs) + " · walked " + fmtDist(s.dist) + " · " + s.picked + " envelopes picked up · explored " + ex.pct + "%.",
    );
  }
  if (cats) lines.push(cats + ".");
  if (s.timeMs > 0) {
    const pb = loadPB();
    const prev = pb.best;
    const best = prev === null || s.timeMs < prev;
    savePB({ best: best ? s.timeMs : prev, last: s.timeMs, clears: pb.clears + 1 });
    sfxClear();
    lines.push(
      best
        ? "★ New personal best" + (prev !== null ? " — was " + fmtMs(prev) : "") + "!"
        : "Personal best " + fmtMs(prev as number) + " · cleared " + (pb.clears + 1) + "× total.",
    );
  }
  lines.push("Review the queue to move them to Trash, or keep walking.");
  return lines.join("<br>");
}

/** Inbox-clear overlay: shows once per report when all trashable mail is gathered. */
function checkDone(): void {
  const wrap = document.getElementById("finwrap");
  if (!wrap) return;
  let p;
  try {
    p = game.progress();
  } catch {
    return;
  }
  if (p.done && p.total && !game.DONEACK) {
    if (finishHtml === null) finishHtml = finishText(p);
    const st = document.getElementById("finst");
    if (st) st.innerHTML = finishHtml;
    wrap.hidden = false;
  } else if (game.DONEACK || !p.done) {
    if (!p.done) {
      game.DONEACK = false;
      finishHtml = null;
      game.clearMs = null; // a re-gather after undo runs a fresh timed clear
    }
    wrap.hidden = true;
  }
}

function hideFin(): void {
  const wrap = document.getElementById("finwrap");
  if (wrap) wrap.hidden = true;
}

addEventListener("storage", (e: StorageEvent) => {
  if (e.key === SKEY) {
    try {
      const s = JSON.parse(e.newValue as string);
      if (s && typeof s === "object") applySettingsObject(s);
    } catch {
      // keep current
    }
    setTheme(SET.theme | 0);
    drawMap(mx, mm, game, world);
  }
});

const bigwrap = $("bigwrap") as HTMLElement;
const big = $("big") as HTMLCanvasElement;
const bigx = big.getContext("2d") as CanvasRenderingContext2D;

/** Big-map footer: progress + fog exploration + personal best. */
function bigStatus(): string {
  try {
    const p = game.progress();
    const ex = game.explore();
    const pb = loadPB();
    const base = p.total == null ? "demo maze" : "gathered " + p.gathered + " / " + (p.trashTotal ?? p.total);
    return base + " · explored " + ex.pct + "%" + (pb.best !== null ? " · best " + fmtMs(pb.best) : "");
  } catch {
    return "";
  }
}
function paintBigStatus(): void {
  const st = document.getElementById("bigst");
  if (st) st.textContent = bigStatus();
}

function setBig(on: boolean): void {
  bigwrap.hidden = !on;
  if (on) {
    try {
      drawBigMap(bigx, big, game, world);
    } catch {
      // world gen is lazy; next frame retries
    }
    paintBigStatus();
  }
}
bigwrap.addEventListener("click", (e) => {
  if (e.target === bigwrap) setBig(false);
});
// The minimap is the map button: clicking it opens (click outside / Esc closes).
mm.addEventListener("click", () => setBig(bigwrap.hidden));

// Trackpad, two fingers only: horizontal swipe turns. Ignores pinch-zoom,
// notched mouse-wheel ticks and single-finger drags (no drag steering).
function twoFinger(e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.deltaMode !== 0) return false;
  const notch = (v: number): boolean => {
    const a = Math.abs(v);
    return a >= 120 && a % 120 === 0;
  };
  if (notch(e.deltaX) || notch(e.deltaY)) return false;
  return !!(e.deltaX || e.deltaY);
}
addEventListener(
  "wheel",
  (e) => {
    if (($("dg") as HTMLDialogElement).open || !twoFinger(e as WheelEvent)) return;
    e.preventDefault();
    // Natural scroll: fingers-left reports +deltaX. Negate so slide-left turns left
    // (SET.flip reverses it for flipped scroll-direction setups).
    game.wx += (SET.flip ? 1 : -1) * (e as WheelEvent).deltaX * (+SET.sens || 1);
  },
  { passive: false },
);
// Autoplay policy: create/resume the audio context on the first gesture.
addEventListener("pointerdown", () => unlockAudio(), { once: true });
addEventListener("keydown", () => unlockAudio(), { once: true });
addEventListener("wheel", () => unlockAudio(), { once: true, passive: true });

addEventListener("keydown", (e: KeyboardEvent) => {
  const k = e.key.toLowerCase();
  const dlg = $("dg") as HTMLDialogElement;
  if (dlg.open) {
    // Esc cancels the trash confirm (native dialog cancel + explicit close).
    if (k == "escape") dlg.close();
    return;
  }
  if (k == "escape") {
    // Esc order: inbox-clear overlay (keep walking) → full map → nothing.
    const fin = document.getElementById("finwrap");
    if (fin && !fin.hidden) {
      game.DONEACK = true;
      hideFin();
      return;
    }
    if (!bigwrap.hidden) {
      setBig(false);
      return;
    }
    return;
  }
  if (k == " ") {
    e.preventDefault();
    game.setAuto(!game.aw);
    return;
  }
  game.keys[k] = 1;
  if (k.startsWith("arrow")) e.preventDefault();
});
addEventListener("keyup", (e: KeyboardEvent) => {
  game.keys[e.key.toLowerCase()] = 0;
});
($("au") as HTMLButtonElement).onclick = () => game.setAuto(!game.aw);
($("st2") as HTMLButtonElement).onclick = () => {
  location.href = "settings?token=" + encodeURIComponent(tok());
};

let last = 0,
  mmT = 0,
  fpsN = 0,
  fpsT = 0;

function frame(ms: number): void {
  const dt = Math.min(0.05, (ms - last) / 1000 || 0);
  last = ms;
  game.update(dt, hud);
  const fb: FrameBuffers = { W, Hh, zb, img };
  draw(g, fb, game, world, ms / 1000);
  fpsN++;
  if (ms - fpsT > 500) {
    fps = ms - fpsT > 0 ? Math.round((fpsN * 1000) / (ms - fpsT)) : 0;
    fpsN = 0;
    fpsT = ms;
    hud();
  }
  if (ms - mmT > 120) {
    mmT = ms;
    drawMap(mx, mm, game, world);
    // Compass + big map refresh at the same ~8 Hz throttle (cheap spot scan).
    try {
      const near = game.nearestMail(70);
      game.guide = near;
      if (!near) {
        updateCompass(null);
      } else {
        let rel = Math.atan2(near.y - game.py, near.x - game.px) - game.ang;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        updateCompass({
          rel,
          dist: near.dist,
          color: near.mail.p ? "#e9c46a" : near.mail.c || "#fff",
          label: (near.mail.p ? "protected" : near.mail.cat) + " " + near.mail.from,
        });
      }
    } catch {
      // ignore compass errors; maze stays walkable
    }
    if (!bigwrap.hidden) {
      try {
        drawBigMap(bigx, big, game, world);
        paintBigStatus();
      } catch {
        // retry next tick
      }
    }
  }
  requestAnimationFrame(frame);
}

const dg = $("dg") as HTMLDialogElement,
  yes = $("yes") as HTMLInputElement,
  go = $("go") as HTMLButtonElement;
function openReview(): void {
  if (!game.Q.length) return;
  hideFin();
  $("dn").textContent = String(game.Q.length);
  // Whole queue, not a sample: #dl is capped at ~4.5 rows and scrolls.
  $("dl").innerHTML = game.Q.map((m) => '<div><span class="mo">' + m.from + "</span>" + m.sub + "</div>").join("");
  yes.value = "";
  go.disabled = true;
  dg.showModal();
  yes.focus();
}
($("rv") as HTMLButtonElement).onclick = openReview;
($("finrv") as HTMLButtonElement).onclick = openReview;
($("finok") as HTMLButtonElement).onclick = () => {
  game.DONEACK = true;
  hideFin();
};
yes.oninput = () => {
  go.disabled = yes.value != "YES";
};
($("no") as HTMLButtonElement).onclick = () => dg.close();
go.onclick = async () => {
  if (!game.Q.length) return;
  if (!game.MSGS || !game.Q.every((m) => m.id)) {
    game.T += game.Q.length;
    game.LB = game.Q.splice(0);
    dg.close();
    hud();
    sfxTrash();
    toast("Moved " + game.LB.length + " messages to Trash. Undo last run lives in Settings (⚙).");
    return;
  }
  go.disabled = true;
  try {
    const r = await fetch("api/trash", {
      method: "POST",
      headers: hdrs(),
      body: JSON.stringify({ ids: game.Q.map((m) => m.id), confirm:yes.value }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.error) || "Trash failed (" + r.status + ")");
    const ok = new Set((j.records || []).filter((x: { success: boolean }) => x.success).map((x: { id: string }) => x.id));
    const bad = (j.records || []).filter((x: { success: boolean }) => !x.success);
    game.Q.filter((m) => m.id && ok.has(m.id)).forEach((m) => game.LB.push(m));
    const rest = game.Q.filter((m) => !(m.id && ok.has(m.id)));
    game.Q.length = 0;
    rest.forEach((m) => game.Q.push(m));
    game.T += ok.size;
    dg.close();
    hud();
    sfxTrash();
    toast(
      "Moved " + ok.size + " of " + (ok.size + bad.length) + " to Trash. Undo last run lives in Settings (⚙)." + (bad.length ? " " + bad.length + " failed: " + (bad[0].error || bad[0].id) : ""),
    );
  } catch (e) {
    toast(String((e as Error)?.message || e));
  }
  go.disabled = true;
};

// Undo lives on the settings page now (it POSTs /api/undo itself); this tab
// only rebuilds from reports/latest.json when you navigate back.

hud();
void game.loadReport();
requestAnimationFrame(frame);
