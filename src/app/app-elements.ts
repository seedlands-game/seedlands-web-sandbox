const requiredElement = <ElementType extends Element>(selector: string) => {
  const element = document.querySelector<ElementType>(selector);
  if (!element) throw new Error(`缺少应用元素：${selector}`);
  return element;
};

export const appElements = {
  canvas: requiredElement<HTMLCanvasElement>('#game'),
  startCard: requiredElement<HTMLElement>('#start-card'),
  seedInput: requiredElement<HTMLInputElement>('#seed'),
  enterButton: requiredElement<HTMLButtonElement>('#enter'),
  hud: requiredElement<HTMLElement>('#hud'),
  debug: requiredElement<HTMLElement>('#debug'),
  hotbar: requiredElement<HTMLElement>('#hotbar'),
  worldClock: requiredElement<HTMLElement>('#world-clock'),
  interactionFeedback: requiredElement<HTMLElement>('#interaction-feedback'),
  qualitySelect: requiredElement<HTMLSelectElement>('#quality'),
  mapToggle: requiredElement<HTMLButtonElement>('#map-toggle'),
  mapPanel: requiredElement<HTMLElement>('#macro-map-panel'),
  mapClose: requiredElement<HTMLButtonElement>('#map-close'),
  mapLayer: requiredElement<HTMLSelectElement>('#map-layer'),
  mapCanvas: requiredElement<HTMLCanvasElement>('#macro-map'),
};

export type AppElements = typeof appElements;
