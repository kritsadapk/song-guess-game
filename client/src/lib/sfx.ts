// เสียงประกอบสังเคราะห์ด้วย Web Audio ไม่ต้องโหลดไฟล์
let ctx: AudioContext | null = null;
let muted = (() => { try { return localStorage.getItem("sg-mute") === "1"; } catch { return false; } })();

/** เรียกจากการแตะของผู้ใช้ (iOS ไม่ให้เล่นเสียงก่อนผู้ใช้แตะ) */
export function unlockAudio() {
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") void ctx.resume();
}

export const isMuted = () => muted;
export function setMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem("sg-mute", v ? "1" : "0"); } catch { /* ignore */ }
}

function out(gain: number) {
  if (!ctx || muted || ctx.state !== "running") return null;
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(ctx.destination);
  return g;
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = "sine", gain = 0.18, slideTo?: number) {
  const g = out(0);
  if (!g || !ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(at: number, dur: number, filter: BiquadFilterType, from: number, to: number, gain = 0.3) {
  const g = out(0);
  if (!g || !ctx) return;
  const t = ctx.currentTime + at;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
  src.buffer = buf;
  f.type = filter;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g);
  src.start(t);
}

export const sfx = {
  tick: () => tone(880, 0, 0.12, "square", 0.08),
  go: () => { tone(523, 0, 0.12, "triangle", 0.16); tone(784, 0.1, 0.25, "triangle", 0.18); },
  drumroll: () => { for (let i = 0; i < 12; i++) noise(i * 0.1, 0.08, "bandpass", 1800, 900, 0.12 + i * 0.012); },
  correct: () => { tone(660, 0, 0.14, "triangle", 0.18); tone(880, 0.12, 0.14, "triangle", 0.18); tone(1320, 0.24, 0.35, "triangle", 0.2); },
  splash: () => { noise(0, 0.7, "lowpass", 3000, 200, 0.5); tone(220, 0, 0.35, "sine", 0.25, 60); },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, i === 3 ? 0.6 : 0.16, "triangle", 0.2)),
};
