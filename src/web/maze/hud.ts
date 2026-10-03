/**
 * HUD helpers: toast line + queue/trash counters. Takes explicit state so
 * game.ts never touches the DOM directly through this module's update path.
 */

export interface HudState {
  queue: number;
  trashed: number;
  kept: number;
  fps: number;
  canUndo: boolean;
}

function $(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

let tt: ReturnType<typeof setTimeout> | undefined;
let prevQ = -1,
  prevT = -1,
  prevK = -1;
let bumpT: ReturnType<typeof setTimeout> | undefined;

export function toast(m: string): void {
  const e = $("ts");
  e.textContent = m;
  e.classList.add("on");
  clearTimeout(tt);
  tt = setTimeout(() => e.classList.remove("on"), 3500);
}

export interface CompassTarget {
  /** Relative bearing in radians: 0 = ahead, + = to the right. */
  rel: number;
  dist: number;
  color: string;
  label: string;
}

/** Compass pill pointing at the nearest uncollected mail. Null = exploring. */
export function updateCompass(t: CompassTarget | null): void {
  const cp = document.getElementById("cp");
  if (!cp) return;
  const arrow = document.getElementById("ca");
  const txt = document.getElementById("ct");
  const dot = document.getElementById("cdot");
  if (!arrow || !txt || !dot) return;
  if (!t) {
    cp.classList.add("none");
    txt.textContent = "No mail nearby — exploring";
    arrow.style.transform = "rotate(0deg)";
    return;
  }
  cp.classList.remove("none");
  arrow.style.transform = "rotate(" + (t.rel * 180) / Math.PI + "deg)";
  dot.style.background = t.color;
  txt.textContent = t.label + " · " + Math.max(1, Math.round(t.dist)) + "m";
}

export function updateHud(s: HudState): void {
  const st = $("st");
  st.innerHTML =
    "Queued <b>" + s.queue + "</b> · Trashed <b>" + s.trashed + "</b> · Kept safe <b>" + s.kept + "</b> · " + s.fps + " fps";
  // Counter tick: pulse the stat pill on every pickup/trash/undo.
  if (prevQ >= 0 && (s.queue !== prevQ || s.trashed !== prevT || s.kept !== prevK)) {
    st.classList.remove("bump");
    void (st as HTMLElement & { offsetWidth: number }).offsetWidth;
    st.classList.add("bump");
    clearTimeout(bumpT);
    bumpT = setTimeout(() => st.classList.remove("bump"), 350);
  }
  prevQ = s.queue;
  prevT = s.trashed;
  prevK = s.kept;
  const rv = $("rv") as HTMLButtonElement;
  rv.disabled = !s.queue;
  rv.textContent = "Review " + s.queue + " in queue";
  ($("ud") as HTMLButtonElement).hidden = !s.canUndo;
}
