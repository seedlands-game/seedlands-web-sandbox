import { hydrate, unmount } from 'svelte';
import AppRoot from './app-root.svelte';
import type { UiBridge } from './ui-bridge';
import type { UiActionPort } from './ui-contracts';
import type { ApplicationShell } from '../application-shell';

export function mountUi(
  target: HTMLElement,
  options: {
    bridge: UiBridge;
    actions: UiActionPort;
    application: ApplicationShell;
    buildWatermark?: string;
    buildCommit?: string;
  },
) {
  const component = hydrate(AppRoot, { target, props: options, recover: false });
  target.dataset.uiRuntime = 'svelte5';
  return () => {
    delete target.dataset.uiRuntime;
    return unmount(component);
  };
}
