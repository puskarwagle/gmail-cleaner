/**
 * Maze entry point (browser only). Wires canvas, input, HUD dialog, trash /
 * undo API calls, and the frame loop. All world/game/render logic is
 * imported; this file only owns DOM + timing.
 */
import { SET, SKEY, applySettingsObject, loadSettings, saveSET } from "./settings.ts";
import { setTheme } from "./textures.ts";
import { World } from "./world.ts";
import { Game, hdrs, tok } from "./game.ts";
import { toast, updateHud } from "./hud.ts";
import { draw, drawMap, type FrameBuffers } from "./render.ts";

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
  updateHud({ queue: game.Q.length, trashed: game.T, kept: game.KP, fps, canUndo: game.LB.length > 0 });
}

function setMap(on: boolean): void {
  SET.minimap = !!on;
  saveSET();
  (document.getElementById("mp") as HTMLButtonElement).setAttribute("aria-pressed", SET.minimap ? "true" : "false");
  drawMap(mx, mm, game, world);
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
addEventListener("keydown", (e: KeyboardEvent) => {
  if (($("dg") as HTMLDialogElement).open) return;
  const k = e.key.toLowerCase();
  if (k == " ") {
    e.preventDefault();
    game.setAuto(!game.aw);
    return;
  }
  if (k == "m") {
    setMap(!SET.minimap);
    return;
  }
  game.keys[k] = 1;
  if (k.startsWith("arrow")) e.preventDefault();
});
addEventListener("keyup", (e: KeyboardEvent) => {
  game.keys[e.key.toLowerCase()] = 0;
});
($("au") as HTMLButtonElement).onclick = () => game.setAuto(!game.aw);
($("mp") as HTMLButtonElement).onclick = () => setMap(!SET.minimap);
($("mp") as HTMLButtonElement).setAttribute("aria-pressed", SET.minimap ? "true" : "false");
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
  }
  requestAnimationFrame(frame);
}

const dg = $("dg") as HTMLDialogElement,
  yes = $("yes") as HTMLInputElement,
  go = $("go") as HTMLButtonElement;
($("rv") as HTMLButtonElement).onclick = () => {
  if (!game.Q.length) return;
  $("dn").textContent = String(game.Q.length);
  $("dl").innerHTML =
    game.Q.slice(-4)
      .map((m) => '<div><span class="mo">' + m.from + "</span>" + m.sub + "</div>")
      .join("") + (game.Q.length > 4 ? "<div>and " + (game.Q.length - 4) + " more</div>" : "");
  yes.value = "";
  go.disabled = true;
  dg.showModal();
  yes.focus();
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
    toast("Moved " + game.LB.length + " messages to Trash. Undo is available.");
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
    toast(
      "Moved " + ok.size + " of " + (ok.size + bad.length) + " to Trash. Undo is available." + (bad.length ? " " + bad.length + " failed: " + (bad[0].error || bad[0].id) : ""),
    );
  } catch (e) {
    toast(String((e as Error)?.message || e));
  }
  go.disabled = true;
};
($("ud") as HTMLButtonElement).onclick = async () => {
  if (game.MSGS) {
    try {
      const r = await fetch("api/undo", { method: "POST", headers: hdrs(), body: "{}" });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j && j.error) || "Undo failed (" + r.status + ")");
      const back = new Set((j.records || []).filter((x: { restored: boolean }) => x.restored).map((x: { id: string }) => x.id));
      let n = 0;
      game.LB = game.LB.filter((m) => {
        if (m.id && back.has(m.id)) {
          if (m.key) game.done.delete(m.key);
          n++;
          return false;
        }
        return true;
      });
      game.T -= n;
      hud();
      toast("Restored " + n + " messages to your Inbox");
      return;
    } catch (e) {
      toast(String((e as Error)?.message || e));
      return;
    }
  }
  game.T -= game.LB.length;
  game.LB.forEach((m) => {
    if (m.key) game.done.delete(m.key);
  });
  toast("Restored " + game.LB.length + " messages to your Inbox");
  game.LB = [];
  hud();
};

hud();
void game.loadReport();
requestAnimationFrame(frame);
