import * as pc from 'playcanvas';
import type { VoxelTarget } from '../client/voxel-target';

/** World-space depth-tested edges, sharing the exact interaction target. */
export class VoxelTargetOutline {
  private readonly points: pc.Vec3[] = [];
  private readonly color = new pc.Color(1, 0.88, 0.58);
  private key = '';

  constructor(private readonly app: pc.Application) {}

  update(target: VoxelTarget | null): void {
    if (!target?.inRange) return;
    const key = target.position.join(',');
    if (key !== this.key) {
      this.key = key;
      this.points.length = 0;
      const [x, y, z] = target.position;
      const corners = Array.from(
        { length: 8 },
        (_, i) => new pc.Vec3(x + (i & 1 ? 1.004 : -0.004), y + (i & 2 ? 1.004 : -0.004), z + (i & 4 ? 1.004 : -0.004)),
      );
      for (let i = 0; i < 8; i++)
        for (const axis of [1, 2, 4]) if (!(i & axis)) this.points.push(corners[i], corners[i | axis]);
    }
    this.app.drawLines(this.points, this.color, true);
  }
}
