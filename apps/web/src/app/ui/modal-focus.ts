/** 模态面板关闭时恢复焦点，Tab 不能落到遮罩后的世界控件。 */
export function modalFocus(node: HTMLElement, onEscape: () => void) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const controls = () =>
    Array.from(
      node.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ).filter((element) => element.getClientRects().length > 0);
  queueMicrotask(() => {
    node.querySelector('[role="dialog"]')?.setAttribute('aria-modal', 'true');
    controls()[0]?.focus();
  });
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const targets = controls();
    const first = targets[0];
    const last = targets.at(-1);
    if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  node.addEventListener('keydown', keydown);
  return {
    destroy() {
      node.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus();
    },
  };
}
