import { mount, unmount } from 'svelte';
import AppRoot from './app-root.svelte';
import type { UiBridge } from './ui-bridge';
import type { UiActionPort } from './ui-contracts';

export function mountUi(
  target: HTMLElement,
  options: { bridge: UiBridge; actions: UiActionPort; buildWatermark?: string; buildCommit?: string },
) {
  target.replaceChildren();
  target.dataset.uiRuntime = 'svelte5';
  const component = mount(AppRoot, { target, props: options });
  return () => {
    delete target.dataset.uiRuntime;
    return unmount(component);
  };
}
