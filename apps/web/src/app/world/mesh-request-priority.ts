export type MeshRequestPriority = 'streaming' | 'interactive' | 'interactive-fluid';

type PrioritizedRequest = { priority: MeshRequestPriority };
type ScheduledRequest = PrioritizedRequest & { enqueuedAtDispatch: number; queuedAt: number };
const MAX_PRIORITY_BURST = 8;
const rank: Record<MeshRequestPriority, number> = { streaming: 0, interactive: 1, 'interactive-fluid': 2 };

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

export function selectMeshRequest<T extends ScheduledRequest>(
  entries: Array<[string, T]>,
  priorityBypasses: number,
): Readonly<{ next: [string, T] | undefined; priorityBypasses: number }> {
  const age = (left: [string, T], right: [string, T]) =>
    left[1].enqueuedAtDispatch - right[1].enqueuedAtDispatch || left[1].queuedAt - right[1].queuedAt;
  const oldest = [...entries].sort(age)[0];
  const preferred = [...entries].sort(
    (left, right) => rank[right[1].priority] - rank[left[1].priority] || age(left, right),
  )[0];
  if (!oldest || !preferred) return { next: undefined, priorityBypasses: 0 };
  if (oldest[0] === preferred[0]) return { next: preferred, priorityBypasses: 0 };
  if (priorityBypasses >= MAX_PRIORITY_BURST) return { next: oldest, priorityBypasses: 0 };
  return { next: preferred, priorityBypasses: priorityBypasses + 1 };
}
