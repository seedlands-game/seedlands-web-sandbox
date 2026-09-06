// 经分项验证的浏览器默认内核；URL 保留显式 TS 对照与逐项消融，不增加 Worker。
const defaultKernels = 'w02,w03,w04,w05,w06';
export function wasmExperimentWorkerName(search = globalThis.location?.search ?? ''): string {
  const parameters = new URLSearchParams(search);
  const value = parameters.has('wasm') ? (parameters.get('wasm') ?? '') : defaultKernels;
  return value && value !== 'off' ? `seedlands-wasm:${value}` : '';
}
