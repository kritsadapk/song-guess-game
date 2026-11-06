import { ref } from "vue";

/** ลิงก์ที่มือถือในห้องเข้าได้ เปิดหน้าด้วย localhost อยู่ → ใช้ IP วง LAN ของเครื่องแทน (QR ชี้ localhost มือถือเข้าไม่ได้) */
export function useJoinOrigin() {
  const origin = ref(location.origin);
  const { protocol, hostname, port } = location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    fetch("/api/lan")
      .then((r) => r.json() as Promise<string[]>)
      .then((ips) => {
        const ip = ips.find((a) => a.startsWith("192.168.")) ?? ips[0];
        if (ip) origin.value = `${protocol}//${ip}${port ? `:${port}` : ""}`;
      })
      .catch(() => { /* ไม่มีวง LAN ก็ใช้ localhost ไป */ });
  }
  return origin;
}
