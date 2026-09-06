import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';

export class FluidActiveWindow {
  private readonly keys = new Set<string>();
  private windowManaged = false;

  allowsKey(key: string): boolean {
    return this.keys.has(key);
  }

  allowsPosition(x: number, y: number, z: number): boolean {
    return this.allowsKey(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  }

  update(keys: readonly string[]): void {
    this.windowManaged = true;
    this.keys.clear();
    keys.forEach((key) => this.keys.add(key));
  }

  includeEditedPosition(x: number, y: number, z: number): void {
    if (!this.windowManaged)
      this.keys.add(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  }
}
