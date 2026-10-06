export interface WeaponDef {
  id: string;
  name: string;
  cooldown: number;
  range: number;
  pellets: number;
  spreadDeg: number;
  isStampshot: boolean;
}

export const WEAPONS: Record<string, WeaponDef> = {
  stamp: {
    id: "stamp",
    name: "Stampshot",
    cooldown: 260,
    range: 40,
    pellets: 1,
    spreadDeg: 0,
    isStampshot: true,
  },
  shred: {
    id: "shred",
    name: "Shredder",
    cooldown: 750,
    range: 10,
    pellets: 7,
    spreadDeg: 9,
    isStampshot: false,
  }
};

export const PTS_TRASH = 10;
export const PTS_GOLD = 5;
export const PTS_PENALTY = -25;
export const COMBO_CAP = 5;

/**
 * Combo multiplier: 1x to 5x.
 * Increases every 4 hits: streak 1..4 is 1x, 5..8 is 2x, 9..12 is 3x, 13..16 is 4x, 17+ is 5x.
 */
export function comboMult(streak: number): number {
  if (streak <= 0) return 1;
  return Math.min(1 + Math.floor((streak - 1) / 4), COMBO_CAP);
}

/**
 * Deterministic pellet offsets for spread. No RNG.
 * Returns array of angles in radians.
 */
export function pelletOffsets(weaponId: string): number[] {
  const w = WEAPONS[weaponId];
  if (!w) return [0];
  if (w.pellets === 1) return [0];

  const offsets: number[] = [];
  const count = w.pellets;
  const spreadRad = (w.spreadDeg * Math.PI) / 180;
  
  // Deterministic spread
  offsets.push(0); // Center pellet
  const layers = Math.floor(count / 2);
  for (let i = 1; i <= layers; i++) {
    const fraction = i / layers;
    offsets.push(spreadRad * fraction);
    offsets.push(-spreadRad * fraction);
  }
  
  // Truncate to count if odd number calculation yielded more
  return offsets.slice(0, count);
}
