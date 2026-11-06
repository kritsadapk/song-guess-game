<script setup lang="ts">
// หน้าสรุปอันดับคั่นระหว่างข้อ: โชว์อันดับก่อนข้อนี้ แล้วสลับเป็นอันดับใหม่ให้แถวเลื่อนขึ้นลง + คะแนนวิ่งขึ้น (แบบ Kahoot)
// วิดีโอเพลงเฉลยเล่นต่อที่มุมจอ (QuestionCard ย้ายมาด้วย CSS) หน้านี้แค่วางป้าย "กำลังเล่น" ไว้เหนือวิดีโอ
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { rankPlayers, type GameState } from "@shared/protocol";
import type { PlayerView } from "../composables/useGame";
import Bean from "./Bean.vue";

const props = defineProps<{ state: GameState; players: PlayerView[]; myId: string; seconds: number }>();
const TOP = 8;
const fmt = (n: number) => Math.round(n).toLocaleString("th-TH");

const gains = computed(() => props.state.reveal?.gains ?? {});
const fell = computed(() => new Set(props.state.reveal?.eliminated ?? []));
// อันดับก่อนข้อนี้: หักคะแนนที่เพิ่งได้ + คนที่เพิ่งตกรอบยังนับว่ารอด
const before = computed(() => rankPlayers(props.players.map((p) => ({
  ...p, score: p.score - (gains.value[p.id] ?? 0), alive: p.alive || (props.state.mode === "survival" && fell.value.has(p.id)),
})), props.state.mode));
const after = computed(() => rankPlayers(props.players, props.state.mode));
const rankOf = (list: PlayerView[], id: string) => list.findIndex((p) => p.id === id) + 1;
const move = (id: string) => rankOf(before.value, id) - rankOf(after.value, id);

// 0 → โชว์อันดับเดิม · settled → สลับอันดับ แล้วคะแนนวิ่งขึ้น (prog 0→1)
const settled = ref(false);
const prog = ref(0);
let t = 0, raf = 0;
onMounted(() => {
  t = window.setTimeout(() => {
    settled.value = true;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1100);
      prog.value = 1 - (1 - k) ** 3;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }, 1100);
});
onBeforeUnmount(() => { clearTimeout(t); cancelAnimationFrame(raf); });
// ช่วงแรกแถวมาจาก before (หักคะแนนไว้แล้ว) · หลังสลับค่อยวิ่งจากคะแนนเดิมขึ้นไปคะแนนใหม่
const shownScore = (p: PlayerView) => (settled.value ? p.score - (gains.value[p.id] ?? 0) * (1 - prog.value) : p.score);

const list = computed(() => (settled.value ? after.value : before.value));
const top = computed(() => list.value.slice(0, TOP));
const myRow = computed(() => (rankOf(list.value, props.myId) > TOP ? list.value.find((p) => p.id === props.myId) : null));

const song = computed(() => {
  const q = props.state.question, r = props.state.reveal;
  return q && r ? r.correct.map((i) => q.labels[i]).join(" / ") : "";
});
const isLast = computed(() => props.state.qIndex >= props.state.total - 1);
const footer = computed(() => {
  if (props.state.phaseMs) return `${isLast.value ? "ประกาศผล" : "ข้อต่อไป"}ใน ${props.seconds} วินาที`;
  return isLast.value ? "รอแอดมินประกาศผล…" : "รอแอดมินไปข้อต่อไป…";
});

// ประกายไฟพื้นหลัง (สุ่มแบบตายตัว)
const SPARKS = Array.from({ length: 22 }, (_, i) => ({
  "--x": `${(i * 47 + 11) % 100}%`, "--y": `${(i * 31 + 7) % 100}%`, "--d": `${(i % 5) * 0.45}s`, "--s": `${3 + (i % 4) * 2}px`,
}));
</script>

<template>
  <div class="sb" role="dialog" aria-label="สรุปคะแนน">
    <div class="fx" aria-hidden="true">
      <div class="rays"></div>
      <i v-for="(s, i) in SPARKS" :key="i" :style="s"></i>
    </div>
    <div class="panel">
      <p class="kicker">สรุปคะแนน · ข้อ {{ state.qIndex + 1 }}/{{ state.total }}</p>
      <h2 class="puffy">อันดับตอนนี้</h2>
      <TransitionGroup tag="ol" name="rk" class="rows">
        <li v-for="(p, i) in top" :key="p.id" :style="{ '--i': i }"
            :class="{ me: p.id === myId, out: !p.alive, first: i === 0, rose: settled && move(p.id) > 0 }">
          <span class="pos">{{ i + 1 }}</span>
          <span class="who">
            <svg v-if="i === 0" class="crown" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 1 3l6 5 5-7 5 7 6-5-1 11z" /></svg>
            <Bean :color="p.color" :look="p.look" :cheer="settled && !!gains[p.id]" />
          </span>
          <span class="n">{{ p.name }}<small v-if="!p.alive && state.mode === 'survival'"> · ตกรอบ</small></span>
          <span v-if="settled && move(p.id) > 0" class="mv up" :aria-label="`ขึ้น ${move(p.id)} อันดับ`">▲{{ move(p.id) }}</span>
          <span v-else-if="settled && move(p.id) < 0" class="mv down" :aria-label="`ลง ${-move(p.id)} อันดับ`">▼{{ -move(p.id) }}</span>
          <span v-if="settled && gains[p.id]" class="gain">+{{ fmt(gains[p.id]) }}</span>
          <span class="pts">{{ fmt(shownScore(p)) }}</span>
        </li>
      </TransitionGroup>
      <ol v-if="myRow" class="rows mine">
        <li class="me">
          <span class="pos">{{ rankOf(list, myRow.id) }}</span>
          <span class="who"><Bean :color="myRow.color" :look="myRow.look" /></span>
          <span class="n">{{ myRow.name }} (คุณ)</span>
          <span v-if="settled && gains[myRow.id]" class="gain">+{{ fmt(gains[myRow.id]) }}</span>
          <span class="pts">{{ fmt(shownScore(myRow)) }}</span>
        </li>
      </ol>
      <p v-if="!players.length" class="empty">ยังไม่มีผู้เล่น</p>
      <p class="foot" aria-live="polite">{{ footer }}</p>
    </div>
    <!-- ป้ายเหนือวิดีโอเล็กมุมจอ -->
    <div v-if="song" class="np">
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="np-k">กำลังเล่น</span>
      <b>{{ song }}</b>
    </div>
  </div>
</template>

<style scoped>
.sb {
  position: fixed; inset: 0; z-index: 35; display: grid; place-items: center; overflow-y: auto;
  padding: 20px 20px calc(var(--mini-b) + var(--mini-w) * 9 / 16 + 70px);
  background: radial-gradient(circle at 50% 20%, rgba(42,29,114,.94), rgba(8,6,30,.98));
  animation: fadein .35s both;
}
@media (min-width: 1000px) { .sb { padding-bottom: 20px; } }
@keyframes fadein { from { opacity: 0; } }

/* แสงกวาดหมุน + ประกาย */
.fx { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
.rays {
  position: absolute; left: 50%; top: 22%; width: 180vmax; aspect-ratio: 1; translate: -50% -50%;
  background: repeating-conic-gradient(from 0deg, rgba(255,210,63,.11) 0 8deg, transparent 8deg 24deg);
  mask: radial-gradient(circle, #000 0 10%, transparent 55%); -webkit-mask: radial-gradient(circle, #000 0 10%, transparent 55%);
  animation: spin 40s linear infinite;
}
@keyframes spin { to { rotate: 360deg; } }
.fx i {
  position: absolute; left: var(--x); top: var(--y); width: var(--s); aspect-ratio: 1; border-radius: 50%;
  background: #fff; box-shadow: 0 0 10px 2px rgba(255,210,63,.8); opacity: 0;
  animation: twinkle 2.2s var(--d) ease-in-out infinite;
}
@keyframes twinkle { 50% { opacity: .9; transform: scale(1.3); } }

.panel { position: relative; width: min(680px, 100%); text-align: center; color: var(--on-night); }
.kicker { font-family: var(--font-display); font-weight: 600; letter-spacing: .12em; font-size: 13px; color: var(--sun); animation: rise .4s .1s both; }
h2 {
  font-size: clamp(38px, 8vw, 68px); line-height: 1.1; margin: 4px 0 18px;
  --glow: var(--sun); --glow-deep: var(--sun-deep);
  animation: slam .6s .15s cubic-bezier(.2,1.6,.4,1) both;
}
@keyframes slam { from { transform: scale(2.4) rotate(-6deg); opacity: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }

.rows { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; position: relative; }
.rows li {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: 36px 44px 1fr auto auto auto; align-items: center; gap: 10px;
  padding: 8px 14px; border-radius: 16px; text-align: left;
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
  /* backwards เท่านั้น: ถ้าค้างค่าสุดท้ายไว้ จะทับ transform ของการเลื่อนอันดับ */
  animation: row-in .55s calc(.35s + var(--i, 0) * 70ms) cubic-bezier(.2,1.2,.4,1) backwards;
}
@keyframes row-in { from { opacity: 0; transform: translateX(-60px) skewX(-8deg); } }
.rows li.first { background: linear-gradient(90deg, rgba(255,210,63,.32), rgba(255,255,255,.06)); border-color: rgba(255,210,63,.6); box-shadow: 0 0 28px rgba(255,210,63,.25); }
/* แสงวิ่งผ่านแถวที่ 1 */
.rows li.first::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,.35) 50%, transparent 65%);
  translate: -100% 0; animation: shine 2.6s 1.4s ease-in-out infinite;
}
@keyframes shine { 40%, 100% { translate: 100% 0; } }
.rows li.me { border-color: var(--cyan); box-shadow: 0 0 18px rgba(34,228,255,.35); }
.rows li.out { opacity: .5; }
.rows li.rose { animation: flash 1s .2s ease-out; }
@keyframes flash { 30% { box-shadow: 0 0 0 2px var(--mint), 0 0 30px rgba(61,255,168,.6); } }

.pos { font-family: var(--font-display); font-weight: 800; font-style: italic; font-size: 22px; color: var(--on-night-soft); text-align: center; }
.first .pos { color: var(--sun); font-size: 26px; }
.who { position: relative; }
.who :deep(.bean) { width: 38px; }
.crown { position: absolute; left: 50%; top: -9px; width: 22px; translate: -50% 0; z-index: 1; fill: var(--sun); filter: drop-shadow(0 0 6px rgba(255,210,63,.9)); animation: crown 1.6s ease-in-out infinite; }
@keyframes crown { 50% { transform: translateY(-3px) rotate(-6deg); } }
.n { font-weight: 600; font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.n small { color: var(--on-night-soft); font-weight: 400; }
.mv { font-family: var(--font-display); font-weight: 700; font-size: 13px; animation: pop .45s both; }
.mv.up { color: var(--mint); }
.mv.down { color: var(--pop); }
.gain { font-family: var(--font-display); font-weight: 700; font-size: 14px; color: var(--ink); background: var(--sun); padding: 1px 8px; border-radius: 99px; box-shadow: 0 0 14px rgba(255,210,63,.6); animation: pop .5s cubic-bezier(.2,1.8,.4,1) both; }
.pts { font-family: var(--font-display); font-weight: 800; font-size: 20px; color: var(--sun); min-width: 5ch; text-align: right; font-variant-numeric: tabular-nums; }
@keyframes pop { from { transform: scale(.3); opacity: 0; } }
.mine { margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,.2); }
.empty { color: var(--on-night-soft); }
.foot { margin-top: 18px; color: var(--on-night-soft); font-family: var(--font-display); font-size: 16px; animation: rise .4s 1s both; }

/* แถวเลื่อนไปอันดับใหม่ */
.rk-move { transition: transform .9s cubic-bezier(.3,1.3,.5,1); }
.rk-enter-active { transition: opacity .5s, transform .5s; }
.rk-leave-active { transition: opacity .3s; position: absolute; width: 100%; }
.rk-enter-from { opacity: 0; transform: translateY(20px); }
.rk-leave-to { opacity: 0; }

/* ป้าย "กำลังเล่น" เหนือวิดีโอเล็ก (วิดีโออยู่ใน QuestionCard ตำแหน่งเดียวกัน) */
.np {
  position: fixed; right: var(--mini-r); width: var(--mini-w); bottom: calc(var(--mini-b) + var(--mini-w) * 9 / 16 + 10px);
  display: flex; align-items: center; gap: 8px; text-align: left; color: var(--on-night);
  animation: rise .5s .5s both;
}
.np-k { font-family: var(--font-display); font-size: 12px; letter-spacing: .1em; color: var(--sun); flex: none; }
.np b { font-family: var(--font-display); font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; color: var(--sun); flex: none; }
.eq i { width: 3px; height: 100%; border-radius: 2px; background: currentColor; transform-origin: bottom; animation: eq .9s ease-in-out infinite; }
.eq i:nth-child(2) { animation-delay: -.3s; }
.eq i:nth-child(3) { animation-delay: -.6s; }
.eq i:nth-child(4) { animation-delay: -.15s; }
@keyframes eq { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }

@media (max-width: 480px) {
  .rows li { grid-template-columns: 28px 32px 1fr auto auto; gap: 8px; padding: 7px 10px; }
  .rows li .mv { display: none; }
  .who :deep(.bean) { width: 30px; }
  .n { font-size: 15px; }
  .pts { font-size: 17px; }
}
</style>
