import type {
  AppearanceAnimationTarget,
  AppearanceProject,
  ModelAnimationRole,
} from '../../client/presentation/appearance-project';

export function setAnimationBinding(
  project: AppearanceProject,
  target: AppearanceAnimationTarget,
  role: ModelAnimationRole,
  modelId: string,
  clip: string,
): void {
  const bindings = { ...(project.animationBindings ?? {}) };
  const current = bindings[target];
  const clips = current?.modelId === modelId ? { ...current.clips } : {};
  clips[role] = clip;
  bindings[target] = { modelId, clips };
  project.animationBindings = bindings;
}

export function removeAnimationBinding(
  project: AppearanceProject,
  target: AppearanceAnimationTarget,
  role: ModelAnimationRole,
): boolean {
  const bindings = { ...(project.animationBindings ?? {}) };
  const current = bindings[target];
  if (!current) return false;
  const clips = { ...current.clips };
  delete clips[role];
  if (Object.keys(clips).length) bindings[target] = { ...current, clips };
  else delete bindings[target];
  project.animationBindings = bindings;
  return true;
}
