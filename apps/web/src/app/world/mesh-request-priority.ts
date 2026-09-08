export type MeshRequestPriority = 'streaming' | 'interactive' | 'interactive-fluid';

type PrioritizedRequest = { priority: MeshRequestPriority };

export function higherMeshRequestPriority(
  current: MeshRequestPriority | undefined,
  next: MeshRequestPriority,
): MeshRequestPriority {
  if (current === 'interactive-fluid' || next === 'interactive-fluid') return 'interactive-fluid';
  if (current === 'interactive' || next === 'interactive') return 'interactive';
  return 'streaming';
}

export function promoteMeshRequestPriority(
  priority: MeshRequestPriority,
  ...requests: Array<PrioritizedRequest | undefined>
): void {
  const existing = requests.find((request) => request !== undefined);
  if (existing) existing.priority = higherMeshRequestPriority(existing.priority, priority);
}
