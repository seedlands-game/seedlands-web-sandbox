/// <reference lib="webworker" />

const scope = self as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<unknown>) => {
  if (event.data === 'seedlands-worker-probe') scope.postMessage('seedlands-worker-ready');
};
