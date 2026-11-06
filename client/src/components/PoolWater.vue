<script setup lang="ts">
// น้ำในสระด้วย WebGL ล้วน (ไม่ใช้ไลบรารี): แสงหักเหใต้น้ำ + พื้นกระเบื้องบิดตามคลื่น + ระลอกคลื่นจากคนเดิน/ตกน้ำ
// ถ้าเครื่องไม่มี WebGL จะไม่ emit ready → สนามใช้น้ำ CSS เดิม
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { inHole, type HoleSpot } from "@shared/protocol";
import type { PlayerView } from "../composables/useGame";

const props = defineProps<{
  layout: HoleSpot[] | null;
  states: number[];            // ต่อหลุม: 0 ปกติ, 1 ถูก, 2 ผิด
  players: PlayerView[];
  falls: string[];             // id คนที่ตกน้ำ (ตอนโชว์เฉลย)
  tap: { x: number; y: number; k: number } | null;
}>();
const emit = defineEmits<{ ready: []; lost: [] }>();

const canvas = ref<HTMLCanvasElement>();
const MAX_POOLS = 6, MAX_RIPPLES = 12;

const VERT = `attribute vec2 a; varying vec2 v; void main(){ v = vec2(a.x * .5 + .5, .5 - a.y * .5); gl_Position = vec4(a, 0., 1.); }`;
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform float uTime, uPx;
uniform vec4 uPools[${MAX_POOLS}];   // x, y, r, state
uniform vec4 uRip[${MAX_RIPPLES}];   // x, y, เวลาเริ่ม, แรง

float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.2831, 6.2831) - 250.;
  vec2 i = p; float c = 1.; float inten = .005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1. - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1. / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c = 1.17 - pow(c / 4., 1.4);
  return pow(abs(c), 8.);
}

void main() {
  vec4 pool = vec4(0.);
  for (int i = 0; i < ${MAX_POOLS}; i++) {
    vec4 pl = uPools[i];
    if (pl.z > 0. && length(v - pl.xy) < pl.z) pool = pl;
  }
  if (pool.z <= 0.) { gl_FragColor = vec4(0.); return; }

  vec2 lp = (v - pool.xy) / pool.z;   // พิกัดในสระ -1..1
  float rr = length(lp);
  float t = uTime;

  // หลุมผิด: น้ำวน
  if (pool.w > 1.5) {
    float a = (1. - rr) * (1. - rr) * 7. + t * 2.5;
    lp = mat2(cos(a), -sin(a), sin(a), cos(a)) * lp;
  }

  // ความชันผิวน้ำ: คลื่นลมเบา ๆ + ระลอกจากเหตุการณ์
  vec2 g = vec2(0.);
  g += vec2(.8, .6) * .06 * cos(dot(lp, vec2(.8, .6)) * 9. + t * 1.7);
  g += vec2(-.5, .85) * .05 * cos(dot(lp, vec2(-.5, .85)) * 13. - t * 2.1);
  g += vec2(.95, -.3) * .035 * cos(dot(lp, vec2(.95, -.3)) * 21. + t * 2.9);
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = t - r.z;
    if (r.w <= 0. || age < 0. || age > 3. || length(r.xy - pool.xy) > pool.z) continue;
    vec2 dv = (v - r.xy) / pool.z;
    float d = length(dv) + 1e-4;
    float front = age * 1.1;
    float env = r.w * exp(-age * 1.4) * smoothstep(front + .05, front - .25, d) * exp(-d * 1.2);
    g += dv / d * env * .9 * cos(d * 38. - age * 26.);
  }

  // พื้นสระกระเบื้อง มองผ่านน้ำ (บิดตามคลื่น)
  vec2 fp = lp * (1. + rr * .12) + g * .09;
  vec2 f = abs(fract(fp * 3.2) - .5);
  float grout = smoothstep(.43, .48, max(f.x, f.y));
  vec3 shallow = vec3(.14, .82, .97), deep = vec3(.02, .36, .70);
  vec3 col = mix(shallow, deep, smoothstep(.0, 1.05, rr));
  col *= 1. - grout * .16;

  // แสงหักเหใต้น้ำ + ไฮไลต์บนผิวน้ำ
  col += vec3(.75, 1., 1.) * caustic(fp * .55 + g * .05, t * .45) * .42 * (1. - rr * .5);
  vec3 n = normalize(vec3(-g * 1.6, 1.));
  float spec = pow(max(dot(reflect(normalize(vec3(.45, .6, -1.)), n), vec3(0., 0., 1.)), 0.), 48.);
  col += spec * .9;
  col += smoothstep(.55, 0., length(lp - vec2(-.35, -.42))) * .18;  // แสงสะท้อนนิ่ง ๆ มุมบน

  // ขอบด้านในเป็นเงา
  col *= mix(1., .55, smoothstep(.72, 1., rr));

  if (pool.w > .5 && pool.w < 1.5) col = mix(col, vec3(.24, 1., .66), .22) + vec3(.05, .12, .08);
  if (pool.w > 1.5) col = mix(col, vec3(dot(col, vec3(.33))), .45) * .62;

  float alpha = smoothstep(1., 1. - 2.5 / (pool.z * uPx), rr);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

let gl: WebGLRenderingContext | null = null;
let raf = 0;
let uTime: WebGLUniformLocation | null, uPx: WebGLUniformLocation | null, uPools: WebGLUniformLocation | null, uRip: WebGLUniformLocation | null;
const t0 = performance.now();
const now = () => ((performance.now() - t0) / 1000) % 1000;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ripples = new Float32Array(MAX_RIPPLES * 4);
let ripI = 0;
const lastWade = new Map<string, number>();

function ripple(x: number, y: number, strength: number, at = now()) {
  if (still) return;
  ripples.set([x, y, at, strength], ripI * 4);
  ripI = (ripI + 1) % MAX_RIPPLES;
}
const poolAt = (x: number, y: number) => props.layout?.find((h) => inHole(x, y, h));

function compile(type: number, src: string) {
  const s = gl!.createShader(type)!;
  gl!.shaderSource(s, src);
  gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) ?? "shader");
  return s;
}

function init() {
  const c = canvas.value!;
  gl = c.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return false;
  // iOS ทิ้ง WebGL ได้ตอนสลับแอป/แรมเต็ม → กลับไปใช้น้ำ CSS
  c.addEventListener("webglcontextlost", () => { gl = null; emit("lost"); }, { once: true });
  try {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    [uTime, uPx, uPools, uRip] = ["uTime", "uPx", "uPools", "uRip"].map((n) => gl!.getUniformLocation(prog, n));
    return true;
  } catch (e) {
    console.warn("น้ำ WebGL ใช้ไม่ได้ ใช้แบบ CSS แทน", e);
    gl = null;
    return false;
  }
}

function frame() {
  raf = requestAnimationFrame(frame);
  const c = canvas.value;
  if (!gl || !c) return;
  // shortcut: จำกัด DPR 1.5 ให้มือถือไม่ร้อน ถ้าจอใหญ่แล้วกระตุกค่อยลดลงอีก
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  gl.viewport(0, 0, w, h);

  const t = now();
  // เดินลุยน้ำ → ระลอกเล็ก ๆ ทุก 0.25 วิ
  for (const p of props.players) {
    if (!p.walking || !p.alive || !poolAt(p.x, p.y)) continue;
    if (t - (lastWade.get(p.id) ?? -9) > 0.25) { lastWade.set(p.id, t); ripple(p.x, p.y, 0.45, t); }
  }

  const pools = new Float32Array(MAX_POOLS * 4);
  props.layout?.slice(0, MAX_POOLS).forEach((p, i) => pools.set([p.x, p.y, p.r, props.states[i] ?? 0], i * 4));
  gl.uniform1f(uTime, still ? 3 : t);
  gl.uniform1f(uPx, w);
  gl.uniform4fv(uPools, pools);
  gl.uniform4fv(uRip, ripples);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// แตะบนน้ำ
watch(() => props.tap?.k, () => { const p = props.tap; if (p && poolAt(p.x, p.y)) ripple(p.x, p.y, 0.8); });
// ตกน้ำ: ตูมใหญ่ตอนตัวจม (ตรงกับแอนิเมชันจมใน Arena ~1 วิ)
watch(() => props.falls.join(), () => {
  for (const id of props.falls) {
    const p = props.players.find((q) => q.id === id);
    if (p) { ripple(p.x, p.y, 2.2, now() + 0.9); ripple(p.x, p.y, 1.2, now() + 1.25); }
  }
});
// เฉลย: หลุมที่ถูกส่งคลื่นจากกลางสระ
watch(() => props.states.join(), () => props.states.forEach((s, i) => {
  const h = props.layout?.[i];
  if (s === 1 && h) ripple(h.x, h.y, 1.2);
}));

onMounted(() => { if (init()) { emit("ready"); frame(); } });
onBeforeUnmount(() => { cancelAnimationFrame(raf); gl?.getExtension("WEBGL_lose_context")?.loseContext(); });
</script>

<template>
  <canvas ref="canvas" class="pool-water" aria-hidden="true"></canvas>
</template>

<style scoped>
.pool-water { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; border-radius: inherit; }
</style>
