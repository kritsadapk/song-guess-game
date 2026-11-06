<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { SPOTLIGHT_MS, type GameState } from "@shared/protocol";
import type { PlayerView } from "../composables/useGame";
import { musicOn } from "../lib/music";
import { loadYouTube } from "../lib/youtube";

const props = defineProps<{
  state: GameState | null; remaining: number; serverNow: () => number; aliveCount: number; playerCount: number;
  shown: boolean; me: PlayerView | null; myRank: number; leaders: PlayerView[]; myId: string;
}>();
const fmt = (n: number) => n.toLocaleString("th-TH");
const myGain = computed(() => props.state?.reveal?.gains[props.myId] ?? 0);
const iFell = computed(() => !!props.state?.reveal?.eliminated.includes(props.myId));

const host = ref<HTMLElement>();
const needTap = ref(false);
let yt: any = null;
let ytReady = false;
let cuedKey = "";
let playingKey = "";

const phase = computed(() => props.state?.phase ?? "lobby");
const q = computed(() => props.state?.question ?? null);
const qKey = computed(() => (q.value ? `${props.state!.qIndex}:${q.value.youtubeId}` : ""));
const C = 2 * Math.PI * 46;
const frac = computed(() => {
  const s = props.state;
  if (!s) return 0;
  if (s.phase === "reveal") return 1;
  if ((s.phase === "question" || s.phase === "ready") && s.phaseMs) return props.remaining / s.phaseMs;
  return 0;
});
const seconds = computed(() => Math.ceil(props.remaining / 1000));
const hurry = computed(() => phase.value === "question" && props.remaining < 5000);
const answer = computed(() => (props.state?.reveal && q.value ? props.state.reveal.correct.map((i) => q.value!.labels[i]).join(" / ") : ""));
// ช่วงท้ายเฉลย: วิดีโอเดิม (iframe ตัวเดียวกัน ย้ายด้วย CSS ไม่โหลดใหม่) ขยายกลางจอ ปิดเองได้
const closedKey = ref("");
const spot = computed(() => phase.value === "reveal" && props.shown && !!props.state
  && props.state.phaseMs - props.remaining >= SPOTLIGHT_MS && closedKey.value !== qKey.value);

const elapsed = () => {
  const s = props.state!;
  return Math.max(0, (props.serverNow() - (s.endsAt - s.phaseMs)) / 1000);
};

// เพลงรอจาก DJ: เล่นเฉพาะห้องรอ/จบเกม ทุกเครื่องเริ่มที่ตำแหน่งเดียวกันตามเวลาที่แอดมินกดเปิด
const dj = computed(() => (phase.value === "lobby" || phase.value === "end" ? props.state?.dj ?? null : null));
const djKey = computed(() => (dj.value ? `dj:${dj.value.youtubeId}:${dj.value.at}` : ""));

// ถ้าเบราว์เซอร์บล็อกเสียงอัตโนมัติ (iOS) → ขอให้แตะหนึ่งครั้ง
function checkAutoplay() {
  const k = playingKey;
  setTimeout(() => { if (musicOn.value && playingKey === k && yt.getPlayerState?.() !== 1) needTap.value = true; }, 1500);
}

function sync() {
  if (!ytReady || !props.state) return;
  const s = props.state;
  if (!q.value || s.phase === "lobby" || s.phase === "end") {
    const d = dj.value;
    if (d && playingKey !== djKey.value) {
      playingKey = djKey.value;
      cuedKey = "";
      yt.loadVideoById({ videoId: d.youtubeId, startSeconds: d.start + Math.max(0, (props.serverNow() - d.at) / 1000) });
      checkAutoplay();
    } else if (!d && (playingKey || cuedKey)) {
      yt.stopVideo();
      playingKey = cuedKey = "";
      needTap.value = false;
    }
    return;
  }
  if (s.phase === "ready" && cuedKey !== qKey.value) {
    yt.cueVideoById({ videoId: q.value.youtubeId, startSeconds: q.value.start });
    cuedKey = qKey.value;
  } else if (s.phase === "question" && playingKey !== qKey.value) {
    playingKey = qKey.value;
    const at = q.value.start + elapsed();
    if (cuedKey === qKey.value) { yt.seekTo(at, true); yt.playVideo(); }
    else yt.loadVideoById({ videoId: q.value.youtubeId, startSeconds: at });
    checkAutoplay();
  }
}

// เรียกใน event แตะ → sync เล่นใหม่ที่ตำแหน่งปัจจุบันภายใน gesture ของผู้ใช้
function unlock() {
  needTap.value = false;
  if (!yt) return;
  if (musicOn.value) yt.unMute();
  playingKey = "";
  sync();
}

onMounted(async () => {
  const YT = await loadYouTube();
  const el = document.createElement("div");
  host.value?.append(el);
  yt = new YT.Player(el, {
    width: "100%", height: "100%",
    playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0 },
    events: {
      onReady: () => { ytReady = true; if (!musicOn.value) yt.mute(); sync(); },
      onStateChange: (e: any) => {
        if (e.data === 1) needTap.value = false;
        // เพลงรอจบ → วนใหม่
        if (e.data === 0 && dj.value && playingKey === djKey.value) { yt.seekTo(dj.value.start, true); yt.playVideo(); }
      },
    },
  });
});
onBeforeUnmount(() => yt?.destroy?.());
watch(() => [phase.value, qKey.value, djKey.value], sync);
// ปิดเพลง: ยังเล่นวิดีโอบนแผ่นเสียงต่อ แค่ไม่มีเสียง (ไม่ติดเรื่องเบราว์เซอร์บล็อกเสียงด้วย)
watch(musicOn, (on) => {
  if (!ytReady) return;
  if (on) { yt.unMute(); if (playingKey && yt.getPlayerState?.() !== 1) yt.playVideo(); }
  else { yt.mute(); needTap.value = false; }
});
</script>

<template>
  <section class="box" :class="[`ph-${phase}`, { hurry, shown, spot, dj: !!dj }]">
    <template v-if="spot">
      <div class="spot-bg" aria-hidden="true" @click="closedKey = qKey"></div>
      <div class="spot-head" role="status">
        <p class="kicker ok">เฉลย · ข้อ {{ state!.qIndex + 1 }}</p>
        <p class="spot-title puffy">{{ answer }}</p>
      </div>
      <div class="spot-foot">
        <p class="result gain" v-if="myGain">+{{ fmt(myGain) }} คะแนน<span v-if="playerCount > 1"> · อันดับ {{ myRank }}</span></p>
        <p class="result miss" v-else-if="iFell">ตกน้ำ! ข้อนี้ไม่ได้คะแนน</p>
        <button class="spot-x" @click="closedKey = qKey">ดูสนาม</button>
      </div>
    </template>
    <div class="top">
      <span class="chip" v-if="state && state.qIndex >= 0 && phase !== 'lobby' && phase !== 'end'">ข้อ <b>{{ state.qIndex + 1 }}</b> / {{ state.total }}</span>
      <span class="chip ghost" v-else>ห้องรอ</span>
      <span class="stats">
        <span class="score" v-if="me" :aria-label="`คะแนน ${me.score} อันดับ ${myRank}`">
          <b>{{ fmt(me.score) }}</b> คะแนน<em v-if="myRank && playerCount > 1">#{{ myRank }}</em>
        </span>
        <span class="alive" v-if="state?.mode !== 'score'" :aria-label="`รอด ${aliveCount} จาก ${playerCount} คน`"><i aria-hidden="true"></i><b>{{ aliveCount }}</b>/{{ playerCount }}</span>
      </span>
    </div>
    <div class="steps" v-if="state && state.total" aria-hidden="true">
      <span :style="{ width: `${Math.max(0, phase === 'end' ? 1 : (state.qIndex + (phase === 'reveal' || phase === 'scores' ? 1 : 0)) / state.total) * 100}%` }"></span>
    </div>

    <div class="disc-area">
      <div class="disc-wrap">
        <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="track" cx="50" cy="50" r="46" />
          <circle class="prog" cx="50" cy="50" r="46" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - frac)" />
        </svg>
        <div class="disc" :class="{ spin: phase === 'question' || dj }">
          <div class="label">
            <div ref="host" class="yt"></div>
            <div class="label-cover" v-if="!q && !dj">♪</div>
          </div>
          <div class="spindle"></div>
        </div>
        <div class="sheen" aria-hidden="true"></div>
        <div v-if="phase === 'ready'" :key="seconds" class="count puffy">{{ seconds }}</div>
        <button v-if="needTap" class="tap" @click="unlock">แตะเพื่อเปิดเสียง</button>
      </div>

      <div class="copy" aria-live="polite">
        <template v-if="phase === 'lobby'">
          <p class="kicker" v-if="dj"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span> DJ เปิดเพลงรอ</p>
          <p class="kicker" v-else>ห้องรอ</p>
          <h2>รอเริ่มเกม</h2>
          <p v-if="me">แตะพื้นสนามเพื่อเดินวอร์มขาก่อนได้เลย</p>
          <p v-else>{{ playerCount ? `ผู้เล่นเข้ามาแล้ว ${playerCount} คน` : "รอผู้เล่นเข้าห้อง" }}</p>
        </template>
        <template v-else-if="phase === 'ready'">
          <p class="kicker">เตรียมตัว</p>
          <h2>อ่านป้ายให้ทัน!</h2>
          <p>เพลงจะเริ่มใน {{ seconds }} วินาที</p>
        </template>
        <template v-else-if="phase === 'question'">
          <p class="kicker"><span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span> กำลังเล่น</p>
          <h2>เพลงนี้ชื่ออะไร?</h2>
          <p class="time"><b>{{ seconds }}</b> วินาที</p>
          <p class="fast" v-if="me?.streak">สตรีค ×{{ me.streak }} · ถูกอีกได้โบนัส</p>
        </template>
        <template v-else-if="phase === 'reveal' && !shown">
          <p class="kicker ok">เฉลย</p>
          <h2 class="drum">ลุ้น<span>.</span><span>.</span><span>.</span></h2>
        </template>
        <template v-else-if="phase === 'reveal'">
          <p class="kicker ok">เฉลย</p>
          <p class="answer">{{ answer }}</p>
          <p class="result gain" v-if="myGain">+{{ fmt(myGain) }}<span v-if="(me?.streak ?? 0) > 1"> · สตรีค ×{{ me!.streak }}</span><span class="rk" v-if="playerCount > 1"> · อันดับ {{ myRank }}</span></p>
          <p class="result miss" v-else-if="iFell">ตกน้ำ! ข้อนี้ไม่ได้คะแนน<span class="rk" v-if="playerCount > 1"> · อันดับ {{ myRank }}</span></p>
        </template>
        <template v-else-if="phase === 'scores'">
          <p class="kicker ok">สรุปคะแนน</p>
          <h2>อันดับหลังข้อ {{ state!.qIndex + 1 }}</h2>
        </template>
        <template v-else>
          <p class="kicker">จบเกม</p>
          <h2>จบเกมแล้ว</h2>
          <p>รอแอดมินเปิดรอบใหม่</p>
        </template>
      </div>
    </div>

    <ol class="board" v-if="phase === 'reveal' && shown && leaders.length > 1" aria-label="อันดับคะแนน">
      <li v-for="(p, i) in leaders" :key="p.id" :class="{ me: p.id === myId, out: !p.alive }" :style="{ animationDelay: `${i * 70}ms` }">
        <span class="pos">{{ i + 1 }}</span>
        <span class="dot" :style="{ background: p.color }"></span>
        <span class="n">{{ p.name }}</span>
        <span class="pts">{{ fmt(p.score) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.box {
  position: relative;
  color: var(--on-night);
  border-radius: 28px;
  padding: 16px 18px 20px;
  background:
    radial-gradient(120% 60% at 50% 0%, rgba(255,46,136,.16), transparent 60%),
    linear-gradient(170deg, rgba(42,29,114,.85), rgba(13,10,46,.92));
  border: 1px solid var(--glass-line);
  box-shadow: 0 0 0 1px rgba(0,0,0,.3), 0 24px 50px rgba(5,3,30,.6), inset 0 1px 0 rgba(255,255,255,.12);
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: box-shadow .4s;
}
.box.ph-question { box-shadow: 0 0 0 1px rgba(255,46,136,.35), 0 0 40px rgba(255,46,136,.25), 0 24px 50px rgba(5,3,30,.6), inset 0 1px 0 rgba(255,255,255,.12); }
.box.ph-reveal { box-shadow: 0 0 0 1px rgba(61,255,168,.4), 0 0 40px rgba(61,255,168,.22), 0 24px 50px rgba(5,3,30,.6), inset 0 1px 0 rgba(255,255,255,.12); }

.top { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 14px; }
.chip { font-family: var(--font-display); font-weight: 600; background: var(--sun); color: var(--ink); border-radius: 99px; padding: 3px 12px; box-shadow: 0 0 16px rgba(255,210,63,.4); }
.chip b { font-weight: 800; }
.chip.ghost { background: var(--glass); border: 1px solid var(--glass-line); color: var(--on-night-soft); box-shadow: none; }
.alive { display: inline-flex; align-items: center; gap: 6px; color: var(--on-night-soft); font-family: var(--font-display); }
.alive i { width: 8px; height: 8px; border-radius: 50%; background: var(--mint); box-shadow: 0 0 8px var(--mint); }
.alive b { color: var(--mint); font-size: 20px; font-weight: 700; }
.steps { height: 4px; margin-top: 12px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
.steps span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--cyan), var(--pop)); box-shadow: 0 0 10px var(--pop); transition: width .6s ease; }

.disc-area { display: flex; align-items: center; gap: 18px; margin-top: 16px; }
.disc-wrap { position: relative; flex: none; width: clamp(148px, 40vw, 220px); aspect-ratio: 1; }
.ring { position: absolute; inset: 0; transform: rotate(-90deg); overflow: visible; }
.track { fill: none; stroke: rgba(255,255,255,.08); stroke-width: 4; }
.prog { fill: none; stroke: var(--sun); stroke-width: 4; stroke-linecap: round; transition: stroke .3s; filter: drop-shadow(0 0 3px currentColor); color: var(--sun); }
.ph-question .prog { stroke: var(--cyan); color: var(--cyan); }
.hurry .prog { stroke: var(--pop); color: var(--pop); }
.ph-reveal .prog { stroke: var(--mint); color: var(--mint); }

.disc {
  position: absolute; inset: 8%;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, #15151c 0 1.5px, #22222c 1.5px 3px);
  box-shadow: 0 6px 18px rgba(0,0,0,.5), inset 0 0 0 2px #2c2c38;
  display: grid; place-items: center;
}
.disc.spin { animation: spin 2.4s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.sheen {
  position: absolute; inset: 8%; border-radius: 50%; pointer-events: none;
  background: conic-gradient(from 300deg, transparent 0 8%, rgba(255,255,255,.14) 12%, transparent 18% 50%, rgba(255,255,255,.1) 60%, transparent 66%);
}
.label {
  position: relative; width: 50%; aspect-ratio: 1; border-radius: 50%; overflow: hidden;
  background: radial-gradient(circle at 40% 35%, #ff7aa8, var(--pop) 60%, var(--pop-deep));
  box-shadow: 0 0 0 3px #0c0c12;
}
.yt { position: absolute; left: 50%; top: 50%; width: 330%; height: 186%; transform: translate(-50%, -50%); pointer-events: none; filter: blur(9px) saturate(1.3); transition: filter .7s; }
.yt :deep(iframe) { width: 100%; height: 100%; border: 0; }
.shown .yt, .dj .yt { filter: none; }

/* หน้าสรุปคะแนน: ซ่อนการ์ดทั้งใบ เหลือวิดีโอ (iframe เดิม ไม่โหลดใหม่ เพลงเฉลยเล่นต่อ) ย่อไปมุมจอ
   z-index ใส่ที่ .yt ด้วย เพราะบนทีวีการ์ดเป็น position: static (z-index ของการ์ดไม่มีผล) */
.box.ph-scores { visibility: hidden; z-index: 36; backdrop-filter: none; -webkit-backdrop-filter: none; }
.ph-scores .yt {
  visibility: visible; position: fixed; z-index: 37; left: auto; top: auto;
  right: var(--mini-r); bottom: var(--mini-b); width: var(--mini-w); height: calc(var(--mini-w) * 9 / 16);
  transform: none; filter: none; border-radius: 16px; overflow: hidden; transform-origin: 100% 100%;
  box-shadow: 0 0 0 2px var(--sun), 0 0 34px rgba(255,210,63,.45), 0 20px 50px rgba(0,0,0,.6);
  animation: mini-in .8s cubic-bezier(.2,1.2,.4,1) both;
}
@keyframes mini-in { from { transform: translate(-40%, -60%) scale(2.2); opacity: 0; } }

/* ---------- วิดีโอเฉลยเต็มจอ ---------- */
.box { --vw: min(92vw, 880px, calc((100dvh - 270px) * 16 / 9)); }
/* backdrop-filter ทำให้ position: fixed ของลูกอิงกล่องแทนจอ → ปิดตอนขยายวิดีโอ */
.box.spot { z-index: 30; backdrop-filter: none; -webkit-backdrop-filter: none; }
.spot .yt {
  position: fixed; z-index: 2; width: var(--vw); height: calc(var(--vw) * 9 / 16);
  border-radius: 20px; overflow: hidden;
  box-shadow: 0 0 0 3px var(--mint), 0 0 60px rgba(61,255,168,.45), 0 30px 80px rgba(0,0,0,.6);
  animation: spot-in .6s cubic-bezier(.2,1.3,.4,1) both;
}
@keyframes spot-in { from { transform: translate(-50%, -50%) scale(.25); opacity: 0; } }
.spot-bg {
  position: fixed; inset: 0; z-index: 1; cursor: pointer;
  background: radial-gradient(circle at 50% 50%, rgba(20,15,58,.82), rgba(5,3,30,.95));
  animation: fade .4s both;
}
@keyframes fade { from { opacity: 0; } }
.spot-head, .spot-foot { position: fixed; z-index: 3; left: 50%; translate: -50% 0; width: var(--vw); text-align: center; }
.spot-head { bottom: calc(50% + var(--vw) * 9 / 32 + 14px); pointer-events: none; animation: rise-in .5s .15s both; }
.spot-foot { top: calc(50% + var(--vw) * 9 / 32 + 16px); display: flex; justify-content: center; align-items: center; gap: 10px 16px; flex-wrap: wrap; animation: rise-in .5s .3s both; }
@keyframes rise-in { from { opacity: 0; transform: translateY(14px); } }
.spot-title {
  font-size: clamp(26px, 5.4vw, 48px); line-height: 1.15; overflow-wrap: anywhere; text-wrap: balance;
  --glow: var(--mint); --glow-deep: var(--mint-deep); color: #eafff4;
}
.spot-foot .result { font-size: 20px !important; }
.spot-x {
  min-height: 44px; padding: 8px 18px; border-radius: 99px; font-family: var(--font-display); font-weight: 600;
  color: var(--on-night); background: var(--glass); border: 1px solid var(--glass-line);
}
.label-cover { position: absolute; inset: 0; display: grid; place-items: center; font-size: 28px; color: #fff; }
.spindle { position: absolute; width: 7%; aspect-ratio: 1; border-radius: 50%; background: #e7eef5; box-shadow: inset 0 1px 2px rgba(0,0,0,.5); }

.count { position: absolute; inset: 0; display: grid; place-items: center; font-size: clamp(64px, 18vw, 100px); --glow: var(--sun); --glow-deep: var(--sun-deep); animation: pop .9s ease-out both; pointer-events: none; }
@keyframes pop { 0% { transform: scale(1.8); opacity: 0; } 25% { transform: scale(1); opacity: 1; } 100% { transform: scale(.85); opacity: .9; } }
.tap {
  position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); white-space: nowrap;
  border: 0; border-radius: 99px; padding: 10px 16px; min-height: 44px; font-family: var(--font-display); font-weight: 700;
  background: var(--sun); color: var(--ink); box-shadow: 0 4px 0 var(--sun-deep), 0 0 20px rgba(255,210,63,.6); animation: nudge 1s ease-in-out infinite;
}
@keyframes nudge { 50% { transform: translateX(-50%) translateY(-3px); } }

.copy { min-width: 0; }
.kicker { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 600; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--pop) !important; margin: 0 0 4px !important; }
.kicker.ok { color: var(--mint) !important; }
.copy h2 { font-family: var(--font-display); font-weight: 700; font-style: italic; font-size: clamp(20px, 5.4vw, 32px); line-height: 1.15; text-wrap: balance; }
.copy p { margin-top: 6px; color: var(--on-night-soft); font-size: 15px; line-height: 1.55; }
.time b { font-family: var(--font-display); font-weight: 800; font-size: 44px; color: var(--cyan); line-height: 1; text-shadow: 0 0 18px rgba(34,228,255,.6); }
.hurry .time b { color: var(--pop); text-shadow: 0 0 18px rgba(255,46,136,.7); animation: throb .5s ease-in-out infinite alternate; }
@keyframes throb { to { transform: scale(1.08); } }
.time b { display: inline-block; }
.answer { font-family: var(--font-display); font-weight: 700; font-size: clamp(22px, 5.6vw, 30px) !important; color: var(--mint) !important; line-height: 1.2 !important; overflow-wrap: anywhere; text-shadow: 0 0 18px rgba(61,255,168,.45); margin-top: 0 !important; }

.eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
.eq i { width: 3px; height: 100%; border-radius: 2px; background: currentColor; animation: eq .9s ease-in-out infinite; transform-origin: bottom; }
.eq i:nth-child(2) { animation-delay: -.3s; }
.eq i:nth-child(3) { animation-delay: -.6s; }
.eq i:nth-child(4) { animation-delay: -.15s; }
@keyframes eq { 0%, 100% { transform: scaleY(.3); } 50% { transform: scaleY(1); } }

.stats { display: inline-flex; align-items: center; gap: 12px; }
.score { font-family: var(--font-display); color: var(--on-night-soft); white-space: nowrap; }
.score b { color: var(--sun); font-size: 20px; font-weight: 800; text-shadow: 0 0 12px rgba(255,210,63,.45); }
.score em { font-style: italic; font-weight: 700; margin-left: 6px; color: var(--on-night); padding: 1px 8px; border-radius: 99px; background: rgba(255,255,255,.1); }
.fast { color: var(--sun) !important; font-size: 13px !important; }
.drum span { display: inline-block; animation: dot .6s ease-in-out infinite; }
.drum span:nth-child(2) { animation-delay: .1s; }
.drum span:nth-child(3) { animation-delay: .2s; }
@keyframes dot { 50% { transform: translateY(-6px); } }
.result { font-family: var(--font-display); font-weight: 700; font-size: 17px !important; }
.result.gain { color: var(--sun) !important; text-shadow: 0 0 14px rgba(255,210,63,.5); animation: pop .6s cubic-bezier(.2,1.6,.4,1) both; }
.result.miss { color: var(--pop) !important; }

.board { list-style: none; padding: 0; margin-top: 14px; display: none; gap: 5px; }
/* จอแคบ: ไม่โชว์ตารางอันดับ กันสนามถูกดันลง (บอกอันดับในบรรทัดผลแทน) */
@media (min-width: 860px) { .board { display: grid; } .rk { display: none; } }
.board li {
  display: grid; grid-template-columns: 20px 12px 1fr auto; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 12px; background: var(--glass); border: 1px solid rgba(255,255,255,.07);
  font-size: 14px; animation: slidein .4s cubic-bezier(.2,1.2,.4,1) both;
}
.board li.me { border-color: var(--cyan); box-shadow: 0 0 12px rgba(34,228,255,.3); }
.board li.out { opacity: .55; }
.board .pos { font-family: var(--font-display); font-weight: 800; font-style: italic; color: var(--on-night-soft); }
.board li:first-child .pos { color: var(--sun); }
.board .dot { width: 12px; height: 12px; border-radius: 50%; }
.board .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; text-align: left; }
.board .pts { font-family: var(--font-display); font-weight: 700; color: var(--sun); }
@keyframes slidein { from { transform: translateX(-16px); opacity: 0; } }
</style>
