import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';

export class FluidActiveWindow {
  private keys = new Set<string>();
  private windowManaged = false;
  private generation = 0;

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
    this.generation += 1;
  }

  includeEditedPosition(x: number, y: number, z: number): void {
    if (this.windowManaged) return;
    const key = chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE));
    if (!this.keys.has(key)) {
      this.keys.add(key);
      this.generation += 1;
    }
  }

  prepareEditedPositions(positions: readonly (readonly [number, number, number])[]) {
    const generation = this.generation;
    let next = new Set(this.keys);
    let validated = false;
    return Object.freeze({
      validate: () => {
        validated = false;
        if (this.generation !== generation) throw new Error('Prepared fluid active window is stale.');
        next = new Set(this.keys);
        if (!this.windowManaged)
          positions.forEach(([x, y, z]) =>
            next!.add(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE))),
          );
        validated = true;
      },
      apply: () => {
        if (!validated) throw new Error('Prepared fluid active window requires validation.');
        this.keys = next;
        this.generation += 1;
      },
    });
  }
}
