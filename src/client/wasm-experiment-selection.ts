// 默认实验关闭；发布前的分项选择由同一 URL 传给各既有 Worker，不增加线程。
export function wasmExperimentWorkerName(search = globalThis.location?.search ?? ''): string {
  const value = new URLSearchParams(search).get('wasm') ?? '';
  return value && value !== 'off' ? `seedlands-wasm:${value}` : '';
}
