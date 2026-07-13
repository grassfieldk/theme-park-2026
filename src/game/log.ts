type Details = Record<string, unknown>

/** 開発中のゲーム操作を開発サーバのコンソールへ記録する */
export function logGameEvent(event: string, details?: Details) {
  if (!import.meta.env.DEV) return
  void fetch('/__new-theme-park-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, details }),
  }).catch(() => {})
}
