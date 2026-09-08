import * as pc from 'playcanvas';
import { loadGlbBlob } from '../../client/persistence/glb-model-store';
import type { ModelAnimationPlayback } from './model-animation';

export type GlbModelLease = Readonly<{
  entity: pc.Entity;
  animationClips: readonly string[];
  playback: ModelAnimationPlayback | null;
  release: () => void;
}>;

function releaseContainer(app: pc.Application, asset: pc.Asset): void {
  app.assets.remove(asset);
  asset.unload();
}

export function normalizeGlbBounds(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  verticalAnchor: 'center' | 'feet' = 'center',
): Readonly<{ position: readonly [number, number, number]; scale: number }> {
  const maxEdge = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!Number.isFinite(maxEdge) || maxEdge <= 0) return { position: [0, 0, 0], scale: 1 };
  const scale = 1.5 / maxEdge;
  return {
    position: [
      -((min[0] + max[0]) / 2) * scale,
      -(verticalAnchor === 'feet' ? min[1] : (min[1] + max[1]) / 2) * scale,
      -((min[2] + max[2]) / 2) * scale,
    ],
    scale,
  };
}

function centerAndNormalize(
  wrapper: pc.Entity,
  source: pc.Entity,
  animated: boolean,
  verticalAnchor: 'center' | 'feet',
): void {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const component of source.findComponents('render')) {
    if (!(component instanceof pc.RenderComponent)) continue;
    component.isStatic = !animated;
    component.castShadows = false;
    for (const instance of component.meshInstances) {
      const { center, halfExtents } = instance.aabb;
      minX = Math.min(minX, center.x - halfExtents.x);
      minY = Math.min(minY, center.y - halfExtents.y);
      minZ = Math.min(minZ, center.z - halfExtents.z);
      maxX = Math.max(maxX, center.x + halfExtents.x);
      maxY = Math.max(maxY, center.y + halfExtents.y);
      maxZ = Math.max(maxZ, center.z + halfExtents.z);
    }
  }
  if (!Number.isFinite(minX)) return;
  const transform = normalizeGlbBounds([minX, minY, minZ], [maxX, maxY, maxZ], verticalAnchor);
  wrapper.setLocalPosition(...transform.position);
  wrapper.setLocalScale(transform.scale, transform.scale, transform.scale);
}

const abortError = () => new Error('GLB 模型加载已取消');

function createAnimationPlayback(
  app: pc.Application,
  animationRoot: pc.Entity,
  resource: pc.ContainerResource,
): Readonly<{
  animationClips: readonly string[];
  playback: ModelAnimationPlayback | null;
  dispose: () => void;
}> {
  const animationAssets = (resource as pc.ContainerResource & { animations?: pc.Asset[] }).animations ?? [];
  const tracks: ReadonlyArray<Readonly<{ name: string; track: pc.AnimTrack }>> = animationAssets.flatMap((asset) =>
    asset.resource instanceof pc.AnimTrack ? [{ name: asset.resource.name, track: asset.resource }] : [],
  );
  if (!tracks.length) return { animationClips: [], playback: null, dispose: () => undefined };
  const byName = new Map(tracks.map(({ name, track }) => [name, track]));
  const evaluator = new pc.AnimEvaluator(new pc.DefaultAnimBinder(animationRoot));
  let active: pc.AnimClip | null = null;
  let outgoing: pc.AnimClip | null = null;
  let blendDuration = 0;
  let blendElapsed = 0;
  const update = (deltaSeconds: number) => {
    if (outgoing && active) {
      blendElapsed = Math.min(blendDuration, blendElapsed + Math.max(0, deltaSeconds));
      active.blendWeight = blendDuration > 0 ? blendElapsed / blendDuration : 1;
    }
    evaluator.update(deltaSeconds);
    if (outgoing && blendElapsed >= blendDuration) {
      const index = evaluator.clips.indexOf(outgoing);
      if (index >= 0) evaluator.removeClip(index);
      outgoing = null;
    }
  };
  app.on('update', update);
  return {
    animationClips: tracks.map(({ name }) => name),
    playback: {
      play(clipName, options) {
        const track = byName.get(clipName);
        if (!track) return;
        const next = new pc.AnimClip(track, 0, 1, true, options.loop);
        if (active && options.blendSeconds > 0) {
          evaluator.removeClips();
          outgoing = active;
          outgoing.blendWeight = 1;
          next.blendWeight = 0;
          blendDuration = options.blendSeconds;
          blendElapsed = 0;
          evaluator.addClip(outgoing);
          evaluator.addClip(next);
        } else {
          evaluator.removeClips();
          outgoing = null;
          next.blendWeight = 1;
          evaluator.addClip(next);
        }
        active = next;
      },
      locate(normalizedTime, normalizedRatePerSecond) {
        if (!active || !Number.isFinite(active.track.duration) || active.track.duration <= 0) return;
        const time = Math.max(0, Math.min(1, normalizedTime));
        active.time = time * active.track.duration;
        active.speed = Math.max(0, normalizedRatePerSecond * active.track.duration);
      },
    },
    dispose: () => {
      app.off('update', update);
      evaluator.removeClips();
    },
  };
}

async function loadContainer(app: pc.Application, url: string, id: string, signal?: AbortSignal): Promise<pc.Asset> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const discard = (asset: pc.Asset | undefined) => {
      if (!asset) return;
      releaseContainer(app, asset);
    };
    const complete = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      discard(app.assets.getByUrl(url));
      if (settled) return;
      settled = true;
      complete();
      reject(abortError());
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    app.assets.loadFromUrlAndFilename(url, `${id}.glb`, 'container', (error, asset) => {
      if (settled) {
        discard(asset);
        return;
      }
      if (error || !asset) {
        discard(asset);
        settled = true;
        complete();
        reject(new Error(`GLB 模型加载失败：${error ?? '未返回容器资源'}`));
        return;
      }
      settled = true;
      complete();
      resolve(asset);
    });
  });
}

/** Loads one persisted GLB into PlayCanvas. The returned lease owns the entity, animation and all GPU assets. */
export async function addGlbModel(
  app: pc.Application,
  parent: pc.Entity,
  id: string,
  signal?: AbortSignal,
  suppliedBlob?: Blob,
  verticalAnchor: 'center' | 'feet' = 'center',
): Promise<GlbModelLease> {
  const blob = suppliedBlob ?? (await loadGlbBlob(id));
  if (signal?.aborted) throw abortError();
  const url = URL.createObjectURL(blob);
  let asset: pc.Asset | null = null;
  let wrapper: pc.Entity | null = null;
  let source: pc.Entity | null = null;
  let animation: ReturnType<typeof createAnimationPlayback> = {
    animationClips: [],
    playback: null,
    dispose: () => undefined,
  };
  try {
    asset = await loadContainer(app, url, id, signal);
    if (signal?.aborted) throw abortError();
    const resource = asset.resource as pc.ContainerResource | null;
    if (!resource) throw new Error('GLB 容器资源不可用');
    source = resource.instantiateRenderEntity({ castShadows: false });
    wrapper = new pc.Entity(`glb-model:${id}`, app);
    wrapper.addChild(source);
    animation = createAnimationPlayback(app, source, resource);
    centerAndNormalize(wrapper, source, animation.animationClips.length > 0, verticalAnchor);
    if (signal?.aborted) throw abortError();
    parent.addChild(wrapper);
  } catch (error) {
    wrapper?.destroy();
    source?.destroy();
    animation.dispose();
    if (asset) releaseContainer(app, asset);
    URL.revokeObjectURL(url);
    throw error;
  }
  let released = false;
  return {
    entity: wrapper!,
    animationClips: animation.animationClips,
    playback: animation.playback,
    release: () => {
      if (released) return;
      released = true;
      animation.dispose();
      wrapper?.destroy();
      releaseContainer(app, asset!);
      URL.revokeObjectURL(url);
    },
  };
}
