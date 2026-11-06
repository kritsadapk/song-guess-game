import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  server: {
    host: true, // เปิดให้มือถือในวง LAN เข้าทดสอบได้
    proxy: { "/ws": { target: "ws://localhost:3000", ws: true }, "/api": "http://localhost:3000" },
  },
});
