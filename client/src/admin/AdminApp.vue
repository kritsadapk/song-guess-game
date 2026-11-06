<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { inHole, rankPlayers, type Advance, type GameState, type Mode, type Question } from "@shared/protocol";
import QrCode from "../components/QrCode.vue";
import { useJoinOrigin } from "../lib/joinUrl";
import { connectWS, wsUrl } from "../lib/socket";
import { parseYouTube, thumb } from "../lib/youtube";

type EditQ = Question & { _k: number; _url: string };
let seq = 0;
const toEdit = (q: Question): EditQ => ({ ...q, holes: q.holes.map((h) => ({ ...h })), _k: ++seq, _url: q.youtubeId ? `https://youtu.be/${q.youtubeId}` : "" });
const strip = (list: EditQ[]): Question[] => list.map(({ youtubeId, start, duration, holes }) => ({ youtubeId, start: Number(start) || 0, duration: Number(duration) || 0, holes: holes.map((h) => ({ label: h.label, correct: h.correct })) }));

const MODES: { id: Mode; name: string; desc: string }[] = [
  { id: "survival", name: "เอาตัวรอด", desc: "ผิดแล้วตกรอบ คนสุดท้ายชนะ คะแนนความเร็วใช้ตัดสินถ้ารอดหลายคน" },
  { id: "score", name: "สะสมคะแนน", desc: "ผิดแล้วตกน้ำแต่กลับมาเล่นข้อต่อไป ทุกคนเล่นครบ คะแนนรวมสูงสุดชนะ" },
];
const mode = ref<Mode>(sessionStorage.getItem("sg-mode") === "score" ? "score" : "survival");
function pickMode(m: Mode) { mode.value = m; sessionStorage.setItem("sg-mode", m); }
const ADVANCES: { id: Advance; name: string; desc: string }[] = [
  { id: "auto", name: "ไปต่อเอง", desc: "เฉลย → อันดับ → ข้อต่อไป อัตโนมัติ" },
  { id: "manual", name: "แอดมินกดเอง", desc: "ค้างหน้าเฉลยไว้ กดดูอันดับและข้อต่อไปเอง" },
];

const PHASE: Record<string, string> = { lobby: "ห้องรอ", ready: "นับถอยหลัง", question: "กำลังเล่น", reveal: "โชว์เฉลย", scores: "สรุปคะแนน", end: "จบเกม" };

// ---------- เข้าสู่ระบบ ----------
const params = new URLSearchParams(location.search);
const key = ref(params.get("key") || sessionStorage.getItem("sg-admin-key") || "");
if (params.has("key")) history.replaceState(null, "", location.pathname); // ไม่ทิ้งรหัสไว้ใน URL
const authed = ref(false);
const connecting = ref(false);
const loginError = ref("");
const connected = ref(false);
let sock: ReturnType<typeof connectWS> | null = null;

function login() {
  if (!key.value) return;
  sock?.close();
  connecting.value = true;
  loginError.value = "";
  sock = connectWS(wsUrl(`?role=admin&key=${encodeURIComponent(key.value)}`), onMsg, (ok) => {
    connected.value = ok;
    if (!ok && !authed.value) {
      sock?.close();
      connecting.value = false;
      loginError.value = "รหัสไม่ถูกต้อง หรือเซิร์ฟเวอร์ยังไม่ได้เปิด";
    }
  });
}

// ---------- state ----------
const st = shallowRef<GameState | null>(null);
const qs = ref<EditQ[]>([]);
const saved = ref("[]");
const dirty = computed(() => JSON.stringify(strip(qs.value)) !== saved.value);
let pendingSave = false;
let offset = 0;
const clock = ref(Date.now());
const timerId = setInterval(() => (clock.value = Date.now()), 250);
onBeforeUnmount(() => { clearInterval(timerId); sock?.close(); });
const remain = computed(() => (st.value?.endsAt ? Math.max(0, Math.ceil((st.value.endsAt - clock.value - offset) / 1000)) : 0));
const playing = computed(() => !!st.value && !["lobby", "end"].includes(st.value.phase));
const ranked = computed(() => (st.value ? rankPlayers(st.value.players, st.value.mode) : []));
const send = (m: unknown) => sock?.send(m);

// ตำแหน่งผู้เล่นสด (state ส่งไม่บ่อย ตำแหน่งมากับ pos 20 ครั้ง/วิ) ใช้นับว่าใครยืนสระไหน
const pos = shallowRef(new Map<string, [number, number]>());
const answerOf = (q?: Question) => q?.holes.filter((h) => h.correct).map((h) => h.label).join(" / ") || "—";
const curQ = computed(() => (st.value && playing.value ? qs.value[st.value.qIndex] : undefined));
const nextQ = computed(() => (st.value && playing.value ? qs.value[st.value.qIndex + 1] : undefined));
const dist = computed(() => {
  const s = st.value;
  if (!s?.question || (s.phase !== "question" && s.phase !== "reveal")) return null;
  const inPlay = s.players.filter((p) => p.alive || s.reveal?.eliminated.includes(p.id));
  const counts = s.question.layout.map(() => 0);
  let none = 0;
  for (const p of inPlay) {
    const [x, y] = pos.value.get(p.id) ?? [p.x, p.y];
    const i = s.question.layout.findIndex((h) => inHole(x, y, h));
    if (i < 0) none++; else counts[i]++;
  }
  const right = s.reveal?.correct ?? curQ.value?.holes.flatMap((h, i) => (h.correct ? [i] : [])) ?? [];
  return { rows: s.question.labels.map((label, i) => ({ label, n: counts[i], right: right.includes(i) })), none, total: inPlay.length };
});

// ปุ่มหลักปุ่มเดียว เปลี่ยนตามจังหวะเกม → แอดมินกดปุ่มเดิมไปเรื่อย ๆ ได้
const lastStanding = computed(() => !!st.value && st.value.mode === "survival" && st.value.players.length > 1 && st.value.players.filter((p) => p.alive).length <= 1);
const finalQ = computed(() => !!st.value && (st.value.qIndex >= st.value.total - 1 || lastStanding.value));
const action = computed(() => {
  const s = st.value;
  const ph = s?.phase ?? "lobby";
  if (ph === "lobby" || ph === "end") {
    const hint = dirty.value ? "บันทึกคำถามก่อน ถึงจะเริ่มเกมได้" : !qs.value.length ? "เพิ่มคำถามก่อน" : `${qs.value.length} ข้อ · ${MODES.find((m) => m.id === mode.value)?.name}`;
    return { label: ph === "end" ? "เริ่มรอบใหม่" : "เริ่มเกม", off: dirty.value || !qs.value.length, hint, run: () => send({ type: "start", mode: mode.value }) };
  }
  if (ph === "ready") return { label: "กำลังนับถอยหลัง…", off: true, hint: "", run: () => {} };
  if (ph === "question") return { label: "ตัดเวลา เฉลยเลย", off: false, hint: "ปกติรอให้หมดเวลาก็ได้", run: () => send({ type: "skip" }) };
  if (ph === "reveal" && !finalQ.value) {
    return { label: "ดูอันดับ", off: false, hint: s?.advance === "auto" ? "หมดเวลาเฉลยแล้วจะไปหน้าอันดับเอง" : "หน้าเฉลยค้างไว้จนกว่าจะกด", run: () => send({ type: "scores" }) };
  }
  const hint = ph === "scores" && s?.phaseMs ? `ไปต่อเองใน ${remain.value} วิ` : "";
  return { label: finalQ.value ? "ประกาศผู้ชนะ" : `เพลงถัดไป · ข้อ ${(s?.qIndex ?? 0) + 2}`, off: false, hint, run: () => send({ type: "next" }) };
});
function stopGame() {
  if (playing.value && !confirm("หยุดเกมกลางคัน แล้วกลับห้องรอ?\nคะแนนรอบนี้จะหายทั้งหมด")) return;
  send({ type: "stop" });
}

function onMsg(m: any) {
  if (m.type === "questions") {
    if (!authed.value) { authed.value = true; connecting.value = false; sessionStorage.setItem("sg-admin-key", key.value); }
    if (!dirty.value || pendingSave) {
      qs.value = (m.questions as Question[]).map(toEdit);
      saved.value = JSON.stringify(m.questions);
    }
  } else if (m.type === "state") {
    st.value = m;
    offset = m.now - Date.now();
    pos.value = new Map((m as GameState).players.map((p) => [p.id, [p.x, p.y]]));
  } else if (m.type === "pos") {
    const next = new Map(pos.value);
    for (const [id, x, y] of m.p as [string, number, number][]) next.set(id, [x, y]);
    pos.value = next;
  }
  else if (m.type === "saved") { pendingSave = false; toast("บันทึกคำถามแล้ว"); }
  else if (m.type === "error") { pendingSave = false; toast(m.message, true); }
}

const toastMsg = ref<{ text: string; bad: boolean } | null>(null);
let toastT = 0;
function toast(text: string, bad = false) {
  toastMsg.value = { text, bad };
  clearTimeout(toastT);
  toastT = window.setTimeout(() => (toastMsg.value = null), 2800);
}

// ---------- แก้ไขคำถาม ----------
const blank = (): Question => ({ youtubeId: "", start: 0, duration: 15, holes: [{ label: "", correct: true }, { label: "", correct: false }] });
function addQ() { qs.value.push(toEdit(blank())); setTimeout(() => document.querySelector<HTMLInputElement>(".q:last-child .url")?.focus()); }
const dupQ = (i: number) => qs.value.splice(i + 1, 0, toEdit(strip([qs.value[i]])[0]));
const delQ = (i: number) => qs.value.splice(i, 1);
function moveQ(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= qs.value.length) return;
  [qs.value[i], qs.value[j]] = [qs.value[j], qs.value[i]];
}
function onUrl(q: EditQ) {
  const { id, start } = parseYouTube(q._url);
  q.youtubeId = id;
  if (start !== null) q.start = start;
}
function problem(q: EditQ) {
  if (!q.youtubeId) return "ลิงก์ YouTube ยังไม่ถูกต้อง";
  if (!(q.duration >= 5 && q.duration <= 120)) return "เวลาให้ตอบต้องอยู่ระหว่าง 5–120 วินาที";
  if (q.holes.some((h) => !h.label.trim())) return "ใส่ชื่อเพลงให้ครบทุกหลุม";
  if (!q.holes.some((h) => h.correct)) return "ติ๊กหลุมที่ถูกอย่างน้อย 1 หลุม";
  return "";
}
const problems = computed(() => qs.value.map(problem));
const firstProblem = computed(() => problems.value.findIndex(Boolean));

function save() {
  if (firstProblem.value >= 0) return toast(`ข้อ ${firstProblem.value + 1}: ${problems.value[firstProblem.value]}`, true);
  pendingSave = true;
  sock?.send({ type: "save", questions: strip(qs.value) });
}
const discard = () => { qs.value = (JSON.parse(saved.value) as Question[]).map(toEdit); };

function exportJson() {
  const blob = new Blob([JSON.stringify(strip(qs.value), null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "questions.json" });
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importJson(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error();
    qs.value = data.map((q: any) => toEdit({
      youtubeId: String(q.youtubeId ?? ""), start: Number(q.start) || 0, duration: Number(q.duration) || 15,
      holes: Array.isArray(q.holes) ? q.holes.map((h: any) => ({ label: String(h.label ?? ""), correct: !!h.correct })) : blank().holes,
    }));
    toast(`นำเข้า ${data.length} ข้อแล้ว กดบันทึกเพื่อใช้งาน`);
  } catch { toast("ไฟล์นี้ไม่ใช่ JSON คำถามที่ถูกต้อง", true); }
}

// ---------- ทดลองฟัง ----------
const preview = ref<EditQ | null>(null);
const previewSrc = computed(() => preview.value && `https://www.youtube.com/embed/${preview.value.youtubeId}?start=${preview.value.start}&autoplay=1&rel=0`);

// ---------- DJ เพลงรอ ----------
const djUrl = ref("");
const djLink = computed(() => parseYouTube(djUrl.value));
function playDj() {
  sock?.send({ type: "dj", youtubeId: djLink.value.id, start: djLink.value.start ?? 0 });
  djUrl.value = "";
}

// ---------- ลิงก์ให้ผู้เล่น ----------
const origin = useJoinOrigin();
const links = computed(() => [
  { name: "ลิงก์ผู้เล่น", url: `${origin.value}/` },
  { name: "จอทีวี (ดูอย่างเดียว)", url: `${origin.value}/tv` },
]);
async function copy(url: string) {
  try { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว"); }
  catch { toast(url); }
}

const onUnload = (e: BeforeUnloadEvent) => { if (dirty.value) e.preventDefault(); };
onMounted(() => { window.addEventListener("beforeunload", onUnload); if (key.value) login(); });
onBeforeUnmount(() => window.removeEventListener("beforeunload", onUnload));
</script>

<template>
  <div class="admin">
    <!-- ล็อกอิน -->
    <div v-if="!authed" class="login">
      <form class="login-card" @submit.prevent="login">
        <h1>หลังบ้าน Song Splash</h1>
        <label>รหัสแอดมิน (ADMIN_KEY)
          <input v-model="key" type="password" autocomplete="current-password" autofocus>
        </label>
        <p class="err" v-if="loginError">{{ loginError }}</p>
        <button class="primary" :disabled="connecting || !key">{{ connecting ? "กำลังเชื่อมต่อ…" : "เข้าสู่หลังบ้าน" }}</button>
      </form>
    </div>

    <template v-else>
      <header class="top">
        <h1>Song Splash <small>หลังบ้าน</small></h1>
        <span class="conn" :class="{ ok: connected }">{{ connected ? "เชื่อมต่ออยู่" : "หลุด กำลังต่อใหม่…" }}</span>
      </header>

      <div class="cols">
        <!-- ควบคุมเกม -->
        <aside class="panel live">
          <!-- สถานะตอนนี้ -->
          <div class="phase" :class="st?.phase">
            <span class="ph">{{ PHASE[st?.phase ?? "lobby"] }}</span>
            <span v-if="playing && st">ข้อ {{ st.qIndex + 1 }}/{{ st.total }}</span>
            <span v-if="remain" class="sec">{{ remain }} วิ</span>
          </div>
          <div class="bar" v-if="playing && st"><span :style="{ width: `${((st.qIndex + (['reveal', 'scores'].includes(st.phase) ? 1 : 0)) / st.total) * 100}%` }"></span></div>
          <dl class="songs" v-if="curQ">
            <dt>เพลงนี้</dt><dd>{{ answerOf(curQ) }}</dd>
            <template v-if="nextQ"><dt>ถัดไป</dt><dd>{{ answerOf(nextQ) }}</dd></template>
          </dl>

          <button class="primary big" :disabled="action.off" @click="action.run">{{ action.label }}</button>
          <p class="note" v-if="action.hint">{{ action.hint }}</p>
          <div class="row sub" v-if="playing">
            <button v-if="st?.phase === 'reveal' && !finalQ" @click="send({ type: 'next' })">ข้ามอันดับ ไปเพลงถัดไป</button>
            <button class="danger" @click="stopGame">หยุดเกม</button>
          </div>

          <!-- ใครยืนสระไหน (สด) -->
          <div class="dist" v-if="dist" aria-label="จำนวนคนในแต่ละสระ">
            <div v-for="r in dist.rows" :key="r.label" class="d-row" :class="{ right: r.right }">
              <span class="d-l">{{ r.right ? "✓ " : "" }}{{ r.label }}</span>
              <span class="d-bar"><i :style="{ width: `${dist.total ? (r.n / dist.total) * 100 : 0}%` }"></i></span>
              <b>{{ r.n }}</b>
            </div>
            <div class="d-row none"><span class="d-l">ยังไม่ลงสระ</span><span class="d-bar"><i :style="{ width: `${dist.total ? (dist.none / dist.total) * 100 : 0}%` }"></i></span><b>{{ dist.none }}</b></div>
          </div>

          <!-- ตั้งค่ารอบ -->
          <fieldset class="modes" :disabled="playing">
            <legend>โหมดเกม {{ playing ? "(เปลี่ยนได้ตอนไม่ได้เล่น)" : "" }}</legend>
            <button v-for="m in MODES" :key="m.id" type="button" :class="{ on: (playing ? st?.mode : mode) === m.id }" :aria-pressed="(playing ? st?.mode : mode) === m.id" @click="pickMode(m.id)">
              <b>{{ m.name }}</b><small>{{ m.desc }}</small>
            </button>
          </fieldset>
          <fieldset class="modes">
            <legend>หลังเฉลย (เปลี่ยนได้ระหว่างเกม)</legend>
            <button v-for="a in ADVANCES" :key="a.id" type="button" :class="{ on: st?.advance === a.id }" :aria-pressed="st?.advance === a.id" @click="send({ type: 'advance', value: a.id })">
              <b>{{ a.name }}</b><small>{{ a.desc }}</small>
            </button>
          </fieldset>

          <label class="switch">
            <input type="checkbox" :checked="st?.tvAudio" @change="send({ type: 'tvAudio', value: ($event.target as HTMLInputElement).checked })">
            <span><b>เพลงจากจอทีวีเท่านั้น</b><small>มือถือผู้เล่นปิดเพลงเป็นค่าเริ่มต้น (ใครอยากฟังเปิดเองได้) เสียงไม่ซ้อนกันทั้งห้อง</small></span>
          </label>

          <section class="dj">
            <h2>DJ เพลงรอ <small>{{ st?.dj ? "กำลังเปิด" : "ปิดอยู่" }}</small></h2>
            <div v-if="st?.dj" class="dj-now">
              <img :src="thumb(st.dj.youtubeId, 'mqdefault')" alt="ปกเพลงที่กำลังเปิด">
              <button class="danger" @click="send({ type: 'dj', youtubeId: '' })">หยุดเพลง</button>
            </div>
            <form class="dj-form" @submit.prevent="playDj">
              <input v-model="djUrl" :disabled="playing" placeholder="วางลิงก์ YouTube เพลงรอ" aria-label="ลิงก์ YouTube เพลงรอ">
              <button class="primary" :disabled="playing || !djLink.id">{{ st?.dj ? "เปลี่ยนเพลง" : "เปิดเพลง" }}</button>
            </form>
            <p class="note">เล่นบนเครื่องผู้เล่นและจอทีวีพร้อมกันตอนอยู่ห้องรอ ปิดเองเมื่อเริ่มเกม</p>
          </section>

          <section class="links">
            <div v-for="l in links" :key="l.url" class="lnk">
              <QrCode :url="l.url" />
              <div>
                <span>{{ l.name }}</span>
                <a :href="l.url" target="_blank" rel="noopener">{{ l.url }}</a>
                <button @click="copy(l.url)">คัดลอก</button>
              </div>
            </div>
          </section>

          <h2>ผู้เล่น <small v-if="st?.mode === 'score'">{{ st?.players.length ?? 0 }} คน · เรียงตามคะแนน</small><small v-else>{{ st?.players.filter((p) => p.alive).length ?? 0 }} รอด / {{ st?.players.length ?? 0 }}</small></h2>
          <ul class="players">
            <li v-for="p in ranked" :key="p.id" :class="{ out: !p.alive, off: !p.online }" :title="p.online ? '' : 'หลุดการเชื่อมต่อ'">
              <i :style="{ background: p.color }"></i>{{ p.name }}<small v-if="p.score">{{ p.score.toLocaleString("th-TH") }}</small>
            </li>
            <li v-if="!st?.players.length" class="empty">ยังไม่มีใครเข้า ให้สแกน QR ด้านบน</li>
          </ul>
        </aside>

        <!-- คำถาม -->
        <section class="panel editor">
          <div class="ed-head">
            <h2>คำถาม <small>{{ qs.length }} ข้อ</small></h2>
            <div class="row">
              <label class="file">นำเข้า JSON<input type="file" accept="application/json,.json" @change="importJson"></label>
              <button @click="exportJson" :disabled="!qs.length">ส่งออก JSON</button>
              <button v-if="dirty" @click="discard">ยกเลิกการแก้</button>
              <button class="primary" :disabled="!dirty || playing" @click="save">{{ dirty ? "บันทึกคำถาม" : "บันทึกแล้ว" }}</button>
            </div>
          </div>
          <p class="help">วางลิงก์ YouTube ได้ทุกแบบ ถ้าลิงก์มี <code>?t=45</code> จะตั้งวินาทีเริ่มให้เอง · ติ๊กวงกลมหน้าชื่อเพลงที่เป็นคำตอบ · ข้อละ 2–6 หลุม</p>

          <div v-if="!qs.length" class="empty-ed">
            <p>ยังไม่มีคำถาม เพิ่มข้อแรกแล้ววางลิงก์เพลงได้เลย</p>
            <button class="primary" @click="addQ">เพิ่มคำถามข้อแรก</button>
          </div>

          <ol class="qlist">
            <li v-for="(q, i) in qs" :key="q._k" class="q" :class="{ invalid: problems[i] }">
              <div class="thumb">
                <button v-if="q.youtubeId" class="cover" :style="{ backgroundImage: `url(${thumb(q.youtubeId, 'mqdefault')})` }" @click="preview = q" aria-label="ทดลองฟัง">
                  <span>▶ ทดลองฟัง</span>
                </button>
                <div v-else class="cover none">ยังไม่มีเพลง</div>
                <div class="num">ข้อ {{ i + 1 }}</div>
              </div>
              <div class="fields">
                <input class="url" v-model="q._url" @input="onUrl(q)" placeholder="วางลิงก์ YouTube เช่น https://youtu.be/xxxx?t=30">
                <div class="row nums">
                  <label>เริ่มที่วินาที<input type="number" min="0" v-model.number="q.start"></label>
                  <label>เวลาให้ตอบ (วิ)<input type="number" min="5" max="120" v-model.number="q.duration"></label>
                </div>
                <div class="holes">
                  <div v-for="(h, j) in q.holes" :key="j" class="hole" :class="{ right: h.correct }">
                    <button class="tick" :aria-pressed="h.correct" :title="h.correct ? 'คำตอบถูก' : 'ตั้งเป็นคำตอบถูก'" @click="h.correct = !h.correct">{{ h.correct ? "✓" : "" }}</button>
                    <input v-model="h.label" maxlength="40" :placeholder="`ชื่อเพลงหลุมที่ ${j + 1}`">
                    <button class="x" :disabled="q.holes.length <= 2" @click="q.holes.splice(j, 1)" aria-label="ลบหลุม">×</button>
                  </div>
                  <button class="add-hole" v-if="q.holes.length < 6" @click="q.holes.push({ label: '', correct: false })">+ เพิ่มหลุม</button>
                </div>
                <p class="err" v-if="problems[i]">{{ problems[i] }}</p>
              </div>
              <div class="q-actions">
                <button @click="moveQ(i, -1)" :disabled="i === 0" aria-label="เลื่อนขึ้น">↑</button>
                <button @click="moveQ(i, 1)" :disabled="i === qs.length - 1" aria-label="เลื่อนลง">↓</button>
                <button @click="dupQ(i)" title="ทำซ้ำ">⧉</button>
                <button class="danger" @click="delQ(i)" aria-label="ลบข้อนี้">ลบ</button>
              </div>
            </li>
          </ol>
          <button v-if="qs.length" class="add-q" @click="addQ">+ เพิ่มคำถาม</button>
        </section>
      </div>
    </template>

    <div v-if="preview" class="modal" @click.self="preview = null">
      <div class="modal-card">
        <iframe :src="previewSrc!" allow="autoplay; encrypted-media" title="ทดลองฟัง"></iframe>
        <p>ถ้าวิดีโอขึ้นว่าเล่นในเว็บอื่นไม่ได้ ให้เปลี่ยนลิงก์ (เจ้าของคลิปปิดการ embed)</p>
        <button @click="preview = null">ปิด</button>
      </div>
    </div>

    <div v-if="toastMsg" class="toast" :class="{ bad: toastMsg.bad }" role="status">{{ toastMsg.text }}</div>
  </div>
</template>

<style scoped>
.admin {
  --bg: #eef5fa; --panel: #fff; --line: #d7e4ee; --text: #102036; --muted: #5b7088; --field: #f6fafd;
  --accent: #0a86c9; --good: #13a36e; --bad: #d93a4a;
  min-height: 100dvh; background: var(--bg); color: var(--text); font-size: 15px;
  padding: max(16px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
}
@media (prefers-color-scheme: dark) {
  .admin { --bg: #0b1724; --panel: #12212f; --line: #24384b; --text: #e4eef7; --muted: #8fa6bd; --field: #0e1b28; --accent: #3fc4f7; --good: #2ee59d; --bad: #ff6b7a; color-scheme: dark; }
}
h1, h2 { font-family: var(--font-display); font-weight: 600; }
h1 small, h2 small { font-weight: 400; color: var(--muted); font-size: .7em; margin-left: 6px; }
button {
  border: 1px solid var(--line); background: var(--panel); color: var(--text);
  border-radius: 10px; padding: 7px 13px; transition: background .12s;
}
button:hover:not(:disabled) { background: var(--field); }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
button.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--accent); }
button.danger { color: var(--bad); }
input { background: var(--field); border: 1px solid var(--line); border-radius: 10px; padding: 8px 11px; min-width: 0; width: 100%; color: var(--text); }
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.err { color: var(--bad); font-size: 14px; }

.login { min-height: 90dvh; display: grid; place-items: center; }
.login-card { width: min(360px, 100%); display: grid; gap: 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 24px; }
.login-card h1 { font-size: 22px; }
.login-card label { display: grid; gap: 6px; color: var(--muted); font-size: 14px; }

.top { max-width: 1200px; margin: 0 auto 16px; display: flex; justify-content: space-between; align-items: center; }
.top h1 { font-size: 22px; }
.conn { font-size: 13px; color: var(--muted); }
.conn::before { content: "●"; margin-right: 6px; color: var(--bad); }
.conn.ok::before { color: var(--good); }

.cols { max-width: 1200px; margin: auto; display: grid; gap: 16px; align-items: start; }
@media (min-width: 900px) { .cols { grid-template-columns: 360px 1fr; } .live { position: sticky; top: 16px; max-height: calc(100dvh - 32px); overflow-y: auto; } }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 18px; }

.phase { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ph { font-family: var(--font-display); font-weight: 600; font-size: 24px; }
.phase.question .ph, .phase.ready .ph { color: var(--accent); }
.phase.reveal .ph { color: var(--good); }
.sec { margin-left: auto; font-family: var(--font-display); font-size: 22px; font-variant-numeric: tabular-nums; }
.now { margin-top: 6px; color: var(--muted); font-size: 14px; }
.now b { color: var(--text); }
.modes { border: 0; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.modes legend { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.modes button { display: grid; gap: 2px; text-align: left; padding: 10px 12px; }
.modes button b { font-family: var(--font-display); font-weight: 600; font-size: 15px; }
.modes button small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.modes button.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.modes button.on b { color: var(--accent); }
.bar { height: 6px; border-radius: 99px; background: var(--field); margin-top: 10px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); transition: width .5s; }
.songs { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 10px 0 0; font-size: 14px; }
.songs dt { color: var(--muted); }
.songs dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.big { width: 100%; margin-top: 14px; padding: 14px; font-size: 18px; border-radius: 14px; }
.sub { margin-top: 8px; }
.sub button { flex: 1; }
.dist { margin-top: 14px; display: grid; gap: 6px; font-size: 13px; }
.d-row { display: grid; grid-template-columns: minmax(0, 1.2fr) 1fr 2ch; gap: 8px; align-items: center; }
.d-l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.d-row.right .d-l { color: var(--good); font-weight: 600; }
.d-row.none { color: var(--muted); }
.d-bar { height: 10px; border-radius: 99px; background: var(--field); overflow: hidden; }
.d-bar i { display: block; height: 100%; background: var(--accent); transition: width .3s; }
.d-row.right .d-bar i { background: var(--good); }
.d-row b { text-align: right; font-variant-numeric: tabular-nums; }
.note { font-size: 13px; color: var(--muted); }
.switch { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; cursor: pointer; }
.switch input { width: 20px; height: 20px; margin-top: 2px; flex: none; accent-color: var(--accent); }
.switch span { display: grid; gap: 2px; }
.switch small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.dj { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); display: grid; gap: 8px; }
.dj h2 { margin: 0; }
.dj-now { display: flex; align-items: center; gap: 10px; }
.dj-now img { width: 112px; aspect-ratio: 16/9; object-fit: cover; border-radius: 8px; }
.dj-form { display: flex; gap: 8px; }
.dj-form button { white-space: nowrap; }
.links { margin: 18px 0; padding-top: 14px; border-top: 1px solid var(--line); display: grid; gap: 12px; }
.lnk { display: grid; grid-template-columns: 96px 1fr; gap: 12px; align-items: center; }
.lnk .qr { border: 1px solid var(--line); }
.lnk div { display: grid; gap: 4px; justify-items: start; font-size: 13px; color: var(--muted); min-width: 0; }
.lnk a { font-family: ui-monospace, monospace; color: var(--accent); overflow-wrap: anywhere; }
.lnk button { padding: 4px 10px; font-size: 13px; }
.live h2 { font-size: 17px; margin-bottom: 8px; }
.players { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.players li { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 6px; border-radius: 99px; border: 1px solid var(--line); font-size: 14px; }
.players i { width: 12px; height: 12px; border-radius: 50%; }
.players small { color: var(--muted); }
.players .out { opacity: .45; text-decoration: line-through; }
.players .off { border-style: dashed; }
.players .empty { border: 0; color: var(--muted); padding: 0; }

.ed-head { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; }
.ed-head h2 { font-size: 20px; }
.help { margin: 10px 0 16px; color: var(--muted); font-size: 14px; }
.help code { background: var(--field); padding: 1px 5px; border-radius: 5px; }
.file { position: relative; border: 1px solid var(--line); border-radius: 10px; padding: 7px 13px; cursor: pointer; }
.file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.empty-ed { text-align: center; padding: 36px 10px; display: grid; gap: 14px; justify-items: center; color: var(--muted); border: 2px dashed var(--line); border-radius: 16px; }

.qlist { list-style: none; padding: 0; display: grid; gap: 14px; }
.q { display: grid; grid-template-columns: 168px 1fr auto; gap: 14px; padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }
.q.invalid { border-color: color-mix(in srgb, var(--bad) 50%, var(--line)); }
.thumb { display: grid; gap: 6px; align-content: start; }
.cover { width: 100%; aspect-ratio: 16/9; border-radius: 10px; background: var(--field) center/cover; padding: 0; border: 0; display: grid; place-items: end start; overflow: hidden; color: var(--muted); font-size: 13px; }
.cover span { margin: 6px; padding: 2px 8px; border-radius: 99px; background: rgba(0,0,0,.65); color: #fff; font-size: 12px; }
.cover.none { place-items: center; border: 1px dashed var(--line); }
.num { font-family: var(--font-display); font-weight: 600; color: var(--muted); }
.fields { display: grid; gap: 10px; min-width: 0; }
.nums label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); width: 140px; }
.holes { display: grid; gap: 6px; }
.hole { display: grid; grid-template-columns: 34px 1fr 34px; gap: 6px; align-items: center; }
.tick { width: 34px; height: 34px; border-radius: 50%; padding: 0; font-weight: 700; border: 2px solid var(--line); color: #fff; }
.hole.right .tick { background: var(--good); border-color: var(--good); }
.hole.right input { border-color: color-mix(in srgb, var(--good) 60%, var(--line)); }
.x { width: 34px; height: 34px; padding: 0; color: var(--muted); }
.add-hole { justify-self: start; border-style: dashed; color: var(--muted); }
.q-actions { display: grid; gap: 6px; align-content: start; }
.q-actions button { padding: 6px 10px; }
.add-q { margin-top: 14px; width: 100%; border-style: dashed; padding: 12px; color: var(--muted); }
@media (max-width: 640px) {
  .q { grid-template-columns: 1fr; }
  .thumb { grid-template-columns: 140px 1fr; align-items: center; }
  .q-actions { display: flex; flex-wrap: wrap; }
}

.modal { position: fixed; inset: 0; background: rgba(5,15,25,.7); display: grid; place-items: center; padding: 16px; z-index: 20; }
.modal-card { width: min(720px, 100%); background: var(--panel); border-radius: 16px; padding: 14px; display: grid; gap: 10px; }
.modal-card iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: 10px; background: #000; }
.modal-card p { font-size: 13px; color: var(--muted); }
.modal-card button { justify-self: end; }
.toast { position: fixed; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); transform: translateX(-50%); background: var(--text); color: var(--bg); padding: 10px 18px; border-radius: 12px; font-size: 14px; z-index: 30; max-width: 90vw; }
.toast.bad { background: var(--bad); color: #fff; }
</style>
