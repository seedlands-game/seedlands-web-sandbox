import * as pc from 'playcanvas';

export type RenderContentionVariant = 'A' | 'B';

export type RenderContentionProbeSnapshot = Readonly<{
  variant: RenderContentionVariant;
  armedAtMs: number;
  connectionClickedAtMs: number | null;
  applicationObservedAtMs: number | null;
  readyObservedAtMs: number | null;
  finalPostrenderAtMs: number | null;
  clickToReadyMs: number | null;
  pacedPostrenders: number;
  renderRequests: number;
  previousAutoRender: boolean | null;
  autoRenderRestored: boolean;
  terminal: 'pending' | 'ready' | 'released';
  renderer: string | null;
  vendor: string | null;
}>;

let releaseActive: (() => void) | undefined;
let snapshot: RenderContentionProbeSnapshot | undefined;

function readGraphicsIdentity(app: pc.Application): Readonly<{ renderer: string; vendor: string }> {
  const gl = (app.graphicsDevice as unknown as { gl?: WebGL2RenderingContext }).gl;
  if (!gl) return { renderer: 'UNAVAILABLE', vendor: 'UNAVAILABLE' };
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererParameter = extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER;
  const vendorParameter = extension?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR;
  return {
    renderer: String(gl.getParameter(rendererParameter)),
    vendor: String(gl.getParameter(vendorParameter)),
  };
}

export function arm(variant: RenderContentionVariant): void {
  releaseActive?.();
  const armedAtMs = performance.now();
  snapshot = {
    variant,
    armedAtMs,
    connectionClickedAtMs: null,
    applicationObservedAtMs: null,
    readyObservedAtMs: null,
    finalPostrenderAtMs: null,
    clickToReadyMs: null,
    pacedPostrenders: 0,
    renderRequests: 0,
    previousAutoRender: null,
    autoRenderRestored: false,
    terminal: 'pending',
    renderer: null,
    vendor: null,
  };
  let app: pc.Application | null = null;
  let cadence: number | undefined;
  let animationFrame: number | undefined;
  let postrenderListener: (() => void) | undefined;
  const enterButton = document.querySelector('#enter');
  const markConnectionClick = () => {
    if (snapshot?.terminal === 'pending') snapshot = { ...snapshot, connectionClickedAtMs: performance.now() };
  };
  enterButton?.addEventListener('click', markConnectionClick, { once: true });
  let released = false;

  const restore = (terminal: 'ready' | 'released') => {
    if (released) return;
    released = true;
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    if (cadence !== undefined) window.clearInterval(cadence);
    enterButton?.removeEventListener('click', markConnectionClick);
    if (!app) {
      snapshot = { ...snapshot!, terminal, autoRenderRestored: true };
      return;
    }
    if (postrenderListener) app.off('postrender', postrenderListener);
    app.autoRender = snapshot!.previousAutoRender ?? true;
    app.renderNextFrame = true;
    snapshot = {
      ...snapshot!,
      autoRenderRestored: app.autoRender,
      terminal: terminal === 'released' ? 'released' : 'pending',
    };
    app.once('postrender', () => {
      snapshot = {
        ...snapshot!,
        finalPostrenderAtMs: performance.now(),
        terminal,
      };
    });
  };

  const observe = () => {
    if (released) return;
    app ??= pc.Application.getApplication();
    if (app && snapshot!.applicationObservedAtMs === null) {
      const identity = readGraphicsIdentity(app);
      snapshot = {
        ...snapshot!,
        applicationObservedAtMs: performance.now(),
        previousAutoRender: app.autoRender,
        ...identity,
      };
      postrenderListener = () => {
        if (snapshot?.terminal !== 'pending' || snapshot.variant !== 'B') return;
        snapshot = { ...snapshot, pacedPostrenders: snapshot.pacedPostrenders + 1 };
      };
      app.on('postrender', postrenderListener);
      if (variant === 'B') {
        app.autoRender = false;
        cadence = window.setInterval(() => {
          if (!app || snapshot?.terminal !== 'pending') return;
          app.renderNextFrame = true;
          snapshot = { ...snapshot, renderRequests: snapshot.renderRequests + 1 };
        }, 100);
      }
    }
    if (app && window.__seedlandsRemoteEvidence) {
      const readyObservedAtMs = performance.now();
      snapshot = {
        ...snapshot!,
        readyObservedAtMs,
        clickToReadyMs:
          snapshot!.connectionClickedAtMs === null ? null : readyObservedAtMs - snapshot!.connectionClickedAtMs,
      };
      restore('ready');
      return;
    }
    animationFrame = requestAnimationFrame(observe);
  };
  animationFrame = requestAnimationFrame(observe);
  releaseActive = () => restore('released');
}

export function read(): RenderContentionProbeSnapshot {
  if (!snapshot) throw new Error('Render contention probe is unavailable.');
  return snapshot;
}

export function release(): void {
  releaseActive?.();
}
