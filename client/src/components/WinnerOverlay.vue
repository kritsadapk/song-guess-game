<script setup lang="ts">
import { computed } from "vue";
import { rankPlayers, type Mode } from "@shared/protocol";
import type { PlayerView } from "../composables/useGame";
import Bean from "./Bean.vue";

const props = defineProps<{ players: PlayerView[]; myId: string; mode: Mode }>();
const emit = defineEmits<{ close: [] }>();

const ranked = computed(() => rankPlayers(props.players, props.mode));
const ranking = computed(() => ranked.value.slice(0, 8));
// แชมป์ = กลุ่มอันดับ 1 (คะแนนเท่ากันได้หลายคน) · survival ต้องรอดด้วย
const champs = computed(() => {
  const top = ranked.value[0];
  if (!top || (props.mode === "survival" && !top.alive)) return [];
  return ranked.value.filter((p) => p.alive === top.alive && p.score === top.score);
});
const iWon = computed(() => champs.value.some((p) => p.id === props.myId));
// โพเดียม 3 อันดับแรก เรียง 2-1-3
const podium = computed(() => [ranked.value[1], ranked.value[0], ranked.value[2]].map((p, i) => p && { p, place: [2, 1, 3][i] }).filter(Boolean) as { p: PlayerView; place: number }[]);
const fmt = (n: number) => n.toLocaleString("th-TH");
const CONFETTI = ["#ffd23f", "#ff2e88", "#3dffa8", "#22e4ff", "#a46bff", "#ff8a3d"];
const pieces = Array.from({ length: 48 }, (_, i) => ({
  left: Math.random() * 100, delay: Math.random() * 2.5, dur: 2.6 + Math.random() * 2,
  color: CONFETTI[i % CONFETTI.length], rot: Math.random() * 360, w: 6 + Math.random() * 6,
}));
</script>

<template>
  <div class="overlay" role="dialog" aria-label="ผลการแข่ง">
    <div class="confetti" aria-hidden="true">
      <i v-for="(c, i) in pieces" :key="i"
         :style="{ left: `${c.left}%`, background: c.color, width: `${c.w}px`, animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s`, rotate: `${c.rot}deg` }" />
    </div>
    <div class="panel">
      <p class="kicker">ผลการแข่ง</p>
      <h2 class="puffy" :class="{ none: !champs.length }">{{ champs.length ? (iWon ? "คุณชนะ!" : `${champs[0].name} ชนะ!`) : "ไม่มีใครรอด" }}</h2>
      <div class="podium" v-if="podium.length">
        <div v-for="{ p, place } in podium" :key="p.id" class="step" :class="`p${place}`" :style="{ animationDelay: `${(3 - place) * 0.25}s` }">
          <div class="champ" :class="{ hop: place === 1 }"><Bean :color="p.color" :look="p.look" :cheer="place === 1" /></div>
          <span class="nm">{{ p.name }}</span>
          <div class="block"><b>{{ place }}</b><small>{{ fmt(p.score) }}</small></div>
        </div>
      </div>
      <ol class="rank">
        <li v-for="(p, i) in ranking" :key="p.id" :class="{ me: p.id === myId, win: champs.includes(p) }">
          <span class="pos">{{ i + 1 }}</span>
          <span class="dot" :style="{ background: p.color }"></span>
          <span class="n">{{ p.name }}</span>
          <span class="s">{{ fmt(p.score) }}<small v-if="mode === 'survival' && !p.alive"> · ตกรอบ</small></span>
        </li>
      </ol>
      <button class="btn-pop" @click="emit('close')">กลับไปเดินเล่นในสนาม</button>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px;
  background: radial-gradient(circle at 50% 25%, rgba(42,29,114,.85), rgba(8,6,30,.95));
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: fadein .3s both; overflow-y: auto;
}
@keyframes fadein { from { opacity: 0; } }
.confetti { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.confetti i { position: absolute; top: -20px; height: 14px; border-radius: 2px; animation: fall linear infinite; }
@keyframes fall { to { transform: translateY(110vh) rotate(720deg); } }
.panel {
  position: relative; width: min(420px, 100%); text-align: center; display: grid; gap: 16px; justify-items: center;
  color: var(--on-night);
  background:
    radial-gradient(80% 50% at 50% 0%, rgba(255,210,63,.22), transparent 70%),
    linear-gradient(170deg, rgba(42,29,114,.92), rgba(13,10,46,.96));
  border: 1px solid var(--glass-line);
  border-radius: 28px; padding: 26px 20px 22px;
  box-shadow: 0 0 0 1px rgba(255,210,63,.3), 0 0 60px rgba(255,210,63,.18), 0 30px 60px rgba(0,0,0,.5);
  animation: rise .5s cubic-bezier(.2,1.4,.4,1) both;
}
@keyframes rise { from { transform: translateY(30px) scale(.94); opacity: 0; } }
.kicker { font-family: var(--font-display); font-weight: 600; font-size: 12px; letter-spacing: .14em; color: var(--sun); }
h2 { font-size: clamp(40px, 12vw, 60px); line-height: 1; margin-top: -8px; --glow: var(--sun); --glow-deep: var(--sun-deep); }
h2.none { --glow: var(--cyan); --glow-deep: var(--water-deep); }
.podium { display: flex; justify-content: center; align-items: flex-end; gap: 8px; width: 100%; padding-top: 8px; }
.step { flex: 1; max-width: 110px; display: grid; justify-items: center; gap: 4px; animation: up .6s cubic-bezier(.2,1.4,.4,1) both; }
@keyframes up { from { transform: translateY(40px); opacity: 0; } }
.champ { width: 56px; }
.p1 .champ { width: 72px; }
.champ.hop { animation: jump .9s ease-in-out infinite; }
@keyframes jump { 0%, 70%, 100% { transform: translateY(0); } 35% { transform: translateY(-12px); } }
.nm { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-display); font-weight: 600; font-size: 14px; }
.block {
  width: 100%; display: grid; place-items: center; align-content: start; padding-top: 8px; border-radius: 12px 12px 4px 4px;
  background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.05)); border: 1px solid rgba(255,255,255,.15);
}
.block b { font-family: var(--font-display); font-weight: 800; font-style: italic; font-size: 26px; line-height: 1; }
.block small { font-family: var(--font-display); font-weight: 600; font-size: 13px; color: var(--on-night-soft); }
.p1 .block { height: 96px; background: linear-gradient(180deg, rgba(255,210,63,.45), rgba(255,210,63,.1)); border-color: rgba(255,210,63,.6); box-shadow: 0 0 24px rgba(255,210,63,.3); }
.p1 .block b { color: var(--sun); font-size: 34px; }
.p2 .block { height: 70px; }
.p3 .block { height: 52px; }
.rank { list-style: none; padding: 0; width: 100%; display: grid; gap: 6px; }
.rank li {
  display: grid; grid-template-columns: 22px auto 1fr auto; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 14px;
  background: var(--glass); border: 1px solid rgba(255,255,255,.08); font-size: 15px;
}
.rank li.win { background: rgba(255,210,63,.14); border-color: rgba(255,210,63,.35); }
.rank li.me { box-shadow: inset 0 0 0 2px var(--cyan), 0 0 14px rgba(34,228,255,.3); }
.pos { font-family: var(--font-display); font-weight: 700; font-style: italic; color: var(--on-night-soft); }
.win .pos { color: var(--sun); }
.dot { width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.6); }
.n { text-align: left; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s { color: var(--on-night-soft); font-size: 14px; }
.win .s { color: var(--sun); font-family: var(--font-display); font-weight: 600; }
</style>
