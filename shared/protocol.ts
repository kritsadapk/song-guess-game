// ชนิดข้อมูลที่ใช้ร่วมกันระหว่าง server และ client
// scores = หน้าสรุปอันดับคั่นระหว่างข้อ
export type Phase = "lobby" | "ready" | "question" | "reveal" | "scores" | "end";
// auto = เฉลยแล้วโชว์อันดับแล้วไปข้อต่อไปเอง · manual = แอดมินกดดูอันดับ/ข้อต่อไปเอง
export type Advance = "auto" | "manual";
// survival = ผิดแล้วตกรอบ (คนรอดได้คะแนนความเร็วไว้ตัดสิน) · score = ผิดแล้วกลับมาเล่นข้อต่อไป ชนะด้วยคะแนนรวม
export type Mode = "survival" | "score";

export interface Hole { label: string; correct: boolean }
export interface Question { youtubeId: string; start: number; duration: number; holes: Hole[] }

export interface HoleSpot { x: number; y: number; r: number }
export interface PublicQuestion { youtubeId: string; start: number; duration: number; labels: string[]; layout: HoleSpot[] }
export interface PublicPlayer {
  id: string; name: string; color: string; look: number;
  x: number; y: number; alive: boolean; online: boolean; score: number; streak: number;
}
// eliminated = คนที่ตกน้ำข้อนี้ (โหมด score ตกน้ำแต่ไม่ตกรอบ) · gains = คะแนนที่ได้ข้อนี้ตาม id
export interface Reveal { correct: number[]; eliminated: string[]; allSaved: boolean; gains: Record<string, number> }

export interface GameState {
  type: "state";
  phase: Phase;
  mode: Mode;
  advance: Advance;
  qIndex: number;
  total: number;
  question: PublicQuestion | null;
  endsAt: number;   // เวลาจบ phase ปัจจุบัน (เวลา server)
  phaseMs: number;  // ความยาว phase ปัจจุบัน
  now: number;      // เวลา server ตอนส่ง ใช้ชดเชยนาฬิกาเครื่องผู้เล่น
  reveal: Reveal | null;
  players: PublicPlayer[];
  dj: DjTrack | null;
  tvAudio: boolean;     // แอดมินตั้งให้ฟังเพลงจากจอทีวี → มือถือปิดเพลงเป็นค่าเริ่มต้น   // เพลงรอที่แอดมินเปิดในห้องรอ
}
// at = เวลา server ที่เริ่มเปิด ใช้ให้ทุกเครื่องเล่นตรงจังหวะเดียวกัน
export interface DjTrack { youtubeId: string; start: number; at: number }

export const COLORS = ["#ff5a5f", "#ff9f1c", "#ffd23f", "#2ee59d", "#19c3f5", "#4d7cff", "#a46bff", "#ff5fb4"];
export const LOOKS = 4; // หูฟัง, หมวก, โบว์, ต้นอ่อน
export const READY_MS = 3000;
// นับว่าอยู่ในหลุมถ้ายืนบนขอบสระที่มองเห็นด้วย (ขอบกว้างราว 0.02 ของสนาม) กันยืนขอบแล้วโดนตัดสินว่าตกน้ำ
export const HIT_PAD = 0.02;
export const inHole = (x: number, y: number, h: HoleSpot) => Math.hypot(x - h.x, y - h.y) <= h.r + HIT_PAD;
export const REVEAL_MS = 12000;
export const SUSPENSE_MS = 1300; // ช่วงลุ้นต้นเฉลย ก่อนโชว์ว่าใครถูกผิด
export const SCORES_MS = 7000; // หน้าสรุปอันดับในโหมด auto
export const SPOTLIGHT_MS = 4000; // ให้ดูคนตกน้ำในสนามก่อน แล้วค่อยขยายวิดีโอเพลงเต็มจอจนจบเฉลย

/** คะแนนแบบ Kahoot: ถูกได้ 500–1000 ตามความเร็ว + โบนัสสตรีค 100 ต่อข้อติดกัน (สูงสุด 500) */
export function speedPoints(tookMs: number, durationMs: number, streak: number): number {
  const frac = Math.min(1, Math.max(0, tookMs / durationMs));
  return Math.round(1000 * (1 - frac / 2)) + Math.min(Math.max(streak - 1, 0), 5) * 100;
}

export interface Contestant { id: string; x: number; y: number; hole: number; enteredAt: number; score: number; streak: number }

/**
 * ตัดสินหนึ่งข้อ: ให้คะแนน/สตรีคกับคนที่ถูก (แก้ค่าใน alive โดยตรง) แล้วคืนคนที่ผิด
 * hole/enteredAt = หลุมที่ยืนอยู่และเวลาที่เดินเข้า (ถ้าไม่ตรงหลุมปัจจุบัน นับว่าเพิ่งเข้าตอนหมดเวลา)
 */
export function judgeQuestion<T extends Contestant>(
  alive: T[], layout: HoleSpot[], correct: number[], mode: Mode, startedAt: number, now: number, durationMs: number,
) {
  const holeOf = (p: T) => layout.findIndex((h) => inHole(p.x, p.y, h));
  const wrong = alive.filter((p) => !correct.includes(holeOf(p)));
  // survival: ผิดกันหมดทุกคน → รอบนี้รอดหมด เกมจะได้ไม่จบแบบไม่มีผู้ชนะ
  const allSaved = mode === "survival" && alive.length > 0 && wrong.length === alive.length;
  const gains: Record<string, number> = {};
  for (const p of alive) {
    if (wrong.includes(p)) { p.streak = 0; continue; }
    p.streak++;
    const took = (p.hole === holeOf(p) ? p.enteredAt : now) - startedAt;
    p.score += gains[p.id] = speedPoints(took, durationMs, p.streak);
  }
  return { wrong, allSaved, gains };
}

/** เรียงอันดับ: โหมด survival คนรอดมาก่อน แล้วค่อยดูคะแนน */
export function rankPlayers<T extends { alive: boolean; score: number }>(list: T[], mode: Mode): T[] {
  return [...list].sort((a, b) => (mode === "survival" ? Number(b.alive) - Number(a.alive) : 0) || b.score - a.score);
}

// วางหลุมอัตโนมัติตามจำนวน (สนามเป็นสี่เหลี่ยมจัตุรัส พิกัด 0..1)
export function layoutHoles(n: number): HoleSpot[] {
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const rows = Math.ceil(n / cols);
  const cellW = 1 / cols, top = 0.36, rowH = (0.97 - top) / rows;
  // เผื่อที่ให้ป้ายชื่อเพลงเหนือหลุม ไม่ให้ทับหลุมแถวบน
  const r = Math.min(cellW * 0.36, rowH * 0.28, 0.18);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const offset = ((cols - inRow) * cellW) / 2;
    return { x: offset + cellW * (col + 0.5), y: top + rowH * (row + 0.5) + 0.03, r };
  });
}
