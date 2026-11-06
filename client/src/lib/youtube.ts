let loading: Promise<any> | null = null;

export function loadYouTube(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  return (loading ??= new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.append(s);
  }));
}

export function parseYouTube(input: string) {
  const id = input.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/)?.[1]
    ?? input.trim().match(/^([\w-]{11})$/)?.[1] ?? "";
  const t = input.match(/[?&](?:t|start)=(\d+)/);
  return { id, start: t ? Number(t[1]) : null };
}

export const thumb = (id: string, size = "hqdefault") => (id ? `https://i.ytimg.com/vi/${id}/${size}.jpg` : "");
