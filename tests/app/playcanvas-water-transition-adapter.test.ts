import * as pc from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import {
  createPlayCanvasChunkAdapter,
  MAX_ACTIVE_WATER_TRANSITIONS,
  type PlayCanvasChunkResource,
} from '../../apps/web/src/app/world/playcanvas-chunk-adapter';
import type { MeshPart, PendingMeshTask } from '../../apps/web/src/app/app-contracts';
import type { PerformanceTelemetry } from '../../apps/web/src/client/presentation/performance-telemetry';
import { batchMeshData, compactMeshData, meshChunk } from '../../packages/game-core/src/world/mesh';
import { CHUNK_SIZE, FaceMaterial, Voxel, voxelIndex } from '../../packages/game-core/src/world/voxel';
import type { PlayCanvasWaterTransitionFactory } from '../../apps/web/src/app/scene/playcanvas-water-transition';
import { WaterMeshTransitionTracker } from '../../apps/web/src/app/scene/water-mesh-transition';

const waterPart = (level: number): MeshPart => {
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  const fluid = new Uint8Array(CHUNK_SIZE ** 3);
  data[voxelIndex(1, 1, 1)] = Voxel.Water;
  fluid[voxelIndex(1, 1, 1)] = level;
  const water = meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, fluid, changes: [] })[FaceMaterial.Water];
  return compactMeshData(batchMeshData([water])[0]);
};

const task: PendingMeshTask = {
  taskId: 1,
  epoch: 1,
  chunkKey: '0,0,0',
  chunkRevision: 2,
  haloRevision: 'halo-2',
  traceId: 'trace-2',
  seed: 1,
  cx: 0,
  cy: 0,
  cz: 0,
  generatorVersion: 1,
  variant: 'worker-first',
};

const telemetry = {
  beginSpan: vi.fn(() => 'span'),
  endSpan: vi.fn(),
  markTrace: vi.fn(),
} as unknown as PerformanceTelemetry;

const eventApp = () => Object.assign(new pc.EventHandler(), { graphicsDevice: {} }) as unknown as pc.Application;

const resource = (part: MeshPart): PlayCanvasChunkResource => {
  const entity = new pc.Entity('chunk');
  const transparent = new pc.Entity('water');
  entity.addChild(transparent);
  const waterInstance = {
    visible: true,
    material: {},
    setParameter: vi.fn(),
    node: transparent,
  } as unknown as pc.MeshInstance;
  return {
    entity,
    categoryEntities: new Map([['transparent', transparent]]),
    meshes: [],
    instances: [waterInstance],
    waterInstances: [waterInstance],
    waterParts: [part],
    waterTransition: null,
    transitionCancel: null,
  };
};

describe('PlayCanvas water transition adapter', () => {
  it('由PlayCanvas prerender推进非零Morph并在同帧postrender报告首见', () => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const app = eventApp();
    const visible = vi.fn();
    const setProgress = vi.fn();
    const adapter = createPlayCanvasChunkAdapter(
      app,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      undefined,
      () => ({ instance: {} as pc.MeshInstance, setProgress, destroy: vi.fn() }),
    );
    const previous = resource(waterPart(8));
    const current = resource(waterPart(4));

    expect(adapter.prepareReplacement?.(previous, current, task)).toBe(true);
    adapter.transitionReplacement?.(previous, current, task, vi.fn(), visible);
    now = 16;
    app.fire('prerender');
    expect(setProgress.mock.lastCall?.[0]).toBeGreaterThan(0);
    expect(visible).not.toHaveBeenCalled();
    app.fire('postrender');
    expect(visible).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('reports transition visibility only after positive progress is rendered', () => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const app = eventApp();
    const transitions = new WaterMeshTransitionTracker();
    const visible = vi.fn();
    const adapter = createPlayCanvasChunkAdapter(
      app,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      transitions,
      () => ({ instance: {} as pc.MeshInstance, setProgress: vi.fn(), destroy: vi.fn() }),
    );
    const previous = resource(waterPart(8));
    const current = resource(waterPart(4));

    transitions.setHeldForHarness(true);
    expect(adapter.prepareReplacement?.(previous, current, task)).toBe(true);
    adapter.transitionReplacement?.(previous, current, task, vi.fn(), visible);
    now = 16;
    app.fire('prerender');
    app.fire('postrender');
    expect(visible).not.toHaveBeenCalled();

    transitions.setHeldForHarness(false);
    now = 32;
    app.fire('prerender');
    expect(visible).not.toHaveBeenCalled();
    app.fire('postrender');
    expect(visible).toHaveBeenCalledOnce();
    expect(telemetry.markTrace).toHaveBeenCalledWith(task.traceId, 'water-transition-progress-visible', 'main');
    vi.unstubAllGlobals();
  });

  it('does not report a positive morph frame cancelled before postrender', () => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const app = eventApp();
    const visible = vi.fn();
    const setProgress = vi.fn();
    const adapter = createPlayCanvasChunkAdapter(
      app,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      undefined,
      () => ({ instance: {} as pc.MeshInstance, setProgress, destroy: vi.fn() }),
    );
    const previous = resource(waterPart(8));
    const current = resource(waterPart(4));

    expect(adapter.prepareReplacement?.(previous, current, task)).toBe(true);
    adapter.transitionReplacement?.(previous, current, task, vi.fn(), visible);
    now = 16;
    app.fire('prerender');
    current.transitionCancel?.();
    app.fire('postrender');
    const callsAfterCancel = setProgress.mock.calls.length;
    now = 32;
    app.fire('prerender');

    expect(visible).not.toHaveBeenCalled();
    expect(setProgress).toHaveBeenCalledTimes(callsAfterCancel);
    vi.unstubAllGlobals();
  });
  it('过渡完成不把RenderComponent已拥有的静态实例重新交给破坏性setter', () => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const destroy = vi.fn();
    const app = eventApp();
    const adapter = createPlayCanvasChunkAdapter(
      app,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      undefined,
      () => ({ instance: {} as pc.MeshInstance, setProgress: vi.fn(), destroy }),
    );
    const previous = resource(waterPart(8));
    const current = resource(waterPart(4));
    expect(adapter.prepareReplacement?.(previous, current, task)).toBe(true);
    const ownedStaticInstances = current.instances;
    const transitionInstance = current.waterTransition!.instance;
    const removeMeshInstances = vi.fn();
    current.waterTransitionLayer = { removeMeshInstances } as unknown as pc.Layer;
    Object.defineProperty(current.categoryEntities.get('transparent')!, 'render', {
      value: {
        get meshInstances() {
          return ownedStaticInstances;
        },
        set meshInstances(_instances: pc.MeshInstance[]) {
          throw new Error('RenderComponent setter destroys its current mesh instances');
        },
      },
    });
    adapter.transitionReplacement?.(previous, current, task, vi.fn());
    now = 200;
    expect(() => app.fire('prerender')).not.toThrow();
    expect(current.waterInstances[0].visible).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(removeMeshInstances).toHaveBeenCalledWith([transitionInstance]);
    expect(removeMeshInstances.mock.invocationCallOrder[0]).toBeLessThan(destroy.mock.invocationCallOrder[0]!);
    vi.unstubAllGlobals();
  });
  it('shows one geometry morph without changing either water mesh opacity', () => {
    let now = 0;
    vi.stubGlobal('performance', { now: () => now });
    const transitionInstance = { visible: true } as pc.MeshInstance;
    const setProgress = vi.fn();
    const destroy = vi.fn();
    const createTransition: PlayCanvasWaterTransitionFactory = () => ({
      instance: transitionInstance,
      setProgress,
      destroy,
    });
    const app = eventApp();
    const transitions = new WaterMeshTransitionTracker();
    const adapter = createPlayCanvasChunkAdapter(
      app,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      transitions,
      createTransition,
    );
    const previous = resource(waterPart(8));
    const current = resource(waterPart(4));

    expect(adapter.prepareReplacement?.(previous, current, task)).toBe(true);
    expect(previous.waterInstances[0].visible).toBe(false);
    expect(current.waterInstances[0].visible).toBe(false);
    expect(current.waterTransition?.instance).toBe(transitionInstance);
    expect(previous.waterInstances[0].setParameter).not.toHaveBeenCalled();
    expect(current.waterInstances[0].setParameter).not.toHaveBeenCalled();
    expect(transitions.snapshot().active[0].geometry).toMatchObject({
      mode: 'surface-morph',
      visibleWaterMeshCount: 1,
      opacityCrossfade: false,
    });

    const complete = vi.fn();
    const visible = vi.fn();
    adapter.transitionReplacement?.(previous, current, task, complete, visible);
    now = 200;
    app.fire('prerender');

    expect(setProgress).toHaveBeenLastCalledWith(1);
    expect(current.waterInstances[0].visible).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(visible).not.toHaveBeenCalled();
    app.fire('postrender');
    expect(visible).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('skips an identical static surface and supersedes an active morph with one cleanup', () => {
    vi.stubGlobal('performance', { now: () => 0 });
    const firstDestroy = vi.fn();
    const secondDestroy = vi.fn();
    let created = 0;
    const createTransition: PlayCanvasWaterTransitionFactory = () => ({
      instance: { visible: true } as pc.MeshInstance,
      setProgress: vi.fn(),
      destroy: created++ === 0 ? firstDestroy : secondDestroy,
    });
    const adapter = createPlayCanvasChunkAdapter(
      eventApp(),
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      undefined,
      createTransition,
    );
    const old = resource(waterPart(8));
    const middle = resource(waterPart(4));
    const newest = resource(waterPart(6));

    expect(adapter.prepareReplacement?.(old, middle, task)).toBe(true);
    const releaseOld = vi.fn();
    adapter.transitionReplacement?.(old, middle, task, releaseOld);
    expect(adapter.prepareReplacement?.(middle, newest, { ...task, traceId: 'trace-3', chunkRevision: 3 })).toBe(true);

    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(releaseOld).toHaveBeenCalledTimes(1);
    expect(middle.waterInstances[0].visible).toBe(false);
    expect(newest.waterInstances[0].visible).toBe(false);
    const releaseMiddle = vi.fn();
    adapter.transitionReplacement?.(middle, newest, { ...task, traceId: 'trace-3', chunkRevision: 3 }, releaseMiddle);

    const stable = resource(waterPart(6));
    expect(adapter.prepareReplacement?.(newest, stable, { ...task, traceId: 'trace-4', chunkRevision: 4 })).toBe(false);
    expect(secondDestroy).toHaveBeenCalledTimes(1);
    expect(releaseMiddle).toHaveBeenCalledTimes(1);
    expect(stable.waterInstances[0].visible).toBe(true);
    vi.unstubAllGlobals();
  });

  it('restores the previous water when a prepared replacement is discarded before its first render', () => {
    const destroy = vi.fn();
    const createTransition: PlayCanvasWaterTransitionFactory = () => ({
      instance: { visible: true } as pc.MeshInstance,
      setProgress: vi.fn(),
      destroy,
    });
    const adapter = createPlayCanvasChunkAdapter(
      { graphicsDevice: {} } as pc.Application,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      undefined,
      createTransition,
    );
    const previous = resource(waterPart(8));
    const discarded = resource(waterPart(4));

    expect(adapter.prepareReplacement?.(previous, discarded, task)).toBe(true);
    adapter.destroy(discarded);

    expect(previous.waterInstances[0].visible).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('skips geometry animation when the world-level active transition budget is full', () => {
    const transitions = new WaterMeshTransitionTracker();
    for (let index = 0; index < MAX_ACTIVE_WATER_TRANSITIONS; index += 1)
      transitions.begin({ chunkKey: `${index},0,0`, targetRevision: 1, traceId: `active-${index}` }, 0);
    const createTransition = vi.fn<PlayCanvasWaterTransitionFactory>();
    const adapter = createPlayCanvasChunkAdapter(
      { graphicsDevice: {} } as pc.Application,
      () => ({}) as pc.StandardMaterial,
      telemetry,
      undefined,
      transitions,
      createTransition,
    );
    const previous = resource(waterPart(8));
    const current = resource(waterPart(4));

    expect(adapter.prepareReplacement?.(previous, current, task)).toBe(false);
    expect(createTransition).not.toHaveBeenCalled();
    expect(previous.waterInstances[0].visible).toBe(true);
    expect(current.waterInstances[0].visible).toBe(true);
  });
});
