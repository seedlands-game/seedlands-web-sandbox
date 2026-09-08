import type * as pc from 'playcanvas';
import { resolveAppearanceAssets, type AppearanceProject } from '../../client/presentation/appearance-project';
import type { Asset } from '../../client/presentation/asset-types';

const projects = new WeakMap<pc.Application, AppearanceProject>();
const resources = new WeakMap<pc.Application, Map<string, readonly Asset[]>>();

export function setAppearanceResources(app: pc.Application, project: AppearanceProject) {
  projects.set(app, structuredClone(project));
  resources.set(app, new Map());
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
