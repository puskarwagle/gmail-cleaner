/**
 * Procedural wall textures (plaster corridors, tinted office walls, wood door
 * frames). Owns the canvas cache; selection (texFor) takes an info lookup so
 * this module never imports world.ts (no import cycle).
 */
import { SET } from "./settings.ts";
import { T_FLOOR, T_FRAME } from "./office-gen.ts";

export interface TileInfo {
  t: number;
  corr: boolean;
  hue: number;
}

export const THEMES: Array<[number, number, number]> = [
  [12, 205, 38],
  [190, 230, 320],
  [95, 45, 160],
  [0, 0, 0],
];

export const ROOMT = new Map<number, HTMLCanvasElement>();
export let CORR: HTMLCanvasElement[] = [];
export let WOODC: HTMLCanvasElement | null = null;

export function speckle(x: CanvasRenderingContext2D, n: number, amp: number): void {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 2 - 1) * amp;
    x.fillStyle = "rgba(" + (v > 0 ? "255,255,255" : "0,0,0") + "," + (Math.abs(v) / 100).toFixed(3) + ")";
    x.fillRect(Math.random() * 64, Math.random() * 46, 1.5, 1.5);
  }
}

export function plaster(hue: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d") as CanvasRenderingContext2D;
  x.fillStyle = "hsl(" + hue + " 10% 66%)";
  x.fillRect(0, 0, 64, 64);
  speckle(x, 180, 9);
  x.fillStyle = "rgba(0,0,0,.25)";
  x.fillRect(0, 42, 64, 2);
  x.fillStyle = "#22272d";
  x.fillRect(0, 44, 64, 20);
  x.fillStyle = "rgba(255,255,255,.12)";
  x.fillRect(0, 44, 64, 2);
  return c;
}

export function roomC(hue: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d") as CanvasRenderingContext2D;
  x.fillStyle = "hsl(" + hue + " 26% 60%)";
  x.fillRect(0, 0, 64, 64);
  speckle(x, 180, 9);
  x.fillStyle = "rgba(0,0,0,.25)";
  x.fillRect(0, 42, 64, 2);
  x.fillStyle = "#22272d";
  x.fillRect(0, 44, 64, 20);
  x.fillStyle = "rgba(255,255,255,.12)";
  x.fillRect(0, 44, 64, 2);
  return c;
}

export function woodC(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d") as CanvasRenderingContext2D;
  x.fillStyle = "#7a5230";
  x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 26; i++) {
    x.fillStyle = "rgba(" + ((40 + Math.random() * 40) | 0) + "," + ((24 + Math.random() * 22) | 0) + ",12,.55)";
    const w = 1 + Math.random() * 3;
    x.fillRect(Math.random() * 64, 0, w, 64);
  }
  x.fillStyle = "rgba(0,0,0,.4)";
  x.fillRect(0, 0, 5, 64);
  x.fillRect(59, 0, 5, 64);
  x.fillStyle = "#22272d";
  x.fillRect(0, 44, 64, 20);
  return c;
}

export function setTheme(i: number): void {
  i = Math.max(0, Math.min(THEMES.length - 1, i | 0));
  SET.theme = i;
  CORR = THEMES.map((t) => plaster(t[0]));
  WOODC = woodC();
  ROOMT.clear();
}

export function texFor(
  mx: number,
  my: number,
  infoAt: (tx: number, ty: number) => TileInfo,
): HTMLCanvasElement {
  const s = infoAt(mx, my);
  if (s.t === T_FRAME) return WOODC as HTMLCanvasElement;
  const nb = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  let f: TileInfo | null = null;
  for (let i = 0; i < 4; i++) {
    const n = infoAt(mx + nb[i][0], my + nb[i][1]);
    if (n.t === T_FLOOR) {
      f = n;
      break;
    }
  }
  if (!f || f.corr) return CORR[SET.theme | 0];
  const q = Math.round(f.hue / 30) * 30;
  let t = ROOMT.get(q);
  if (!t) {
    t = roomC(((q % 360) + 360) % 360);
    ROOMT.set(q, t);
  }
  return t;
}
