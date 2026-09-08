import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';

/** 与现有浏览器的 low/medium/high 活动范围一致；坐标来自权威玩家。 */
export function dedicatedActiveWindow(position: Readonly<{ x: number; z: number }>, radius: number): string[] {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z) || ![1, 2, 3].includes(radius))
    throw new RangeError('Invalid dedicated activity window.');
  const cx = floorDiv(position.x, CHUNK_SIZE);
  const cz = floorDiv(position.z, CHUNK_SIZE);
  if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cz)) throw new RangeError('Activity coordinates overflow.');
  const entries: { key: string; distance: number }[] = [];
  for (let z = cz - radius; z <= cz + radius; z += 1)
    for (let x = cx - radius; x <= cx + radius; x += 1)
      for (let y = 0; y < 2; y += 1)
        entries.push({ key: chunkKey(x, y, z), distance: Math.abs(x - cx) + Math.abs(z - cz) });
  return entries.sort((a, b) => a.distance - b.distance).map((entry) => entry.key);
}

export type DedicatedActiveWindowPort = Readonly<{
  isRunning: () => boolean;
  isAvailable: (key: string) => boolean;
  requestChunk: (key: string) => Promise<boolean>;
  setFluidActiveChunks: (keys: readonly string[]) => void;
}>;

/** 有界加载重试由宿主时钟驱动，断开客户端不会清空世界活动窗口。 */
export class DedicatedActiveWindowController {
  private center = '';
  private keys = new Set<string>();
  private pending: string[] = [];

  constructor(
    private readonly port: DedicatedActiveWindowPort,
    private radius: 1 | 2 | 3 = 2,
  ) {
    dedicatedActiveWindow({ x: 0, z: 0 }, radius);
  }

  setRadius(radius: 1 | 2 | 3): void {
    if (![1, 2, 3].includes(radius)) throw new RangeError('Unsupported interest radius.');
    this.radius = radius;
  }

  update(position: Readonly<{ x: number; z: number }>): void {
    const center = `${Math.floor(position.x / CHUNK_SIZE)},${Math.floor(position.z / CHUNK_SIZE)},${this.radius}`;
    if (center !== this.center) {
      this.center = center;
      const keys = dedicatedActiveWindow(position, this.radius);
      this.keys = new Set(keys);
      this.pending = keys.filter((key) => !this.port.isAvailable(key));
      this.port.setFluidActiveChunks(keys);
    }
    for (let admitted = 0; admitted < 8 && this.pending.length; admitted += 1) {
      const key = this.pending.shift()!;
      void this.port.requestChunk(key).then((available) => {
        if (!available && this.port.isRunning() && this.keys.has(key) && !this.pending.includes(key))
          this.pending.push(key);
      });
    }
  }

  diagnostics() {
    return { activeChunkCount: this.keys.size, pendingActiveChunks: this.pending.length, activeRadius: this.radius };
  }
}
