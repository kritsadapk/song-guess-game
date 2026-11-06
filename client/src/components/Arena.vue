<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRaw } from "vue";
import { inHole, type GameState } from "@shared/protocol";
import type { PlayerView } from "../composables/useGame";
import Bean from "./Bean.vue";
import PoolWater from "./PoolWater.vue";

const props = defineProps<{
  state: GameState | null; players: PlayerView[]; myId: string;
  seconds: number; goFlash: boolean; shown: boolean; aliveCount: number;
}>();
const emit = defineEmits<{ move: [number, number] }>();

const HOLE_COLORS = ["#ff2e88", "#22e4ff", "#ffd23f", "#a46bff", "#3dffa8", "#ff8a3d"];
const arena = ref<HTMLElement>();
const tap = ref<{ x: number; y: number; k: number } | null>(null);
const glWater = ref(false); // น้ำ WebGL พร้อมแล้ว → ซ่อนน้ำ CSS

const phase = computed(() => props.state?.phase ?? "lobby");
const q = computed(() => props.state?.question ?? null);
const reveal = computed(() => props.state?.reveal ?? null);
const shownReveal = computed(() => (props.shown ? reveal.value : null));
const suspense = computed(() => phase.value === "reveal" && !props.shown);
const me = computed(() => props.players.find((p) => p.id === props.myId) ?? null);
const canMove = computed(() => !!me.value?.alive && ["lobby", "question", "end"].includes(phase.value));
const isLast = computed(() => !!props.state && props.state.qIndex === props.state.total - 1);
// survival: เหลือไม่กี่คนสุดท้าย → สนามเข้าโหมดดุเดือด
const finalFew = computed(() => props.state?.mode === "survival" && props.players.length > 3 && props.aliveCount > 1 && props.aliveCount <= 3);
const banner = computed(() => {
  if (phase.value !== "ready") return "";
  if (isLast.value) return "ข้อสุดท้าย!";
  if (finalFew.value) return `เหลือ ${props.aliveCount} คนสุดท้าย!`;
  return "";
});
const answer = computed(() => (shownReveal.value && q.value ? shownReveal.value.correct.map((i) => q.value!.labels[i]).join(" / ") : ""));
const fell = (id: string) => !!shownReveal.value?.eliminated.includes(id);
const holeStates = computed(() => q.value?.layout.map((_, i) => (shownReveal.value ? (shownReveal.value.correct.includes(i) ? 1 : 2) : 0)) ?? []);
const falls = computed(() => shownReveal.value?.eliminated ?? []);

const myHole = computed(() => {
  if (!q.value || !me.value?.alive) return -1;
  const m = me.value;
  return q.value.layout.findIndex((h) => inHole(m.x, m.y, h));
});

const visible = computed(() => props.players.filter((p) => p.alive || reveal.value?.eliminated.includes(p.id)));

const toast = computed(() => {
  const r = shownReveal.value;
  if (!r || !me.value) return null;
  if (r.allSaved) return { text: "ผิดกันหมด รอดหมด!", kind: "save" };
  if (r.eliminated.includes(props.myId)) return { text: "ตกน้ำ!", kind: "out" };
  if (r.gains[props.myId]) return { text: "ถูก!", kind: "safe" };
  return null;
});

const hint = computed(() => {
  if (!me.value) return "";
  if (!me.value.alive && phase.value !== "reveal") return "คุณตกน้ำไปแล้ว นั่งดูเพื่อนเล่นต่อได้เลย";
  if (phase.value === "lobby") return "แตะตรงไหนก็ได้บนพื้น ตัวละครจะเดินไปตรงนั้น";
  if (phase.value === "ready") return "อ่านป้ายไว้ก่อน ยังเดินไม่ได้";
  if (phase.value === "question") return myHole.value >= 0 ? `ยืนอยู่ที่ “${q.value!.labels[myHole.value]}”` : "ยิ่งไปยืนเร็ว ยิ่งได้คะแนนเยอะ!";
  return "";
});

function onTap(e: PointerEvent) {
  if (!canMove.value || !arena.value) return;
  const r = arena.value.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  tap.value = { x, y, k: (tap.value?.k ?? 0) + 1 };
  emit("move", x, y);
}

// ---------- วางตัวละครเองทุกเฟรม ----------
// server ส่งตำแหน่งแค่ 20 ครั้ง/วิ แถมมาไม่สม่ำเสมอ → ให้ตัวที่เห็นไหลตามตำแหน่งล่าสุดด้วยความเร็วคงที่
// และขยับด้วย transform (ไม่ผ่าน Vue / ไม่คำนวณ layout ใหม่) จะได้ไม่กระตุก
const els = new Map<string, HTMLElement>();
const shown = new Map<string, { x: number; y: number }>();
// function ref ถูกเรียกด้วย null แล้ว el ใหม่ทุกครั้งที่ render → เก็บ shown ไว้ ไม่งั้นตัวจะวาร์ป
const setEl = (id: string, el: unknown) => { if (el) els.set(id, el as HTMLElement); else els.delete(id); };
let size = 0, raf = 0, last = 0;
const ro = new ResizeObserver(([e]) => (size = e.contentRect.width));
function place(t: number) {
  raf = requestAnimationFrame(place);
  const dt = Math.min(0.1, (t - (last || t)) / 1000);
  last = t;
  if (!size) return;
  if (shown.size > els.size + 20) for (const id of shown.keys()) if (!els.has(id)) shown.delete(id); // คนที่ออกไปแล้ว
  for (const p of toRaw(props.players)) {
    const el = els.get(p.id);
    if (!el) continue;
    let d = shown.get(p.id);
    if (!d) shown.set(p.id, (d = { x: p.x, y: p.y }));
    const dx = p.x - d.x, dy = p.y - d.y, dist = Math.hypot(dx, dy);
    if (dist > 0.25) { d.x = p.x; d.y = p.y; } // วาร์ป (เกิดใหม่/ต่อเน็ตใหม่)
    else if (dist > 1e-4) {
      // เร็วกว่าความเร็วเดินจริง (0.56/วิ) นิดหน่อยให้ตามทัน ถ้าห่างมากเร่งไล่
      const step = Math.min(dist, Math.max(0.65, dist * 6) * dt);
      d.x += (dx / dist) * step; d.y += (dy / dist) * step;
    }
    el.style.transform = `translate3d(${d.x * size}px, ${d.y * size}px, 0)`;
    el.style.zIndex = String(10 + Math.round(d.y * 1000));
  }
}
onMounted(() => {
  if (arena.value) { size = arena.value.clientWidth; ro.observe(arena.value); }
  raf = requestAnimationFrame(place);
});
onBeforeUnmount(() => { cancelAnimationFrame(raf); ro.disconnect(); });
</script>

<template>
  <div class="arena-shell">
    <div ref="arena" class="arena" :class="[`ph-${phase}`, { locked: !canMove, gl: glWater, suspense, final: finalFew && (phase === 'ready' || phase === 'question') }]" @pointerdown="onTap">
      <div class="start-zone" aria-hidden="true"><span>จุดเริ่ม</span></div>

      <PoolWater v-if="q" :layout="q.layout" :states="holeStates" :players="visible" :falls="falls" :tap="tap" @ready="glWater = true" @lost="glWater = false" />
      <template v-if="q">
        <div v-for="(h, i) in q.layout" :key="`${state?.qIndex}-${i}`" class="hole"
             :class="{ ok: shownReveal?.correct.includes(i), bad: shownReveal && !shownReveal.correct.includes(i), mine: (phase === 'question' || suspense) && myHole === i }"
             :style="{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${h.r * 200}%`, '--c': HOLE_COLORS[i % HOLE_COLORS.length], '--i': i }">
          <div class="water"><i></i><i></i></div>
          <div class="sign"><span>{{ q.labels[i] }}</span></div>
        </div>
      </template>

      <span v-if="tap" :key="tap.k" class="tap-mark" :style="{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }"></span>

      <div v-for="p in visible" :key="p.id" :ref="(el) => setEl(p.id, el)" class="pl"
           :class="{ me: p.id === myId, falling: fell(p.id), off: !p.online }">
        <span class="name">{{ p.name }}</span>
        <span v-if="p.walking" class="dust" aria-hidden="true"><i></i><i></i></span>
        <div class="who"><Bean :color="p.color" :look="p.look" :face="p.face" :walking="p.walking" :cheer="!!shownReveal?.gains[p.id]" /></div>
        <span class="splash" v-if="fell(p.id)"><i></i><i></i><b></b><b></b><b></b></span>
        <span v-if="shownReveal?.gains[p.id]" class="gain">+{{ shownReveal.gains[p.id] }}</span>
      </div>

      <div v-if="phase === 'ready' && seconds > 0" :key="`c${seconds}`" class="count" aria-hidden="true">
        <span class="burst"></span><b class="puffy">{{ seconds }}</b>
      </div>
      <div v-if="banner" class="banner puffy">{{ banner }}</div>
      <!-- เฉลย + ผลของเรา เรียงซ้อนลงมา ไม่ทับกัน -->
      <div v-if="answer" :key="`a${state?.qIndex}`" class="reveal-stack">
        <div class="banner ok puffy" aria-hidden="true"><small>เฉลย</small>{{ answer }}</div>
        <div v-if="toast" class="toast puffy" :class="toast.kind">{{ toast.text }}</div>
      </div>
      <div v-if="goFlash" class="go puffy" aria-hidden="true">ไปเลย!</div>
    </div>
    <p class="hint" v-if="hint" aria-live="polite">{{ hint }}</p>
  </div>
</template>

<style scoped>
.arena-shell { display: grid; gap: 14px; }
/* พื้นสระว่ายน้ำตอนกลางคืน: กระเบื้องสว่าง ขอบไฟนีออน */
.arena {
  position: relative; width: 100%; aspect-ratio: 1;
  container-type: inline-size;
  border-radius: 32px;
  background:
    radial-gradient(70% 55% at 50% 45%, rgba(255,255,255,.75), transparent 75%),
    linear-gradient(var(--deck-line) 1px, transparent 1px) 0 0 / 8.333% 8.333%,
    linear-gradient(90deg, var(--deck-line) 1px, transparent 1px) 0 0 / 8.333% 8.333%,
    linear-gradient(180deg, var(--deck), var(--deck-2));
  box-shadow:
    0 0 0 3px rgba(255,255,255,.9),
    0 0 0 7px var(--night-3),
    0 0 0 9px rgba(34,228,255,.7),
    0 0 34px 8px rgba(34,228,255,.35),
    0 0 80px 10px rgba(255,46,136,.18),
    0 30px 60px rgba(5,3,30,.6),
    inset 0 -30px 60px rgba(90,70,190,.18);
  touch-action: none; cursor: pointer;
  isolation: isolate; /* กัน z-index ผู้เล่นทะลุ overlay */
  transition: box-shadow .4s;
}
.arena.ph-question { box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 0 7px var(--night-3), 0 0 0 9px rgba(255,46,136,.8), 0 0 40px 10px rgba(255,46,136,.4), 0 30px 60px rgba(5,3,30,.6), inset 0 -30px 60px rgba(90,70,190,.18); }
.arena.locked { cursor: default; }
.start-zone {
  position: absolute; left: 4%; right: 4%; top: 2.5%; height: 22%;
  border-radius: 4cqw;
  background: repeating-linear-gradient(135deg, rgba(91,83,144,.07) 0 2cqw, transparent 2cqw 4cqw);
  border: .4cqw dashed rgba(91,83,144,.28);
}
.start-zone span {
  position: absolute; right: 2.4cqw; top: 1.6cqw;
  font-family: var(--font-display); font-weight: 700; font-style: italic; font-size: clamp(10px, 2.6cqw, 14px);
  letter-spacing: .08em; color: rgba(91,83,144,.6);
}

/* ---------- หลุม: สระเรืองแสง ---------- */
.hole { position: absolute; aspect-ratio: 1; transform: translate(-50%, -50%); }
.water {
  position: absolute; inset: 0; border-radius: 50%; overflow: hidden;
  background:
    radial-gradient(circle at 35% 30%, rgba(255,255,255,.55), transparent 22%),
    radial-gradient(circle at 50% 45%, var(--water-hi), var(--water) 38%, var(--water-deep) 68%, var(--abyss));
  box-shadow:
    0 0 0 1.2cqw var(--c),
    0 0 0 2cqw #fff,
    0 0 4cqw 1.6cqw color-mix(in srgb, var(--c) 55%, transparent),
    inset 0 1.4cqw 2.4cqw rgba(6,42,92,.55);
  transition: box-shadow .3s, filter .4s;
}
.water i {
  position: absolute; inset: 30%; border-radius: 50%; border: .5cqw solid rgba(255,255,255,.6);
  animation: ripple 2.6s ease-out infinite;
}
.water i + i { animation-delay: 1.3s; }
@keyframes ripple { from { transform: scale(.3); opacity: .9; } to { transform: scale(2.2); opacity: 0; } }

/* ป้ายชื่อเพลง: ป้ายไฟมาร์คีสีเข้ม */
.sign {
  position: absolute; left: 50%; bottom: calc(100% + 3.4cqw); transform: translateX(-50%);
  width: max-content; max-width: 46cqw;
  padding: 1cqw 3cqw 1.2cqw;
  border-radius: 2.6cqw;
  background: linear-gradient(180deg, #241a5e, var(--ink));
  border: .6cqw solid var(--c);
  box-shadow: 0 0 2.4cqw color-mix(in srgb, var(--c) 70%, transparent), inset 0 0 1.6cqw color-mix(in srgb, var(--c) 30%, transparent), 0 1.2cqw 2cqw rgba(20,15,58,.35);
  font-family: var(--font-display); font-weight: 600;
  font-size: clamp(13px, 4.4cqw, 26px); line-height: 1.25; text-align: center;
  color: #fff; overflow-wrap: anywhere;
  transition: transform .3s, background .3s, opacity .3s;
  z-index: 5;
}
.sign::after {
  content: ""; position: absolute; left: 50%; top: 100%; width: .8cqw; height: 3cqw; transform: translateX(-50%);
  background: var(--ink); border-radius: 0 0 .4cqw .4cqw; margin-top: .6cqw;
}
.hole.mine .water { box-shadow: 0 0 0 1.2cqw var(--c), 0 0 0 2.4cqw var(--sun), 0 0 6cqw 3cqw rgba(255,210,63,.65), inset 0 1.4cqw 2.4cqw rgba(6,42,92,.55); }
.hole.mine .sign { transform: translateX(-50%) scale(1.08); border-color: var(--sun); box-shadow: 0 0 3cqw rgba(255,210,63,.8), inset 0 0 1.6cqw rgba(255,210,63,.3); }

.hole.ok .water { box-shadow: 0 0 0 1.4cqw var(--mint), 0 0 0 2.4cqw #fff, 0 0 7cqw 3.4cqw rgba(61,255,168,.75), inset 0 1.4cqw 2.4cqw rgba(6,42,92,.45); }
.hole.ok .sign { background: var(--mint); color: var(--ink); border-color: #fff; box-shadow: 0 0 4cqw rgba(61,255,168,.9), 0 1.2cqw 0 var(--mint-deep); transform: translateX(-50%) scale(1.14); }
.hole.ok .sign span::before { content: "✓ "; }
.hole.bad .water { background: conic-gradient(from 0deg, var(--abyss), var(--water-deep), var(--water), var(--abyss), var(--water-deep), var(--abyss)); animation: whirl 1.1s linear infinite; filter: saturate(.7); }
.hole.bad .sign { opacity: .4; }
@keyframes whirl { to { transform: rotate(360deg); } }

.tap-mark {
  position: absolute; width: 7cqw; height: 3.4cqw; transform: translate(-50%, -50%); border-radius: 50%;
  border: .6cqw solid var(--pop); box-shadow: 0 0 1.6cqw var(--pop); pointer-events: none; animation: tapfx .6s ease-out forwards;
}
@keyframes tapfx { from { opacity: 1; transform: translate(-50%, -50%) scale(.4); } to { opacity: 0; transform: translate(-50%, -50%) scale(1.5); } }

/* ---------- ผู้เล่น ---------- */
.pl { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; will-change: transform; }
.who { position: absolute; width: 8.5cqw; min-width: 28px; left: 0; bottom: -1.2cqw; transform: translateX(-50%); }
.name {
  position: absolute; left: 0; bottom: 9.6cqw; transform: translateX(-50%); white-space: nowrap;
  font-family: var(--font-display); font-weight: 500; font-size: clamp(10px, 2.7cqw, 14px); line-height: 1.35;
  padding: 0 1.8cqw; border-radius: 99px; background: rgba(20,15,58,.82); color: #fff;
}
.me .name { background: var(--sun); color: var(--ink); font-weight: 700; box-shadow: 0 .6cqw 0 var(--sun-deep), 0 0 2.4cqw rgba(255,210,63,.8); }
.me .name::after {
  content: ""; position: absolute; left: 50%; top: 100%; transform: translateX(-50%);
  border: 1.2cqw solid transparent; border-top-color: var(--sun); border-bottom: 0;
}
.off { opacity: .45; }

.falling .who { animation: sink 1s .25s cubic-bezier(.5,0,.8,.4) forwards; }
.falling .name { animation: fade .4s .9s forwards; }
@keyframes sink { 20% { transform: translateX(-50%) translateY(-2cqw); } to { transform: translateX(-50%) translateY(3cqw) scale(.15) rotate(220deg); opacity: 0; } }
@keyframes fade { to { opacity: 0; } }
.splash { position: absolute; left: 0; top: 0; }
.splash i {
  position: absolute; width: 10cqw; height: 4cqw; left: -5cqw; top: -2cqw; border-radius: 50%;
  border: .6cqw solid var(--water); opacity: 0; animation: ring 1s 1s ease-out forwards;
}
.splash i + i { animation-delay: 1.15s; }
.splash b {
  position: absolute; width: 1.6cqw; height: 1.6cqw; left: -.8cqw; top: -.8cqw; border-radius: 50%;
  background: var(--water-hi); opacity: 0; animation: drop .8s 1s ease-out forwards;
}
.splash b:nth-of-type(1) { --dx: -5cqw; }
.splash b:nth-of-type(2) { --dx: 0cqw; }
.splash b:nth-of-type(3) { --dx: 5cqw; }
@keyframes ring { 0% { opacity: 1; transform: scale(.2); } 100% { opacity: 0; transform: scale(1.6); } }
@keyframes drop { 0% { opacity: 1; transform: translate(0, 0); } 50% { transform: translate(var(--dx), -7cqw); } 100% { opacity: 0; transform: translate(calc(var(--dx) * 1.4), -1cqw); } }

/* ---------- ข้อความกลางสนาม ---------- */
.reveal-stack {
  position: absolute; left: 50%; top: 5%; translate: -50% 0; z-index: 2100; pointer-events: none;
  width: 92cqw; display: flex; flex-direction: column; align-items: center; gap: 1.5cqw;
}
.reveal-stack .banner { position: static; translate: none; }
.toast {
  font-size: clamp(30px, 10cqw, 72px); white-space: nowrap; line-height: 1.1;
  -webkit-text-stroke: 1.2cqw var(--ink); paint-order: stroke fill; /* อ่านออกบนพื้นสว่าง */
  animation: boom .7s .25s cubic-bezier(.2,1.6,.4,1) both;
}
.toast.out { --glow: var(--pop); --glow-deep: var(--pop-deep); }
.toast.safe { --glow: var(--mint); --glow-deep: var(--mint-deep); }
.toast.save { --glow: var(--cyan); --glow-deep: var(--water-deep); white-space: normal; text-align: center; font-size: clamp(26px, 8cqw, 56px); }
@keyframes boom { from { transform: scale(.2) rotate(-12deg); opacity: 0; } to { transform: scale(1) rotate(-4deg); opacity: 1; } }

.hint {
  justify-self: center; text-align: center; color: var(--on-night); font-size: 15px; line-height: 1.4;
  padding: 8px 16px; border-radius: 99px; background: var(--glass); border: 1px solid var(--glass-line);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}

/* ---------- ช่วงลุ้นก่อนเฉลย ---------- */
.arena.suspense { animation: strobe .26s steps(2) infinite; }
@keyframes strobe { 50% { box-shadow: 0 0 0 3px #fff, 0 0 0 7px var(--night-3), 0 0 0 9px var(--sun), 0 0 50px 14px rgba(255,210,63,.55), 0 30px 60px rgba(5,3,30,.6); } }
.suspense .sign { animation: jitter .18s ease-in-out infinite alternate; animation-delay: calc(var(--i) * -.05s); }
@keyframes jitter { from { transform: translateX(-50%) rotate(-2.5deg); } to { transform: translateX(-50%) rotate(2.5deg); } }
.hole.bad .water { animation: whirl 1.1s linear infinite, drain .6s calc(var(--i) * .12s) ease-out both; }
@keyframes drain { from { filter: saturate(1) brightness(1.1); } to { filter: saturate(.5) brightness(.65); } }
.hole.ok .water::after {
  content: ""; position: absolute; inset: -40%; border-radius: 50%;
  background: radial-gradient(circle, rgba(61,255,168,.65), transparent 60%); animation: flare .9s ease-out both;
}
@keyframes flare { from { transform: scale(.2); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }

/* ---------- เหลือไม่กี่คนสุดท้าย ---------- */
.arena.final { animation: danger 1.2s ease-in-out infinite; }
@keyframes danger { 50% { box-shadow: 0 0 0 3px #fff, 0 0 0 7px var(--night-3), 0 0 0 9px #ff3b3b, 0 0 60px 16px rgba(255,59,59,.55), 0 30px 60px rgba(5,3,30,.6); } }

/* ---------- นับถอยหลัง / ไปเลย / ป้ายประกาศ ---------- */
.count, .go, .banner { position: absolute; left: 50%; pointer-events: none; z-index: 2100; }
.count { top: 58%; translate: -50% -50%; display: grid; place-items: center; width: 40cqw; aspect-ratio: 1; }
.count b { font-size: 30cqw; line-height: 1; --glow: var(--sun); --glow-deep: var(--sun-deep); -webkit-text-stroke: 1.2cqw var(--ink); paint-order: stroke fill; animation: countpop .9s cubic-bezier(.2,1.5,.4,1) both; }
.count .burst { position: absolute; inset: 0; border-radius: 50%; border: 1.6cqw solid var(--sun); box-shadow: 0 0 4cqw var(--sun); animation: burst .9s ease-out both; }
@keyframes countpop { 0% { transform: scale(2.2); opacity: 0; } 30% { transform: scale(1); opacity: 1; } 100% { transform: scale(.9); opacity: .85; } }
@keyframes burst { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
.banner {
  top: 28%; translate: -50% -50%; white-space: nowrap; font-size: clamp(22px, 8cqw, 54px);
  --glow: #ff3b3b; --glow-deep: #8a0f0f; -webkit-text-stroke: .8cqw var(--ink); paint-order: stroke fill;
  animation: slam .5s cubic-bezier(.2,1.6,.4,1) both;
}
.banner.ok {
  top: 14%; white-space: normal; width: max-content; max-width: 88cqw; text-align: center; line-height: 1.1;
  font-size: clamp(22px, 7cqw, 50px); --glow: var(--mint); --glow-deep: var(--mint-deep); color: #eafff4;
}
.banner.ok small { display: block; font-size: .42em; letter-spacing: .14em; }
@keyframes slam { from { transform: scale(2.5) rotate(-8deg); opacity: 0; } to { transform: scale(1) rotate(-4deg); opacity: 1; } }
.go {
  top: 50%; translate: -50% -50%; white-space: nowrap; font-size: clamp(44px, 16cqw, 110px);
  --glow: var(--mint); --glow-deep: var(--mint-deep); -webkit-text-stroke: 1.2cqw var(--ink); paint-order: stroke fill;
  animation: goflash .9s ease-out both;
}
@keyframes goflash { 0% { transform: scale(.4) rotate(-6deg); opacity: 0; } 25% { transform: scale(1.1) rotate(-6deg); opacity: 1; } 100% { transform: scale(1.5) rotate(-6deg); opacity: 0; } }

/* ---------- คะแนนลอย / ฝุ่นตอนเดิน ---------- */
.gain {
  position: absolute; left: 0; top: 1.4cqw; translate: -50% 0; white-space: nowrap; z-index: 3;
  font-family: var(--font-display); font-weight: 800; font-style: italic; font-size: clamp(11px, 3cqw, 18px);
  color: #fff; padding: 0 1.6cqw; border-radius: 99px; background: var(--mint-deep);
  box-shadow: 0 0 2cqw rgba(61,255,168,.8); animation: rise 1.4s cubic-bezier(.2,1.4,.4,1) both;
}
/* ของเราตัวใหญ่ + ซ้อนบนสุด เผื่อยืนเบียดกัน */
.me .gain { z-index: 4; background: var(--sun); color: var(--ink); font-size: clamp(14px, 4.2cqw, 26px); box-shadow: 0 0 3cqw rgba(255,210,63,.9); }
@keyframes rise { 0% { transform: translateY(-3cqw) scale(.4); opacity: 0; } 30% { transform: translateY(0) scale(1.15); opacity: 1; } 100% { transform: translateY(0) scale(1); opacity: 1; } }
.dust { position: absolute; left: 0; top: 0; }
.dust i {
  position: absolute; left: -1cqw; top: -.6cqw; width: 2cqw; height: 1.4cqw; border-radius: 50%;
  background: rgba(91,83,144,.35); animation: puff .5s ease-out infinite;
}
.dust i + i { animation-delay: .25s; left: 0; }
@keyframes puff { from { transform: translate(0, 0) scale(.5); opacity: .9; } to { transform: translate(-3cqw, -1.4cqw) scale(1.6); opacity: 0; } }

/* น้ำ WebGL วาดอยู่ใต้หลุม → ทำ .water ให้โปร่ง เหลือแค่ขอบสระ */
.arena.gl .water { background: transparent; }
.arena.gl .water i { display: none; }
.arena.gl .hole.bad .water { background: transparent; animation: none; }
</style>
