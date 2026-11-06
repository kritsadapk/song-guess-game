<script setup lang="ts">
import { ref } from "vue";
import { COLORS, LOOKS } from "@shared/protocol";
import type { Profile } from "../composables/useGame";
import Bean from "./Bean.vue";

const props = defineProps<{ initial: Profile | null }>();
const emit = defineEmits<{ join: [Profile] }>();

const name = ref(props.initial?.name ?? "");
const color = ref(props.initial?.color && COLORS.includes(props.initial.color) ? props.initial.color : COLORS[Math.floor(Math.random() * COLORS.length)]);
const look = ref(props.initial?.look ?? Math.floor(Math.random() * LOOKS));
const LOOK_NAMES = ["หูฟัง", "หมวกแก๊ป", "โบว์", "ต้นอ่อน"];
// ฟองน้ำลอยพื้นหลัง: สุ่มแบบตายตัวให้กระจายสวยทุกครั้ง
const BUBBLES = Array.from({ length: 10 }, (_, i) => ({
  "--x": `${(i * 37 + 5) % 100}%`, "--s": `${8 + ((i * 7) % 16)}px`, "--d": `${9 + ((i * 5) % 8)}s`, "--w": `${-1.7 * i}s`,
}));

function submit() {
  const n = name.value.trim();
  if (n) emit("join", { name: n, color: color.value, look: look.value });
}
</script>

<template>
  <div class="join">
   <div class="bubbles" aria-hidden="true"><i v-for="(b, i) in BUBBLES" :key="i" :style="b" /></div>
   <div class="wrap">
    <header class="hero">
      <div class="brand">
        <img class="mark" src="/logo.svg" alt="" width="112" height="112">
        <h1 aria-label="Song Splash"><span class="puffy l1">Song</span><span class="puffy l2"><span v-for="(ch, i) in 'Splash!'" :key="i" class="ch" :style="{ '--i': i }">{{ ch }}</span></span></h1>
      </div>
      <p class="slogan">ทายผิด ตกน้ำ!</p>
      <p class="tag">ฟังเพลงให้ทัน แล้ววิ่งไปยืนในสระที่ชื่อเพลงถูก<br>เลือกผิดเมื่อไหร่ <b>ตูม!</b> ลงไปว่ายน้ำเลย</p>
      <ol class="steps">
        <li><b>1</b><span><strong>ฟังเพลง</strong>ดูชื่อเพลงบนป้ายแต่ละสระ</span></li>
        <li><b>2</b><span><strong>วิ่งไปยืน</strong>แตะพื้นเพื่อเดินไปสระที่คิดว่าถูก</span></li>
        <li><b>3</b><span><strong>รอดให้นานที่สุด</strong>ยืนผิดสระ = ตกน้ำ คนสุดท้ายชนะ</span></li>
      </ol>
    </header>

    <form class="card" @submit.prevent="submit">
      <div class="stage">
        <div class="beam" aria-hidden="true"></div>
        <div class="spot" aria-hidden="true"></div>
        <div class="preview"><div class="morph" :key="`${color}${look}`"><Bean :color="color" :look="look" walking /></div></div>
      </div>

      <label class="name">
        <span class="lbl">ชื่อที่จะแสดงบนหัว</span>
        <input v-model="name" maxlength="16" placeholder="เช่น น้องแมว" autocomplete="off" enterkeyhint="go" required>
      </label>

      <fieldset>
        <legend class="lbl">สีตัวละคร</legend>
        <div class="swatches">
          <button v-for="c in COLORS" :key="c" type="button" class="sw" :class="{ on: c === color }"
                  :style="{ '--sw': c }" :aria-label="`สี ${c}`" :aria-pressed="c === color" @click="color = c" />
        </div>
      </fieldset>

      <fieldset>
        <legend class="lbl">ของแต่งหัว</legend>
        <div class="looks">
          <button v-for="(l, i) in LOOK_NAMES" :key="l" type="button" class="lk" :class="{ on: i === look }"
                  :aria-pressed="i === look" @click="look = i">
            <Bean :color="color" :look="i" />
            <span>{{ l }}</span>
          </button>
        </div>
      </fieldset>

      <button class="btn-pop go" type="submit" :disabled="!name.trim()">กระโดดลงสระ!</button>
    </form>
   </div>
  </div>
</template>

<style scoped>
.join {
  position: relative; z-index: 1;
  min-height: 100dvh;
  display: grid; place-items: center;
  padding: max(20px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
}
.wrap { width: min(1040px, 100%); display: grid; justify-items: center; gap: 20px; }

/* มือถือ: โลโก้กับชื่อเรียงแถวเดียว ประหยัดความสูง */
.hero { text-align: center; display: grid; justify-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark {
  display: block; width: clamp(60px, 17vw, 76px); height: auto; border-radius: 28%; flex: none;
  box-shadow: 0 0 0 1px rgba(255,255,255,.15), 0 0 30px rgba(34,228,255,.35), 0 0 60px rgba(255,46,136,.22), 0 12px 24px rgba(5,3,30,.5);
  animation: pop-in .7s cubic-bezier(.34,1.56,.64,1) both, bob 3.2s ease-in-out .7s infinite;
}
@keyframes bob { 50% { transform: translateY(-6px) rotate(-3deg); } }
@keyframes pop-in { from { opacity: 0; transform: scale(.3) rotate(-20deg); } }

/* เข้าฉาก: ทยอยโผล่ทีละส่วน แล้ววนเล่นเบา ๆ (transform/opacity ล้วน ไม่กินเครื่อง) */
.l1 { animation: slide-in .6s .15s cubic-bezier(.22,1,.36,1) both, flicker 6s 2s infinite; }
@keyframes slide-in { from { opacity: 0; transform: translateX(-40px); } }
@keyframes flicker { 0%, 90%, 94%, 100% { opacity: 1; } 92%, 96% { opacity: .55; } }
.ch {
  display: inline-block;
  animation: drop .7s calc(.3s + var(--i) * .06s) cubic-bezier(.34,1.56,.64,1) both,
             wave 4s calc(1.6s + var(--i) * .08s) ease-in-out infinite;
}
@keyframes drop { from { opacity: 0; transform: translateY(-70px) scale(.6); } }
@keyframes wave { 0%, 20%, 100% { transform: none; } 8% { transform: translateY(-10px) scaleY(1.06); } }
.slogan { animation: stamp .5s .9s cubic-bezier(.34,1.56,.64,1) both, wiggle 5s 2.5s ease-in-out infinite; }
@keyframes stamp { from { opacity: 0; transform: rotate(-2deg) scale(2.2); } to { transform: rotate(-2deg); } }
@keyframes wiggle { 0%, 88%, 100% { transform: rotate(-2deg); } 91% { transform: rotate(3deg) scale(1.08); } 95% { transform: rotate(-5deg) scale(1.04); } }
.tag { animation: rise .6s 1.05s ease-out both; }
@keyframes rise { from { opacity: 0; transform: translateY(16px); } }

.bubbles { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: -1; }
.bubbles i {
  position: absolute; bottom: -40px; left: var(--x); width: var(--s); aspect-ratio: 1; border-radius: 50%;
  border: 1.5px solid rgba(160,240,255,.35); background: radial-gradient(circle at 30% 30%, rgba(255,255,255,.4), transparent 60%);
  animation: float var(--d) linear var(--w) infinite;
}
@keyframes float {
  0% { transform: translate(0, 0); opacity: 0; }
  10%, 80% { opacity: .8; }
  50% { transform: translate(18px, -55dvh); }
  100% { transform: translate(-6px, calc(-100dvh - 60px)); opacity: 0; }
}
h1 { display: flex; flex-direction: column; align-items: flex-start; line-height: .9; transform: rotate(-4deg); }
.l1 { font-size: clamp(30px, 9vw, 40px); }
.l2 { font-size: clamp(40px, 12.5vw, 56px); --glow: var(--cyan); --glow-deep: var(--water-deep); color: #eafcff; }
.slogan {
  display: inline-block; margin-top: 18px; padding: 3px 14px; border-radius: 99px;
  font-family: var(--font-display); font-weight: 700; font-style: italic; font-size: 16px;
  color: var(--ink); background: var(--sun); box-shadow: 0 4px 0 var(--sun-deep), 0 0 20px rgba(255,210,63,.45); transform: rotate(-2deg);
}
.tag { margin-top: 12px; max-width: 34ch; color: var(--on-night-soft); font-size: 15px; line-height: 1.6; }
.tag b { color: var(--pop); font-family: var(--font-display); font-style: italic; }
.steps { display: none; }

/* เดสก์ท็อป: สองคอลัมน์ พอดีหนึ่งหน้าจอ */
@media (min-width: 900px) {
  .wrap { grid-template-columns: minmax(0, 460px) 420px; justify-content: center; align-items: center; justify-items: stretch; gap: clamp(40px, 6vw, 96px); }
  .hero { text-align: left; justify-items: start; }
  .brand { flex-direction: column; align-items: flex-start; gap: 18px; }
  .mark { width: 84px; }
  .l1 { font-size: clamp(48px, 5vw, 64px); }
  .l2 { font-size: clamp(68px, 7.6vw, 100px); }
  .slogan { margin-top: 34px; font-size: 18px; }
  .tag { font-size: 16px; }
  .steps {
    display: grid; gap: 10px; margin-top: 24px; padding: 0; list-style: none; width: min(420px, 100%);
  }
  .steps li {
    display: grid; grid-template-columns: 34px 1fr; align-items: center; gap: 12px;
    padding: 10px 14px; border-radius: 16px; background: var(--glass); border: 1px solid rgba(255,255,255,.08);
  }
  .steps b {
    display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%;
    font-family: var(--font-display); font-weight: 800; font-style: italic; color: var(--ink); background: var(--cyan);
    box-shadow: 0 0 14px rgba(34,228,255,.45);
  }
  .steps li:nth-child(2) b { background: var(--sun); box-shadow: 0 0 14px rgba(255,210,63,.45); }
  .steps li:nth-child(3) b { background: var(--pop); color: #fff; box-shadow: 0 0 14px rgba(255,46,136,.5); }
  .steps span { display: grid; font-size: 14px; color: var(--on-night-soft); line-height: 1.4; }
  .steps strong { font-family: var(--font-display); font-weight: 600; font-size: 16px; color: var(--on-night); }
  .steps li { animation: rise .5s both; }
  .steps li:nth-child(1) { animation-delay: 1.2s; }
  .steps li:nth-child(2) { animation-delay: 1.32s; }
  .steps li:nth-child(3) { animation-delay: 1.44s; }
  /* เลขขั้นตอนเด้งทีละอัน 1 → 2 → 3 วนไป */
  .steps b { animation: ping 3.6s 2s ease-out infinite; }
  .steps li:nth-child(2) b { animation-delay: 3.2s; }
  .steps li:nth-child(3) b { animation-delay: 4.4s; }
}
@keyframes ping { 0%, 18%, 100% { transform: none; } 8% { transform: scale(1.22) rotate(-10deg); } }

.card {
  width: min(440px, 100%); justify-self: center;
  border-radius: 28px;
  padding: 0 20px 22px;
  background: linear-gradient(170deg, rgba(42,29,114,.82), rgba(13,10,46,.9));
  border: 1px solid var(--glass-line);
  box-shadow: 0 0 0 1px rgba(0,0,0,.3), 0 0 40px rgba(34,228,255,.15), 0 30px 60px rgba(5,3,30,.6), inset 0 1px 0 rgba(255,255,255,.14);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  display: grid; gap: 16px;
  color: var(--on-night);
  animation: card-in .8s .35s cubic-bezier(.22,1,.36,1) both;
}
@keyframes card-in { from { opacity: 0; transform: translateY(40px) scale(.96); } }
/* เปลี่ยนสี/ของแต่ง → ตัวละครเด้งยืดหด */
.morph { animation: morph .4s cubic-bezier(.34,1.56,.64,1); }
@keyframes morph { from { transform: scale(.7, 1.25); } }
.stage { position: relative; height: 128px; margin: 0 -20px; display: grid; place-items: end center; overflow: hidden; border-radius: 28px 28px 0 0; }
.beam { position: absolute; inset: 0; background: radial-gradient(40% 120% at 50% -10%, rgba(255,210,63,.35), transparent 70%); }
.spot { position: absolute; bottom: 10px; width: 160px; height: 36px; border-radius: 50%; background: radial-gradient(rgba(255,210,63,.5), transparent 70%); }
.preview { width: 84px; position: relative; margin-bottom: 12px; animation: hop 1.4s ease-in-out infinite; }
@keyframes hop { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-14px); } }

fieldset { border: 0; padding: 0; min-width: 0; }
.lbl { display: block; font-family: var(--font-display); font-weight: 500; font-size: 14px; color: var(--on-night-soft); margin-bottom: 8px; }
.swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; }
.sw {
  width: 100%; aspect-ratio: 1; min-height: 32px; padding: 0; border-radius: 50%; border: 0;
  background: var(--sw); box-shadow: inset 0 -3px 0 rgba(0,0,0,.2), 0 0 0 2px rgba(255,255,255,.12);
  transition: transform .15s, box-shadow .15s;
}
.sw:hover { transform: scale(1.06); }
.sw.on { box-shadow: 0 0 0 3px var(--night), 0 0 0 5px #fff, 0 0 18px var(--sw); transform: scale(1.08); }
.looks { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.lk {
  display: grid; justify-items: center; gap: 4px; padding: 10px 4px 8px; border-radius: 16px;
  border: 1.5px solid var(--glass-line); background: var(--glass); font-size: 13px; color: var(--on-night-soft);
  transition: border-color .15s, background .15s, transform .15s;
}
.lk:hover { background: rgba(255,255,255,.1); }
.lk :deep(.bean) { width: 40px; }
.lk.on { border-color: var(--sun); color: var(--on-night); background: rgba(255,210,63,.12); box-shadow: 0 0 16px rgba(255,210,63,.25); }
.name { display: grid; }
.name input {
  font-family: var(--font-display); font-weight: 500; font-size: 22px; text-align: center; color: #fff;
  padding: 12px 14px; border-radius: 16px; border: 1.5px solid var(--glass-line); background: rgba(5,3,30,.45);
  user-select: text; -webkit-user-select: text; transition: border-color .15s, box-shadow .15s;
}
.name input::placeholder { color: rgba(185,178,230,.5); }
.name input:focus { outline: none; border-color: var(--cyan); box-shadow: 0 0 0 3px rgba(34,228,255,.2), 0 0 20px rgba(34,228,255,.25); }
.go { width: 100%; font-size: 22px; margin-top: 4px; }
</style>
