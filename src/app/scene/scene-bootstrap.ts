import { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import { PERFORMANCE_PROFILES, type PerformanceProfile } from '../../client/presentation/performance-profile';
import type { StreamingVariant } from '../app-contracts';
import * as pc from 'playcanvas';
import type { LightingQualityBudget } from './advanced-lighting-budget';
import { sunShadowOptions } from './sun-shadow-policy';
import type { ExperimentalRenderer } from '../../client/experimental-client-options';

class DesktopApplication extends pc.Application {
  override init(options: pc.AppOptions) {
    // AppOptions defaults xr to null at runtime; its declaration omits null.
    // Desktop worlds need no XR manager or its persistent devicechange listener.
    super.init(Object.assign(options, { xr: null }));
  }
}

export type SceneApplicationResult = Readonly<{
  application: pc.Application;
  requestedRenderer: ExperimentalRenderer;
  effectiveRenderer: ExperimentalRenderer;
  rendererStatus: 'matched' | 'fallback';
}>;

export async function createGraphicsDeviceForRenderer(
  canvas: HTMLCanvasElement,
  renderer: ExperimentalRenderer,
  create: typeof pc.createGraphicsDevice = pc.createGraphicsDevice,
): Promise<pc.GraphicsDevice> {
  const device = await create(canvas, {
    deviceTypes: renderer === 'webgpu' ? [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGL2],
  });
  if (device.deviceType !== pc.DEVICETYPE_WEBGL2 && device.deviceType !== pc.DEVICETYPE_WEBGPU) {
    device.destroy?.();
    throw new Error(`No playable graphics device is available (${String(device.deviceType)}).`);
  }
  return device as pc.GraphicsDevice;
}

export async function createSceneApplication(
  canvas: HTMLCanvasElement,
  requestedRenderer: ExperimentalRenderer = 'webgl2',
): Promise<SceneApplicationResult> {
  const graphicsDevice = await createGraphicsDeviceForRenderer(canvas, requestedRenderer);
  let app: pc.Application | null = null;
  try {
    app = new DesktopApplication(canvas, {
      mouse: new pc.Mouse(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDevice,
    });
    app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.start();
    const effectiveRenderer = app.graphicsDevice.deviceType as ExperimentalRenderer;
    return {
      application: app,
      requestedRenderer,
      effectiveRenderer,
      rendererStatus: requestedRenderer === effectiveRenderer ? 'matched' : 'fallback',
    };
  } catch (error) {
    if (app) app.destroy();
    else graphicsDevice.destroy();
    throw error;
  }
}

export function createSun(app: pc.Application, budget: LightingQualityBudget) {
  const light = new pc.Entity('Sun');
  light.addComponent('light', {
    type: 'directional',
    color: new pc.Color(1, 0.9, 0.72),
    intensity: 1,
    ...sunShadowOptions(budget.sunShadowResolution),
    shadowType: budget.sunShadowResolution === 1024 ? pc.SHADOW_PCF5_32F : pc.SHADOW_PCF3_32F,
    shadowUpdateMode: pc.SHADOWUPDATE_REALTIME,
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
