export const wsUrl = (query = "") =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${query}`;

/** WebSocket ที่ต่อใหม่เองเมื่อหลุด */
export function connectWS(url: string, onMessage: (m: any) => void, onStatus?: (open: boolean) => void) {
  let ws: WebSocket | null = null;
  let stopped = false;
  let onOpenCb: (() => void) | null = null;

  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => { onStatus?.(true); onOpenCb?.(); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
    ws.onclose = () => { onStatus?.(false); if (!stopped) setTimeout(open, 1200); };
  };
  open();

  return {
    send(m: unknown) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    onOpen(cb: () => void) { onOpenCb = cb; if (ws?.readyState === WebSocket.OPEN) cb(); },
    close() { stopped = true; ws?.close(); },
  };
}
