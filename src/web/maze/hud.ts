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

export function toast(m: string): void {
  const e = $("ts");
  e.textContent = m;
  e.classList.add("on");
  clearTimeout(tt);
  tt = setTimeout(() => e.classList.remove("on"), 3500);
}

export function updateHud(s: HudState): void {
  $("st").innerHTML =
    "Queued <b>" + s.queue + "</b> · Trashed <b>" + s.trashed + "</b> · Kept safe <b>" + s.kept + "</b> · " + s.fps + " fps";
  const rv = $("rv") as HTMLButtonElement;
  rv.disabled = !s.queue;
  rv.textContent = "Review " + s.queue + " in queue";
  ($("ud") as HTMLButtonElement).hidden = !s.canUndo;
}
