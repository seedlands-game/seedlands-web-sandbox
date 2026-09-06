import { chunkKey } from '../../world/voxel';

const MAX_PENDING_CANONICAL_PREPARATIONS = 2_048;

type CanonicalPreparationServer = Readonly<{
  prepareCanonicalChunkForMutation(cx: number, cy: number, cz: number): Promise<boolean>;
}>;

const coordinatesForKey = (key: string): [number, number, number] | null => {
  const coordinates = key.split(',').map(Number);
  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isSafeInteger) ||
    chunkKey(coordinates[0], coordinates[1], coordinates[2]) !== key
  )
    return null;
  return coordinates as [number, number, number];
};

export class AuthorityCanonicalPreparation {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly server: CanonicalPreparationServer,
    private readonly requestGeneration: (key: string) => void,
    private readonly onAvailable: (key: string) => void,
  ) {}

  request(key: string): void {
    if (this.pending.has(key) || this.pending.size >= MAX_PENDING_CANONICAL_PREPARATIONS) return;
    const coordinates = coordinatesForKey(key);
    if (!coordinates) return;
    const preparation = this.server
      .prepareCanonicalChunkForMutation(...coordinates)
      .then((available) => {
        if (available) this.onAvailable(key);
        else this.requestGeneration(key);
      })
      .catch(() => {
        // A later physics/query observation retries the durable preflight. A storage
        // error must never be reclassified as a confirmed procedural miss.
      })
      .finally(() => {
        if (this.pending.get(key) === preparation) this.pending.delete(key);
      });
    this.pending.set(key, preparation);
  }
}

export const createAuthorityCanonicalRouter = () => {
  let target: ((key: string) => void) | null = null;
  const queued = new Set<string>();
  return {
    request: (key: string) => {
      if (target) target(key);
      else if (queued.size < MAX_PENDING_CANONICAL_PREPARATIONS) queued.add(key);
    },
    bind: (next: (key: string) => void) => {
      target = next;
      queued.forEach((key) => next(key));
      queued.clear();
    },
  };
};
