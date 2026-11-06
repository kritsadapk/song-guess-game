import { computed, onBeforeUnmount, ref, shallowRef } from "vue";
import { SUSPENSE_MS, type GameState, type PublicPlayer } from "@shared/protocol";
import { unlockAudio } from "../lib/sfx";
import { connectWS, wsUrl } from "../lib/socket";

export type PlayerView = PublicPlayer & { walking: boolean; face: 1 | -1 };
export interface Profile { name: string; color: string; look: number }

const randomId = () =>
  globalThis.crypto?.randomUUID?.() ??
  (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36));

export function useGame() {
  // บางเบราว์เซอร์บล็อก localStorage (โยน error) → เล่นได้แต่จำตัวเองข้ามการรีเฟรชไม่ได้
  const store = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* ignore */ } return null; };
  const pid = store("sg-pid") || randomId();
  store("sg-pid", pid);

  const state = shallowRef<GameState | null>(null);
  const players = ref<PlayerView[]>([]);
  const connected = ref(false);
  const notice = ref(""); // ข้อความจาก server เช่น ห้องเต็ม
  const joined = ref(false);
  const clock = ref(Date.now());
  let offset = 0;
  let sock: ReturnType<typeof connectWS> | null = null;
  const walkTimers = new Map<string, number>();

  const serverNow = () => Date.now() + offset;
  const remaining = computed(() => (state.value?.endsAt ? Math.max(0, state.value.endsAt - (clock.value + offset)) : 0));
  const elapsed = computed(() => (state.value?.endsAt ? state.value.phaseMs - remaining.value : 0));
  // ต้นช่วงเฉลยเป็นช่วงลุ้น ยังไม่บอกว่าใครถูกผิด
  const revealShown = computed(() => state.value?.phase === "reveal" && elapsed.value >= SUSPENSE_MS);

  let raf = 0;
  const loop = () => { clock.value = Date.now(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  onBeforeUnmount(() => { cancelAnimationFrame(raf); sock?.close(); });

  function onMessage(m: any) {
    if (m.type === "error") notice.value = String(m.message ?? "");
    else if (m.type === "state") {
      offset = m.now - Date.now();
      const prev = new Map(players.value.map((p) => [p.id, p]));
      players.value = (m as GameState).players.map((p) => ({
        ...p, walking: prev.get(p.id)?.walking ?? false, face: prev.get(p.id)?.face ?? 1,
      }));
      state.value = m;
    } else if (m.type === "pos") {
      const byId = new Map(players.value.map((p) => [p.id, p]));
      for (const [id, x, y] of m.p as [string, number, number][]) {
        const p = byId.get(id);
        if (!p) continue;
        if (Math.abs(x - p.x) > 0.002) p.face = x < p.x ? -1 : 1;
        p.x = x; p.y = y; p.walking = true;
        clearTimeout(walkTimers.get(id));
        walkTimers.set(id, window.setTimeout(() => {
          const cur = players.value.find((q) => q.id === id);
          if (cur) cur.walking = false;
        }, 160));
      }
    }
  }

  function connect() {
    unlockAudio();
    joined.value = true;
    sock = connectWS(wsUrl(), onMessage, (ok) => (connected.value = ok));
    return sock;
  }
  function join(profile: Profile) {
    store("sg-profile", JSON.stringify(profile));
    const s = connect();
    s.onOpen(() => s.send({ type: "join", pid, ...profile }));
  }
  // จอทีวี: ต่อเข้าห้องแต่ไม่ส่ง join → server นับเป็นผู้ชม ได้ state ทุกอย่างแต่ไม่มีตัวละคร
  const spectate = () => void connect();

  const move = (x: number, y: number) => sock?.send({ type: "move", x, y });

  const savedProfile = (): Profile | null => {
    try { return JSON.parse(store("sg-profile") || "null"); } catch { return null; }
  };

  return { pid, state, players, connected, joined, notice, remaining, elapsed, revealShown, serverNow, join, spectate, move, savedProfile };
}
