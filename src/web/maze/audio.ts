/**
 * Maze sound effects: tiny synthesized blips (oscillators only, no assets).
 * Every entry point no-ops outside a browser with WebAudio, so game.ts can
 * call these unconditionally (Bun tests import game.ts with a stubbed DOM).
 * Honors SET.sound; the context is created lazily and resumed on the first
 * user gesture (main.ts calls unlockAudio from key/pointer handlers).
 */
import { SET } from "./settings.ts";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): boolean {
  if (typeof window === "undefined" || !SET.sound) return false;
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.28;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return true;
  } catch {
    ctx = null;
    master = null;
    return false;
  }
}

/** Resume/create the audio context from a user gesture (autoplay policy). */
export function unlockAudio(): void {
  ensure();
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  gain?: number;
  delay?: number;
}

function tone(o: ToneOpts): void {
  if (!ensure() || !ctx || !master) return;
  try {
    const t0 = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || "triangle";
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to && o.to !== o.freq) osc.frequency.exponentialRampToValueAtTime(Math.max(40, o.to), t0 + o.dur);
    const peak = o.gain ?? 0.5;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  } catch {
    // audio is best-effort; the maze stays playable
  }
}

/** Queued-mail pickup: rising blip, pitch climbs with the streak. */
export function sfxPickup(streak = 1): void {
  const lift = Math.min(Math.max(1, streak) - 1, 8) * 0.055;
  tone({ freq: 520 * (1 + lift), to: 760 * (1 + lift), dur: 0.11, type: "triangle", gain: 0.45 });
  tone({ freq: 1040 * (1 + lift), dur: 0.07, type: "sine", gain: 0.18, delay: 0.05 });
}

/** Protected mail touched: soft two-note gold chime. */
export function sfxKeep(): void {
  tone({ freq: 880, dur: 0.1, type: "sine", gain: 0.4 });
  tone({ freq: 1320, dur: 0.16, type: "sine", gain: 0.3, delay: 0.09 });
}

/** Queue moved to Trash: quick downward sweep. */
export function sfxTrash(): void {
  tone({ freq: 440, to: 140, dur: 0.28, type: "square", gain: 0.22 });
}

/** Inbox-clear fanfare. */
export function sfxClear(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: "triangle", gain: 0.4, delay: i * 0.09 }));
}
