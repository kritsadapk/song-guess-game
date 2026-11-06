import { computed, ref, watch } from "vue";

// เพลงจาก YouTube บนเครื่องนี้ (แยกจากเสียงประกอบ)
// auto = ทำตามแอดมิน (ถ้าแอดมินตั้ง "เพลงจากจอทีวี" มือถือจะเงียบ) · on/off = ผู้เล่นเลือกเองแล้ว
type Pref = "auto" | "on" | "off";
const read = (): Pref => { try { const v = localStorage.getItem("sg-music"); return v === "on" || v === "off" ? v : "auto"; } catch { return "auto"; } };
const pref = ref<Pref>(read());
watch(pref, (v) => { try { localStorage.setItem("sg-music", v); } catch { /* ignore */ } });

export const tvAudio = ref(false); // อัปเดตจาก state ของ server
export const musicOn = computed(() => pref.value === "on" || (pref.value === "auto" && !tvAudio.value));
export const toggleMusic = () => { pref.value = musicOn.value ? "off" : "on"; };
