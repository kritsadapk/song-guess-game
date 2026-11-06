<script setup lang="ts">
import { computed } from "vue";
import { renderSVG } from "uqr";

const props = defineProps<{ url: string }>();
// SVG มาจาก uqr ล้วน (ไม่มีข้อความผู้ใช้ปน) → ใช้ v-html ได้
const svg = computed(() => renderSVG(props.url, { border: 2 }));
</script>

<template>
  <div class="qr" role="img" :aria-label="`QR code ลิงก์ ${url}`" v-html="svg"></div>
</template>

<style scoped>
.qr { background: #fff; border-radius: 12px; line-height: 0; overflow: hidden; }
.qr :deep(svg) { display: block; width: 100%; height: auto; }
</style>
