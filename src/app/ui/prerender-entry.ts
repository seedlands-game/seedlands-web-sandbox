import { render } from 'svelte/server';
import AppRoot from './app-root.svelte';
import { createUiBridge } from './ui-bridge';

export function renderPrerenderedStartScreen(): string {
  const bridge = createUiBridge({
    now: () => 0,
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  return render(AppRoot, {
    props: {
      bridge,
      actions: null,
      application: null,
    },
  }).body;
}
