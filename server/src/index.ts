// Song Splash (ทายผิด ตกน้ำ!) – game server (Bun + WebSocket)
import { mkdir } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import {
  COLORS, LOOKS, READY_MS, REVEAL_MS, SCORES_MS, inHole, judgeQuestion, layoutHoles,
  type Advance, type DjTrack, type GameState, type Hole, type HoleSpot, type Mode, type Phase, type Question, type Reveal,
} from "../../shared/protocol";

type WSData = { role: "player" | "admin"; pid: string | null };
type Player = {
  id: string; name: string; color: string; look: number;
  x: number; y: number; tx: number; ty: number;
  alive: boolean; score: number; streak: number; conns: number; leaveTimer?: ReturnType<typeof setTimeout>;
  hole: number; enteredAt: number; // หลุมที่ยืนอยู่ + เวลาที่เดินเข้า ใช้คิดคะแนนความเร็ว
};

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || "changeme"; // || ไม่ใช่ ?? : ADMIN_KEY ว่าง = ไม่ได้ตั้ง (กัน ?key= ว่างเข้าหลังบ้านได้)
const DATA_FILE = resolve(process.env.DATA_FILE ?? join(import.meta.dir, "../data/questions.json"));
const DIST = resolve(process.env.CLIENT_DIST ?? join(import.meta.dir, "../../client/dist"));
const SPEED = 0.028;          // ระยะเดินต่อ tick (สนามกว้าง 1)
const TICK_MS = 50;           // 20 ticks/วินาที
const LEAVE_GRACE_MS = 15000; // หลุดเน็ตแล้วกลับมาภายในนี้ ตัวละครยังอยู่
const PERSONAL_SPACE = 0.065; // ระยะห่างขั้นต่ำระหว่างตัวละคร กันยืนซ้อนกัน
const MAX_PLAYERS = 100;      // กันคนเปิด socket ถล่มจนลูปดันตัวละคร (n²) ค้างทั้งห้อง

if (ADMIN_KEY === "changeme") {
  if (process.env.NODE_ENV === "production") {
    console.error("❌ ยังไม่ได้ตั้ง ADMIN_KEY — ใครเดา changeme ได้จะคุมเกมได้ ตั้ง ADMIN_KEY=... แล้วรันใหม่");
    process.exit(1);
  }
  console.warn("⚠️  ยังใช้ ADMIN_KEY ค่าเริ่มต้น ตั้ง ADMIN_KEY=... ก่อนใช้งานจริง");
}

// ---------- state ----------
let questions: Question[] = [];
try {
  const f = Bun.file(DATA_FILE);
  if (await f.exists()) questions = await f.json();
} catch { console.warn("อ่าน questions.json ไม่ได้ เริ่มจากชุดว่าง"); }

const players = new Map<string, Player>();
let phase: Phase = "lobby";
let mode: Mode = "survival";
let advance: Advance = "auto";
let qIndex = -1;
let endsAt = 0;
let phaseMs = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let reveal: Reveal | null = null;
let dj: DjTrack | null = null;
let tvAudio = false;

const clamp = (v: number) => Math.min(0.97, Math.max(0.03, v));
const clampY = (v: number) => Math.min(0.97, Math.max(0.1, v)); // เผื่อป้ายชื่อเหนือหัว ไม่ให้ล้นขอบบนสนาม
const publish = (msg: unknown) => server.publish("all", JSON.stringify(msg));
const toAdmins = (msg: unknown) => server.publish("admin", JSON.stringify(msg));

function spawn(p: Player) {
  p.x = p.tx = 0.08 + Math.random() * 0.84;
  p.y = p.ty = 0.11 + Math.random() * 0.12;
}

function pickColor() {
  const used = new Map<string, number>();
  for (const p of players.values()) used.set(p.color, (used.get(p.color) ?? 0) + 1);
  return [...COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
}

function state(): GameState {
  const q = questions[qIndex];
  // scores ยังส่งคำถามอยู่ → เพลงเฉลยเล่นต่อเป็นวิดีโอเล็กในหน้าอันดับ
  const showQ = q && (phase === "ready" || phase === "question" || phase === "reveal" || phase === "scores");
  return {
    type: "state", phase, mode, advance, qIndex, total: questions.length,
    question: showQ ? {
      youtubeId: q.youtubeId, start: q.start, duration: q.duration,
      labels: q.holes.map((h) => h.label), layout: layoutHoles(q.holes.length),
    } : null,
    endsAt, phaseMs, now: Date.now(), reveal: phase === "reveal" || phase === "scores" ? reveal : null, dj, tvAudio,
    players: [...players.values()].map(({ id, name, color, look, x, y, alive, score, streak, conns }) =>
      ({ id, name, color, look, x, y, alive, score, streak, online: conns > 0 })),
  };
}
const sendState = () => publish(state());

// ---------- game flow: lobby → (ready → question → reveal)* → end ----------
function setPhase(next: Phase, ms: number, then?: () => void) {
  clearTimeout(timer);
  phase = next;
  phaseMs = ms;
  endsAt = ms ? Date.now() + ms : 0;
  sendState();
  if (then) timer = setTimeout(then, ms);
}

function startGame(m: unknown) {
  if (!questions.length) return "ยังไม่มีคำถาม";
  mode = m === "score" ? "score" : "survival";
  dj = null; // เริ่มแข่งแล้ว ปิดเพลงรอ
  dropOffline();
  qIndex = -1;
  for (const p of players.values()) { p.alive = true; p.score = 0; p.streak = 0; }
  nextQuestion();
}

const holeAt = (p: Player, layout: HoleSpot[]) => layout.findIndex((h) => inHole(p.x, p.y, h));

function nextQuestion() {
  qIndex++;
  if (qIndex >= questions.length) return endGame();
  reveal = null;
  for (const p of players.values()) {
    if (mode === "score") p.alive = true;
    if (p.alive) spawn(p);
    p.hole = -1;
  }
  setPhase("ready", READY_MS, () => setPhase("question", questions[qIndex].duration * 1000, resolveQuestion));
}

function resolveQuestion() {
  const q = questions[qIndex];
  const layout = layoutHoles(q.holes.length);
  const correct = q.holes.flatMap((h, i) => (h.correct ? [i] : []));
  const alive = [...players.values()].filter((p) => p.alive);
  const { wrong, allSaved, gains } = judgeQuestion(alive, layout, correct, mode, endsAt - phaseMs, Date.now(), phaseMs);
  if (mode === "survival" && !allSaved) for (const p of wrong) p.alive = false;
  for (const p of players.values()) { p.tx = p.x; p.ty = p.y; }
  reveal = { correct, eliminated: allSaved ? [] : wrong.map((p) => p.id), allSaved, gains };
  setPhase("reveal", REVEAL_MS, afterReveal);
}

function isFinal() {
  const aliveCount = [...players.values()].filter((p) => p.alive).length;
  const lastStanding = mode === "survival" && players.size > 1 && aliveCount <= 1;
  return lastStanding || qIndex >= questions.length - 1;
}
const nextOrEnd = () => (isFinal() ? endGame() : nextQuestion());
// auto: ตั้งเวลาไปต่อเอง · manual: ค้างไว้ (phaseMs 0) รอแอดมินกด
const showScores = () => (advance === "auto" ? setPhase("scores", SCORES_MS, nextOrEnd) : setPhase("scores", 0));

// หมดเวลาเฉลย: manual ค้างหน้าเฉลยไว้ (วิดีโอเล่นต่อ) รอแอดมิน · ข้อสุดท้ายไปหน้าผู้ชนะเลย
function afterReveal() {
  if (advance === "manual") return;
  if (isFinal()) endGame();
  else showScores();
}

function endGame() {
  setPhase("end", 0);
}

// คนที่หลุดระหว่างเกมยังเก็บคะแนนไว้ (มือถือล็อกจอบ่อย) → ค่อยลบตอนกลับห้องรอ/เริ่มเกมใหม่
function dropOffline() {
  for (const p of players.values()) if (p.conns <= 0) { clearTimeout(p.leaveTimer); players.delete(p.id); }
}

function resetLobby() {
  dropOffline();
  qIndex = -1;
  reveal = null;
  for (const p of players.values()) { p.alive = true; p.score = 0; p.streak = 0; spawn(p); }
  setPhase("lobby", 0);
}

// ---------- admin ----------
function validate(input: unknown): Question[] | string {
  if (!Array.isArray(input) || input.length > 300) return "รูปแบบข้อมูลไม่ถูกต้อง";
  const out: Question[] = [];
  for (const [i, q] of input.entries()) {
    const n = i + 1;
    if (!/^[\w-]{11}$/.test(String(q?.youtubeId ?? ""))) return `ข้อ ${n}: ลิงก์ YouTube ไม่ถูกต้อง`;
    const start = Math.max(0, Math.floor(Number(q.start) || 0));
    const duration = Math.floor(Number(q.duration));
    if (!(duration >= 5 && duration <= 120)) return `ข้อ ${n}: เวลาให้ตอบต้องอยู่ระหว่าง 5–120 วินาที`;
    if (!Array.isArray(q.holes) || q.holes.length < 2 || q.holes.length > 6) return `ข้อ ${n}: ต้องมี 2–6 หลุม`;
    const holes: Hole[] = q.holes.map((h: any) => ({ label: String(h?.label ?? "").trim().slice(0, 40), correct: !!h?.correct }));
    if (holes.some((h) => !h.label)) return `ข้อ ${n}: ใส่ชื่อเพลงให้ครบทุกหลุม`;
    if (!holes.some((h) => h.correct)) return `ข้อ ${n}: เลือกหลุมที่ถูกอย่างน้อย 1 หลุม`;
    out.push({ youtubeId: q.youtubeId, start, duration, holes });
  }
  return out;
}

async function onAdmin(ws: ServerWebSocket<WSData>, m: any) {
  const err = (message: string) => ws.send(JSON.stringify({ type: "error", message }));
  switch (m.type) {
    case "start": { const e = startGame(m.mode); if (e) err(e); break; }
    case "skip": if (phase === "question") { clearTimeout(timer); resolveQuestion(); } break;
    case "stop": resetLobby(); break;
    case "tvAudio": tvAudio = !!m.value; sendState(); break;
    case "scores": if (phase === "reveal") showScores(); break;
    case "next": if (phase === "reveal" || phase === "scores") nextOrEnd(); break;
    case "advance": {
      advance = m.value === "manual" ? "manual" : "auto";
      // สลับเป็น auto ระหว่างที่ค้างรอแอดมินอยู่ → เดินต่อให้เลย
      if (advance === "auto" && phase === "reveal" && Date.now() >= endsAt) afterReveal();
      else if (advance === "auto" && phase === "scores" && !phaseMs) showScores();
      else sendState();
      break;
    }
    case "dj": {
      if (phase !== "lobby" && phase !== "end") return err("เปิดเพลงรอได้เฉพาะตอนอยู่ห้องรอ");
      const id = String(m.youtubeId ?? "");
      if (id && !/^[\w-]{11}$/.test(id)) return err("ลิงก์ YouTube ไม่ถูกต้อง");
      dj = id ? { youtubeId: id, start: Math.max(0, Math.floor(Number(m.start) || 0)), at: Date.now() } : null;
      sendState();
      break;
    }
    case "save": {
      if (phase !== "lobby" && phase !== "end") return err("หยุดเกมก่อนแก้คำถาม");
      const result = validate(m.questions);
      if (typeof result === "string") return err(result);
      questions = result;
      await mkdir(dirname(DATA_FILE), { recursive: true });
      await Bun.write(DATA_FILE, JSON.stringify(questions, null, 2));
      toAdmins({ type: "questions", questions });
      ws.send(JSON.stringify({ type: "saved" }));
      sendState();
      break;
    }
  }
}

// ---------- player ----------
function onPlayer(ws: ServerWebSocket<WSData>, m: any) {
  if (m.type === "join") {
    const pid = String(m.pid ?? "");
    if (!/^[\w-]{8,64}$/.test(pid) || ws.data.pid) return;
    if (!players.has(pid) && players.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ type: "error", message: `ห้องเต็มแล้ว (สูงสุด ${MAX_PLAYERS} คน)` }));
      return;
    }
    ws.data.pid = pid;
    const name = String(m.name ?? "").trim().slice(0, 16) || "ผู้เล่น";
    const color = COLORS.includes(m.color) ? m.color : pickColor();
    const look = Number.isInteger(m.look) && m.look >= 0 && m.look < LOOKS ? m.look : Math.floor(Math.random() * LOOKS);
    let p = players.get(pid);
    if (p) {
      clearTimeout(p.leaveTimer);
      Object.assign(p, { name, color, look });
      p.conns++;
    } else {
      // survival: เข้ากลางเกม = ดูอย่างเดียวจนกว่าจะเริ่มเกมใหม่ · score: เล่นได้ทันที
      p = {
        id: pid, name, color, look, x: 0, y: 0, tx: 0, ty: 0, conns: 1, score: 0, streak: 0, hole: -1, enteredAt: 0,
        alive: phase === "lobby" || phase === "end" || mode === "score",
      };
      spawn(p);
      players.set(pid, p);
    }
    sendState();
  } else if (m.type === "move") {
    const p = ws.data.pid ? players.get(ws.data.pid) : undefined;
    if (!p || !p.alive || phase === "ready" || phase === "reveal" || phase === "scores") return;
    const x = Number(m.x), y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    p.tx = clamp(x);
    p.ty = clampY(y);
  }
}

// ---------- static files (client/dist) ----------
async function serveStatic(pathname: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return new Response("not found", { status: 404 }); }
  const path = normalize(join(DIST, decoded));
  if (path !== DIST && !path.startsWith(DIST + sep)) return new Response("not found", { status: 404 });
  if (pathname !== "/") {
    const f = Bun.file(path);
    if (await f.exists()) {
      const immutable = pathname.startsWith("/assets/");
      return new Response(f, { headers: immutable ? { "cache-control": "public, max-age=31536000, immutable" } : {} });
    }
  }
  const index = Bun.file(join(DIST, "index.html"));
  if (await index.exists()) return new Response(index, { headers: { "cache-control": "no-cache" } });
  return new Response("ยังไม่ได้ build client — รัน `bun run build` ที่ root ก่อน (หรือใช้ `bun run dev`)", { status: 404 });
}

const server = Bun.serve<WSData>({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const role = url.searchParams.get("role") === "admin" ? "admin" : "player";
      if (role === "admin" && url.searchParams.get("key") !== ADMIN_KEY) return new Response("forbidden", { status: 403 });
      return srv.upgrade(req, { data: { role, pid: null } }) ? undefined : new Response("upgrade failed", { status: 400 });
    }
    if (url.pathname === "/healthz") return new Response("ok");
    // เปิดหน้าเว็บด้วย localhost แล้ว QR จะชี้ localhost ที่มือถือเข้าไม่ได้ → บอก IP วง LAN ให้ (ตอบเฉพาะคนที่อยู่บนเครื่องนี้)
    if (url.pathname === "/api/lan") {
      if (!["localhost", "127.0.0.1"].includes(url.hostname)) return new Response("not found", { status: 404 });
      const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => n!.address);
      return Response.json(ips);
    }
    return serveStatic(url.pathname);
  },
  websocket: {
    open(ws) {
      ws.subscribe("all");
      if (ws.data.role === "admin") {
        ws.subscribe("admin");
        ws.send(JSON.stringify({ type: "questions", questions }));
      }
      ws.send(JSON.stringify(state()));
    },
    message(ws, raw) {
      let m: any;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (ws.data.role === "admin") onAdmin(ws, m);
      else onPlayer(ws, m);
    },
    close(ws) {
      const p = ws.data.pid ? players.get(ws.data.pid) : undefined;
      if (!p) return;
      p.conns--;
      if (p.conns <= 0) {
        // ระหว่างเกมไม่ลบ (คะแนนจะได้ไม่หาย) — ลบจริงตอน dropOffline
        if (phase === "lobby" || phase === "end") p.leaveTimer = setTimeout(() => { players.delete(p.id); sendState(); }, LEAVE_GRACE_MS);
        sendState();
      }
    },
  },
});

// game loop: เดินเข้าหาจุดที่แตะ + ดันตัวที่ยืนซ้อนกันออก แล้วกระจายเฉพาะคนที่ขยับ
setInterval(() => {
  const changed = new Set<Player>();
  const walkers = [...players.values()].filter((p) => p.alive);
  for (const p of walkers) {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
    if (d < 1e-4) continue;
    const s = Math.min(1, SPEED / d);
    p.x += dx * s;
    p.y += dy * s;
    changed.add(p);
  }
  if (phase !== "reveal") {
    for (let i = 0; i < walkers.length; i++) {
      for (let j = i + 1; j < walkers.length; j++) {
        const a = walkers[i], b = walkers[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= PERSONAL_SPACE) continue;
        if (d < 1e-6) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
        const push = ((PERSONAL_SPACE - d) / 2) * 0.5, nx = (dx / d) * push, ny = (dy / d) * push;
        for (const [p, sx, sy] of [[a, -nx, -ny], [b, nx, ny]] as const) {
          p.x = clamp(p.x + sx); p.y = clampY(p.y + sy);
          p.tx = clamp(p.tx + sx); p.ty = clampY(p.ty + sy);
          changed.add(p);
        }
      }
    }
  }
  // จดเวลาที่เดินเข้าหลุม (ย้ายหลุม = เริ่มนับใหม่)
  if (phase === "question" && questions[qIndex]) {
    const layout = layoutHoles(questions[qIndex].holes.length), now = Date.now();
    for (const p of changed) {
      const h = holeAt(p, layout);
      if (h !== p.hole) { p.hole = h; p.enteredAt = now; }
    }
  }
  if (changed.size) publish({ type: "pos", p: [...changed].map((p) => [p.id, +p.x.toFixed(4), +p.y.toFixed(4)]) });
}, TICK_MS);

console.log(`🎵 Song Splash  http://localhost:${server.port}   หลังบ้าน: http://localhost:${server.port}/admin`);
