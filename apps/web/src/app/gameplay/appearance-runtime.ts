import type * as pc from 'playcanvas';
import { resolveAppearanceAssets, type AppearanceProject } from '../../client/presentation/appearance-project';
import type { Asset } from '../../client/presentation/asset-types';
import type { VoxelSemanticsDefinition } from '@seedlands/stdlib/world/voxel-semantics';
import { publicAssetUrl } from '../../client/presentation/public-asset-url';
import type {
  PackPresentationCatalog,
  PackPresentationActor,
} from '../../client/presentation/pack-presentation-loader';

const projects = new WeakMap<pc.Application, AppearanceProject>();
const resources = new WeakMap<pc.Application, Map<string, readonly Asset[]>>();
const models = new WeakMap<pc.Application, ReadonlyMap<string, Blob>>();
const packPresentations = new WeakMap<pc.Application, PackPresentationCatalog>();
const voxelSemantics = new WeakMap<pc.Application, ReadonlyMap<number, VoxelSemanticsDefinition>>();

export function setAppearanceResources(
  app: pc.Application,
  project: AppearanceProject,
  modelBlobs: ReadonlyMap<string, Blob> = new Map(),
) {
  projects.set(app, structuredClone(project));
  resources.set(app, new Map());
  models.set(app, new Map(modelBlobs));
}

export function setPackPresentationResources(app: pc.Application, catalog: PackPresentationCatalog) {
  const previous = packPresentations.get(app);
  if (previous === catalog) return;
  previous?.dispose();
  packPresentations.set(app, catalog);
  app.once('destroy', () => {
    if (packPresentations.get(app) !== catalog) return;
    catalog.dispose();
    packPresentations.delete(app);
  });
}

export function setVoxelPresentationSemantics(app: pc.Application, definitions: readonly VoxelSemanticsDefinition[]) {
  voxelSemantics.set(app, new Map(definitions.map((definition) => [definition.storageId, definition])));
  app.once('destroy', () => voxelSemantics.delete(app));
}

export const getVoxelPresentationSemantics = (app: pc.Application, storageId: number) =>
  voxelSemantics.get(app)?.get(storageId);

export function getPackActorPresentation(
  app: pc.Application,
  archetype: string,
): Readonly<{ binding: PackPresentationActor; url?: string }> | null {
  const catalog = packPresentations.get(app);
  const binding = catalog?.actors[archetype] ?? catalog?.actors[`seedlands:${archetype}`];
  if (!binding) return null;
  const url = binding.model.startsWith('builtin:')
    ? publicAssetUrl(import.meta.env.BASE_URL, binding.model.slice('builtin:'.length))
    : catalog?.assetUrls[binding.model];
  return { binding, ...(url ? { url } : {}) };
}

export function getAppearanceAnimationBindings(
  app: pc.Application,
): NonNullable<AppearanceProject['animationBindings']> {
  return structuredClone(projects.get(app)?.animationBindings ?? {});
}

export function getAppearanceModelBlob(app: pc.Application, modelId: string): Blob | undefined {
  return models.get(app)?.get(modelId);
}

export function getAppearanceResources(app: pc.Application, modelId = ''): readonly Asset[] | undefined {
  const project = projects.get(app);
  if (!project) return undefined;
  const cache = resources.get(app)!;
  if (!cache.has(modelId)) cache.set(modelId, resolveAppearanceAssets(project, modelId || undefined));
  return cache.get(modelId);
}

export function hasAppearanceBinding(app: pc.Application, modelId: string) {
  return Object.keys(projects.get(app)?.materialBindings[modelId] ?? {}).length > 0;
}
