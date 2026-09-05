import { PerformanceTelemetry } from '../client/performance-telemetry';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../client/performance-profile';
import type { StreamingVariant } from './app-contracts';
import * as pc from 'playcanvas';
import type { LightingQualityBudget } from './advanced-lighting-budget';

class DesktopApplication extends pc.Application {
  override init(options: pc.AppOptions) {
    // AppOptions defaults xr to null at runtime; its declaration omits null.
    // Desktop worlds need no XR manager or its persistent devicechange listener.
    super.init(Object.assign(options, { xr: null }));
  }
}

export function createSceneApplication(canvas: HTMLCanvasElement) {
  const app = new DesktopApplication(canvas, {
    mouse: new pc.Mouse(canvas),
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { alpha: true },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.start();
  return app;
}

export function createSun(app: pc.Application, budget: LightingQualityBudget) {
  const light = new pc.Entity('Sun');
  light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.9, 0.72),
    intensity: 1,
    castShadows: budget.sunShadowResolution > 0,
    shadowResolution: budget.sunShadowResolution || 512,
    shadowType: pc.SHADOW_PCF3_32F,
    shadowUpdateMode: pc.SHADOWUPDATE_REALTIME,
    shadowDistance: 58,
    shadowBias: 0.18,
    normalOffsetBias: 0.06,
  });
  app.root.addChild(light);
  return light;
}

export function createCamera(app: pc.Application, farClip: number) {
  const camera = new pc.Entity('Player');
  camera.addComponent('camera', {
    clearColor: new pc.Color(0, 0, 0, 0),
    fov: 72,
    nearClip: 0.05,
    farClip,
  });
  app.root.addChild(camera);
  return camera;
}

export function selectPerformanceProfile(search: string) {
  const params = new URLSearchParams(search);
  const name = params.get('performanceProfile');
  if (name === 'diagnostic' || name === 'benchmark' || name === 'balanced') return PERFORMANCE_PROFILES[name];
  return params.has('harness') ? PERFORMANCE_PROFILES.benchmark : PERFORMANCE_PROFILES.balanced;
}

export function requestedStreamingVariant(search: string): StreamingVariant {
  return new URLSearchParams(search).get('streamingVariant') === 'main-snapshot' ? 'main-snapshot' : 'worker-first';
}

export function createPerformanceTelemetry(profile: PerformanceProfile) {
  return new PerformanceTelemetry({
    now: () => performance.now(),
    frameCapacity: profile.ringBufferFrames,
    eventCapacity: profile.ringBufferEvents,
    incidentThresholdMs: profile.longFrameMs,
    chunkLatencyIncidentMs: profile.chunkLatencyIncidentMs,
  });
}
