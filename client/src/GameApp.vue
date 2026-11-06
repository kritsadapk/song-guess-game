<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { rankPlayers } from "@shared/protocol";
import Arena from "./components/Arena.vue";
import JoinScreen from "./components/JoinScreen.vue";
import QrCode from "./components/QrCode.vue";
import QuestionCard from "./components/QuestionCard.vue";
import Scoreboard from "./components/Scoreboard.vue";
import WinnerOverlay from "./components/WinnerOverlay.vue";
import { useGame } from "./composables/useGame";
import { useJoinOrigin } from "./lib/joinUrl";
import { musicOn, toggleMusic, tvAudio } from "./lib/music";
import { isMuted, setMuted, sfx, unlockAudio } from "./lib/sfx";

const game = useGame();
const { state, players, connected, joined, notice, remaining, elapsed, revealShown } = game;
// /tv = จอดูอย่างเดียว (เปิดบนทีวี) ไม่มีตัวละครของตัวเอง
const tv = location.pathname.startsWith("/tv");
// จอทีวีคือแหล่งเพลงหลัก ไม่ทำตามสวิตช์ "เพลงจากจอทีวี" (สวิตช์นั้นปิดเฉพาะมือถือ)
if (!tv) watch(() => state.value?.tvAudio, (v) => (tvAudio.value = !!v));
const pid = tv ? "" : game.pid;
const joinOrigin = useJoinOrigin();
const joinHost = computed(() => joinOrigin.value.replace(/^https?:\/\//, ""));
const waiting = computed(() => !state.value || state.value.phase === "lobby" || state.value.phase === "end");
const mode = computed(() => state.value?.mode ?? "survival");

// ช่วงลุ้นต้นเฉลย: server อัปเดตคะแนน/ตกรอบไปแล้ว แต่ยังโชว์ค่าก่อนหน้า กันสปอยล์
const shownPlayers = computed(() => {
  const r = state.value?.reveal;
  if (!r || revealShown.value || state.value?.phase !== "reveal") return players.value;
  return players.value.map((p) => ({ ...p, alive: p.alive || r.eliminated.includes(p.id), score: p.score - (r.gains[p.id] ?? 0) }));
});
const shownMe = computed(() => shownPlayers.value.find((p) => p.id === pid) ?? null);
const aliveCount = computed(() => shownPlayers.value.filter((p) => p.alive).length);
const ranked = computed(() => rankPlayers(shownPlayers.value, mode.value));
const myRank = computed(() => ranked.value.findIndex((p) => p.id === pid) + 1);
const showWinner = ref(false);
watch(() => state.value?.phase, (p) => (showWinner.value = p === "end"));

// ---------- เสียง + เอฟเฟกต์ตามจังหวะเกม ----------
const muted = ref(isMuted());
function toggleMute() { unlockAudio(); setMuted((muted.value = !muted.value)); }

const seconds = computed(() => Math.ceil(remaining.value / 1000));
// ส่งให้สนามเป็นค่าที่เปลี่ยนไม่บ่อย (สนามมีผู้เล่นทุกคน ไม่ควร render ใหม่ทุกเฟรม)
const goFlash = computed(() => state.value?.phase === "question" && elapsed.value < 900);
watch(seconds, (s) => { if (state.value?.phase === "ready" && s > 0) sfx.tick(); });
watch(() => state.value?.phase, (p, prev) => {
  if (p === "question" && prev === "ready") sfx.go();
  else if (p === "reveal") sfx.drumroll();
  else if (p === "scores") sfx.go();
  else if (p === "end" && (prev === "reveal" || prev === "scores")) sfx.fanfare();
});

const fell = ref(0); // key ของเอฟเฟกต์ตกน้ำ (0 = ไม่แสดง)
const spray = Array.from({ length: 14 }, (_, i) => {
  const a = (Math.PI * (i + 0.5)) / 14;
  return { dx: `${Math.cos(a) * -46}vw`, dy: `${-Math.sin(a) * (30 + (i % 3) * 12)}vh` };
});
watch(revealShown, (shown) => {
  const r = state.value?.reveal;
  if (!shown || !r) return;
  if (r.eliminated.includes(pid)) {
    sfx.splash();
    navigator.vibrate?.([90, 40, 220]);
    fell.value = Date.now();
    setTimeout(() => (fell.value = 0), 1700);
  } else if (r.gains[pid] || r.allSaved) sfx.correct();
  else if (r.eliminated.length) sfx.splash();
});
</script>

<template>
  <div v-if="!joined && tv" class="tv-start">
    <img src="/logo.svg" alt="" width="120" height="120">
    <h1><span class="puffy">Song</span> <span class="puffy splash">Splash</span></h1>
    <p>โหมดจอทีวี · แสดงผลอย่างเดียว ไม่ต้องเข้าร่วมเล่น</p>
    <!-- ต้องกดหนึ่งครั้ง เบราว์เซอร์ถึงยอมเปิดเสียงเพลง -->
    <button class="btn-pop" autofocus @click="game.spectate">เริ่มแสดงผล</button>
  </div>
  <JoinScreen v-else-if="!joined" :initial="game.savedProfile()" @join="game.join" />
  <main v-else class="game" :class="{ shake: fell, tv }">
    <header class="bar">
      <span class="logo"><img src="/logo.svg" alt="" width="36" height="36"><span class="puffy">Song</span> <span class="puffy splash">Splash</span></span>
      <span v-if="tv" class="tv-join"><QrCode v-if="!waiting" class="mini-qr" :url="joinOrigin" />เข้าเล่นที่ <b>{{ joinHost }}</b></span>
      <span class="right">
        <button v-if="!tv" class="mute" :class="{ off: !musicOn }" :aria-label="musicOn ? 'ปิดเพลงในเครื่องนี้ (ฟังจากจอทีวีแทน)' : 'เปิดเพลงในเครื่องนี้'" :aria-pressed="!musicOn" :title="musicOn ? 'ปิดเพลง' : 'เปิดเพลง'" @click="toggleMusic">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" fill="currentColor" /><circle cx="18" cy="16" r="3" fill="currentColor" />
            <path v-if="!musicOn" d="M3 3l18 18" stroke-width="2.4" />
          </svg>
        </button>
        <button class="mute" :aria-label="muted ? 'เปิดเสียงประกอบ' : 'ปิดเสียงประกอบ'" :aria-pressed="muted" @click="toggleMute">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
            <template v-if="muted"><path d="m22 9-6 6M16 9l6 6" /></template>
            <template v-else><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></template>
          </svg>
        </button>
        <span class="net" :class="{ ok: connected }" role="status">{{ connected ? "ออนไลน์" : "กำลังเชื่อมต่อ…" }}</span>
      </span>
    </header>
    <p v-if="notice" class="notice" role="alert">{{ notice }}</p>
    <div class="layout">
      <QuestionCard :state="state" :remaining="remaining" :server-now="game.serverNow" :alive-count="aliveCount" :player-count="players.length"
                    :shown="revealShown" :me="shownMe" :my-rank="myRank" :leaders="ranked.slice(0, 5)" :my-id="pid" />
      <div v-if="tv && waiting" class="tv-qr">
        <QrCode :url="joinOrigin" />
        <p><b>สแกนเพื่อเข้าเล่น</b>{{ joinHost }}</p>
      </div>
      <Arena :state="state" :players="players" :my-id="pid" :seconds="seconds" :go-flash="goFlash" :shown="revealShown" :alive-count="aliveCount" @move="game.move" />
    </div>
    <div v-if="fell" :key="fell" class="splash-fx" aria-hidden="true">
      <div class="wave"></div><div class="wave w2"></div>
      <i v-for="(d, i) in spray" :key="i" :style="{ '--dx': d.dx, '--dy': d.dy }"></i>
      <b class="puffy">ตูม!</b>
    </div>
    <Scoreboard v-if="state?.phase === 'scores'" :key="state.qIndex" :state="state" :players="players" :my-id="pid" :seconds="seconds" />
    <WinnerOverlay v-if="showWinner" :players="players" :my-id="pid" :mode="mode" @close="showWinner = false" />
  </main>
</template>

<style scoped>
.game {
  position: relative; z-index: 1;
  width: min(1080px, 100%); margin: 0 auto;
  padding: max(12px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom));
}
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 2px 16px; }
.logo { display: inline-flex; align-items: center; gap: 8px; font-size: clamp(22px, 6vw, 30px); line-height: 1; white-space: nowrap; }
.logo img { width: 1.4em; height: 1.4em; border-radius: 28%; box-shadow: 0 0 0 1px rgba(255,255,255,.15), 0 0 16px rgba(34,228,255,.35); }
.logo .splash { margin-left: -.15em; }
.logo .puffy { text-shadow: 0 0 4px rgba(255,255,255,.5), 0 0 14px var(--pop), 0 3px 0 var(--pop-deep); }
.logo .splash { --glow: var(--cyan); --glow-deep: var(--water-deep); color: #eafcff; text-shadow: 0 0 4px rgba(255,255,255,.5), 0 0 14px var(--cyan), 0 3px 0 var(--water-deep); }
.net {
  font-size: 13px; font-weight: 500; color: var(--on-night-soft);
  background: var(--glass); border: 1px solid var(--glass-line);
  padding: 5px 12px 5px 26px; border-radius: 99px; position: relative; white-space: nowrap;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.net::before { content: ""; position: absolute; left: 11px; top: 50%; width: 8px; height: 8px; margin-top: -4px; border-radius: 50%; background: var(--sun); box-shadow: 0 0 8px var(--sun); animation: blink 1s ease-in-out infinite; }
.net.ok { color: var(--on-night); }
.net.ok::before { background: var(--mint); box-shadow: 0 0 8px var(--mint); animation: none; }
@keyframes blink { 50% { opacity: .3; } }
.right { display: inline-flex; align-items: center; gap: 8px; }
.notice { margin: 0 0 14px; padding: 10px 14px; border-radius: 14px; background: rgba(255,46,136,.18); border: 1px solid var(--pop); color: var(--on-night); text-align: center; }
.mute {
  display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 50%;
  border: 1px solid var(--glass-line); background: var(--glass); color: var(--on-night);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.mute svg { width: 20px; height: 20px; }
.mute.off, .mute[aria-pressed="true"] { color: var(--on-night-soft); opacity: .7; }
.layout { display: grid; gap: 22px; align-items: start; }

/* ตกน้ำ: จอสั่น + คลื่นท่วมจอ */
.game.shake { animation: shake .5s cubic-bezier(.36,.07,.19,.97) both; }
@keyframes shake {
  10%, 90% { transform: translate(-2px, 0); } 20%, 80% { transform: translate(4px, 2px); }
  30%, 50%, 70% { transform: translate(-7px, -2px); } 40%, 60% { transform: translate(7px, 2px); }
}
.splash-fx { position: fixed; inset: 0; z-index: 40; pointer-events: none; overflow: hidden; }
.splash-fx .wave {
  position: absolute; left: -10%; right: -10%; bottom: 0; height: 130%;
  background: linear-gradient(180deg, rgba(127,243,255,.9), rgba(25,200,240,.85) 30%, rgba(10,111,184,.92));
  border-radius: 45% 55% 0 0 / 12% 14% 0 0;
  animation: flood 1.6s cubic-bezier(.3,.7,.3,1) forwards;
}
.splash-fx .wave.w2 { background: rgba(255,255,255,.35); animation-delay: .08s; border-radius: 55% 45% 0 0 / 14% 10% 0 0; }
@keyframes flood {
  0% { transform: translateY(100%); } 35% { transform: translateY(8%); } 60% { transform: translateY(14%); }
  100% { transform: translateY(105%); }
}
.splash-fx b {
  position: absolute; left: 50%; top: 42%; translate: -50% -50%;
  font-size: clamp(72px, 24vw, 180px); --glow: var(--cyan); --glow-deep: var(--water-deep);
  -webkit-text-stroke: 4px var(--abyss); paint-order: stroke fill;
  animation: kaboom 1.6s cubic-bezier(.2,1.6,.4,1) forwards;
}
@keyframes kaboom {
  0% { transform: scale(.2) rotate(-14deg); opacity: 0; } 25% { transform: scale(1.1) rotate(-6deg); opacity: 1; }
  70% { transform: scale(1) rotate(-6deg); opacity: 1; } 100% { transform: scale(1.3) rotate(-6deg); opacity: 0; }
}
.splash-fx i {
  position: absolute; bottom: 40%; left: 50%; width: 18px; height: 18px; border-radius: 50%;
  background: var(--water-hi); box-shadow: 0 0 12px var(--cyan); opacity: 0;
  animation: spray 1.1s .15s cubic-bezier(.2,.8,.4,1) forwards;
}
@keyframes spray { 0% { opacity: 1; transform: translate(0, 0) scale(1); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(.4); } }

@media (min-width: 860px) {
  .layout { grid-template-columns: 340px 1fr; gap: 28px; }
  .layout :deep(.box) { position: sticky; top: 16px; }
  .layout :deep(.disc-area) { flex-direction: column; text-align: center; }
  .layout :deep(.disc-wrap) { width: 240px; }
}

/* ---------- จอทีวี: เต็มจอแนวนอน สนามสี่เหลี่ยมจัตุรัสสูงเต็มจอ ไม่มีสกรอลล์ ---------- */
.tv-start { position: relative; z-index: 1; min-height: 100dvh; display: grid; place-content: center; justify-items: center; gap: 18px; text-align: center; color: var(--on-night-soft); padding: 24px; }
.tv-start img { border-radius: 28%; box-shadow: 0 0 40px rgba(34,228,255,.35); }
.tv-start h1 { font-size: clamp(48px, 8vw, 96px); line-height: 1; }
.tv-start .splash { --glow: var(--cyan); --glow-deep: var(--water-deep); color: #eafcff; }
.tv-start .btn-pop { font-size: 24px; padding: 16px 40px; }
.game.tv { width: 100%; height: 100dvh; overflow: hidden; display: grid; grid-template-rows: auto 1fr; padding: 14px 28px 20px; }
.tv-join { font-family: var(--font-display); font-size: clamp(18px, 1.8vw, 30px); color: var(--on-night-soft); }
.tv-join b { color: var(--sun); text-shadow: 0 0 16px rgba(255,210,63,.5); }
.tv .layout { grid-template-columns: minmax(340px, 1fr) auto; grid-template-rows: 1fr auto 1fr; gap: 20px 32px; align-items: center; min-height: 0; }
.tv .layout > :first-child { grid-row: 2; }
.tv .layout :deep(.arena-shell) { grid-column: 2; grid-row: 1 / -1; width: min(calc(100dvh - 110px), 64vw); }
.tv-qr { grid-row: 3; align-self: start; display: flex; align-items: center; gap: 20px; padding: 16px 20px; border-radius: 24px; background: var(--glass); border: 1px solid var(--glass-line); }
.tv-qr .qr { width: clamp(140px, 18vh, 220px); flex: none; }
.tv-qr p { display: grid; gap: 4px; font-family: var(--font-display); font-size: clamp(18px, 1.6vw, 26px); color: var(--sun); overflow-wrap: anywhere; }
.tv-qr b { color: var(--on-night); font-size: 1.3em; }
.tv-join { display: inline-flex; align-items: center; gap: 12px; }
.mini-qr { width: 56px; border-radius: 8px; }
.tv .layout :deep(.box) { position: static; --vw: min(92vw, 1500px, calc((100dvh - 270px) * 16 / 9)); }
.tv .layout :deep(.disc-wrap) { width: min(34vh, 340px); }
.tv .layout :deep(.copy h2) { font-size: clamp(28px, 2.6vw, 44px); }
.tv .layout :deep(.answer) { font-size: clamp(30px, 2.8vw, 48px) !important; }
</style>
