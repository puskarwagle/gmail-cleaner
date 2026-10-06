/**
 * Maze UI settings (browser-localStorage only; the server never sees them).
 * Same-origin localStorage, applied live via storage events (see main.ts).
 */

export interface MazeSettings {
  fov: number;
  move: number;
  turn: number;
  sens: number;
  auto: number;
  quality: number;
  density: number;
  theme: number;
  mapSize: number;
  mapRange: number;
  flip: boolean;
  sound: boolean;
}

export const SKEY = "mailmaze.settings.v1";

export const SDEF: MazeSettings = {
  fov: 1,
  move: 10,
  turn: 2.4,
  sens: 1,
  auto: 0.85,
  quality: 1,
  density: 7,
  theme: 0,
  mapSize: 148,
  mapRange: 24,
  flip: false,
  sound: true,
};

/** Live settings object. Mutated in place so ES-module live bindings stay valid. */
export const SET: MazeSettings = { ...SDEF };

function storage(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    // ignore (Bun / non-DOM environments)
  }
  return null;
}

/** Load persisted settings into SET. Safe to call in non-DOM environments. */
export function loadSettings(): void {
  const ls = storage();
  if (!ls) return;
  try {
    const s = JSON.parse(ls.getItem(SKEY) as string);
    if (s && typeof s === "object") Object.assign(SET, s);
  } catch {
    // keep defaults
  }
}

export function saveSET(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(SKEY, JSON.stringify(SET));
  } catch {
    // ignore quota / privacy mode
  }
}

/** Apply a parsed storage-event payload (plain object) to SET. */
export function applySettingsObject(s: unknown): void {
  if (s && typeof s === "object") Object.assign(SET, s);
}

loadSettings();
