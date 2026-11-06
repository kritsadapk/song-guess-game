<script setup lang="ts">
// ตัวละครถั่วกลม ๆ 4 แบบ: 0 หูฟัง, 1 หมวกแก๊ป, 2 โบว์, 3 ต้นอ่อน
defineProps<{ color: string; look: number; face?: 1 | -1; walking?: boolean; cheer?: boolean }>();
</script>

<template>
  <svg class="bean" :class="{ walking, cheer }" :style="{ '--blink': (color.charCodeAt(2) + look) % 4 }" viewBox="0 0 44 54" aria-hidden="true">
    <ellipse class="shadow" cx="22" cy="50" rx="13" ry="3.4" />
    <g class="bob">
      <g :transform="face === -1 ? 'translate(44 0) scale(-1 1)' : undefined">
        <!-- เท้า -->
        <rect class="foot f1" x="12" y="41" width="8" height="7" rx="3.5" :style="{ fill: `color-mix(in srgb, ${color} 70%, #102036)` }" />
        <rect class="foot f2" x="24" y="41" width="8" height="7" rx="3.5" :style="{ fill: `color-mix(in srgb, ${color} 70%, #102036)` }" />
        <!-- ตัว -->
        <path d="M7 24a15 15 0 0 1 30 0v13a9 9 0 0 1-9 9H16a9 9 0 0 1-9-9z" :fill="color" stroke="#102036" stroke-width="2" />
        <path d="M11 22a11 11 0 0 1 8-10" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round" fill="none" />
        <!-- หน้า -->
        <g class="eyes">
          <ellipse cx="20" cy="24" rx="4.2" ry="4.8" fill="#fff" stroke="#102036" stroke-width="1.4" />
          <ellipse cx="30" cy="24" rx="4.2" ry="4.8" fill="#fff" stroke="#102036" stroke-width="1.4" />
          <circle cx="21.4" cy="25" r="2" fill="#102036" />
          <circle cx="31.4" cy="25" r="2" fill="#102036" />
        </g>
        <ellipse cx="15" cy="31" rx="2.6" ry="1.6" fill="#ff4f8b" opacity=".45" />
        <ellipse cx="34" cy="31" rx="2.6" ry="1.6" fill="#ff4f8b" opacity=".45" />
        <path d="M23 31.5q2.5 2.4 5 0" stroke="#102036" stroke-width="1.6" fill="none" stroke-linecap="round" />
        <!-- ของบนหัว -->
        <g v-if="look === 0">
          <path d="M7 22a15 15 0 0 1 30 0" stroke="#102036" stroke-width="3.2" fill="none" />
          <rect x="3" y="18" width="7" height="11" rx="3" fill="#ff4f8b" stroke="#102036" stroke-width="1.6" />
          <rect x="34" y="18" width="7" height="11" rx="3" fill="#ff4f8b" stroke="#102036" stroke-width="1.6" />
        </g>
        <g v-else-if="look === 1">
          <path d="M9 17a13 11 0 0 1 26 0z" fill="#ffd23f" stroke="#102036" stroke-width="1.8" />
          <path d="M28 16.5h12a2 2 0 0 1 0 3.2H27z" fill="#e8860c" stroke="#102036" stroke-width="1.6" />
        </g>
        <g v-else-if="look === 2">
          <path d="M22 8l-8-5v10zM22 8l8-5v10z" fill="#ff4f8b" stroke="#102036" stroke-width="1.6" stroke-linejoin="round" />
          <circle cx="22" cy="8" r="2.6" fill="#ffd23f" stroke="#102036" stroke-width="1.4" />
        </g>
        <g v-else>
          <path d="M22 10v-6" stroke="#178a5a" stroke-width="2.2" stroke-linecap="round" />
          <path d="M22 5c-3-4-8-3-9 0 3 2 7 2 9 0zM22 5c3-4 8-3 9 0-3 2-7 2-9 0z" fill="#2ee59d" stroke="#102036" stroke-width="1.4" />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.bean { display: block; width: 100%; height: auto; overflow: visible; }
.shadow { fill: rgba(20, 15, 58, .22); }
.walking .bob { animation: bob .26s ease-in-out infinite alternate; }
.walking .f1 { animation: step .26s ease-in-out infinite alternate; }
.walking .f2 { animation: step .26s ease-in-out infinite alternate-reverse; }
@keyframes bob { to { transform: translateY(-2.5px); } }
@keyframes step { to { transform: translateY(-2px); } }
/* กะพริบตา ทุกตัวไม่พร้อมกัน */
.eyes { transform-origin: 25px 24px; transform-box: view-box; animation: blink 4.2s infinite; animation-delay: calc(var(--blink, 0) * 1s); }
@keyframes blink { 0%, 94%, 100% { transform: scaleY(1); } 97% { transform: scaleY(.1); } }
/* ตอบถูก: กระโดดดีใจ */
.cheer .bob { animation: cheer .55s cubic-bezier(.3,1.6,.5,1) 3; }
@keyframes cheer { 0%, 100% { transform: translateY(0); } 45% { transform: translateY(-9px) rotate(-6deg); } }
</style>
