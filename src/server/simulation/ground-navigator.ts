import { isSolid } from '../../world/voxel';

export type NavigationPosition = [number, number, number];
export type NavigationResult =
  | { status: 'reached'; path: NavigationPosition[]; expandedNodes: number }
  | { status: 'unreachable' | 'budget-exhausted'; expandedNodes: number };

type Node = { x: number; y: number; z: number; g: number; f: number; parent: string | null };
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const position = (node: Pick<Node, 'x' | 'y' | 'z'>): NavigationPosition => [node.x + 0.5, node.y, node.z + 0.5];

export class GroundNavigator {
  constructor(private readonly getVoxel: (x: number, y: number, z: number) => number) {}

  plan(
    startPosition: readonly [number, number, number],
    targetPosition: readonly [number, number, number],
    options: { maxExpanded?: number } = {},
  ): NavigationResult {
    const maxExpanded = options.maxExpanded ?? 384;
    if (!Number.isInteger(maxExpanded) || maxExpanded <= 0) throw new TypeError('Navigation budget must be positive.');
    const start = this.resolveNode(startPosition);
    const target = this.resolveNode(targetPosition);
    if (!start || !target) return { status: 'unreachable', expandedNodes: 0 };
    const targetKey = key(target.x, target.y, target.z);
    const startKey = key(start.x, start.y, start.z);
    const open = new Map<string, Node>([
      [startKey, { ...start, g: 0, f: this.heuristic(start, target), parent: null }],
    ]);
    const visited = new Map<string, Node>();
    let expandedNodes = 0;
    while (open.size) {
      if (expandedNodes >= maxExpanded) return { status: 'budget-exhausted', expandedNodes };
      const current = [...open.values()].sort((left, right) => left.f - right.f || left.g - right.g)[0];
      const currentKey = key(current.x, current.y, current.z);
      open.delete(currentKey);
      visited.set(currentKey, current);
      expandedNodes += 1;
      if (currentKey === targetKey)
        return { status: 'reached', path: this.reconstruct(current, visited), expandedNodes };
      for (const next of this.neighbors(current)) {
        const nextKey = key(next.x, next.y, next.z);
        if (visited.has(nextKey)) continue;
        const g = current.g + 1 + Math.abs(next.y - current.y) * 0.25;
        const existing = open.get(nextKey);
        if (existing && existing.g <= g) continue;
        open.set(nextKey, { ...next, g, f: g + this.heuristic(next, target), parent: currentKey });
      }
    }
    return { status: 'unreachable', expandedNodes };
  }

  isPathStepValid(step: readonly [number, number, number]): boolean {
    return this.walkable(Math.floor(step[0]), Math.floor(step[1]), Math.floor(step[2]));
  }

  private resolveNode(source: readonly [number, number, number]): Pick<Node, 'x' | 'y' | 'z'> | null {
    if (source.length !== 3 || !source.every(Number.isFinite)) throw new TypeError('Navigation position is invalid.');
    const x = Math.floor(source[0]);
    const z = Math.floor(source[2]);
    const baseY = Math.floor(source[1]);
    for (const offset of [0, -1, 1, -2, 2, -3, 3]) {
      const y = baseY + offset;
      if (this.walkable(x, y, z)) return { x, y, z };
    }
    return null;
  }

  private neighbors(current: Pick<Node, 'x' | 'y' | 'z'>): Array<Pick<Node, 'x' | 'y' | 'z'>> {
    const result: Array<Pick<Node, 'x' | 'y' | 'z'>> = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      for (const dy of [0, 1, -1]) {
        const candidate = { x: current.x + dx, y: current.y + dy, z: current.z + dz };
        if (!this.walkable(candidate.x, candidate.y, candidate.z)) continue;
        result.push(candidate);
        break;
      }
    return result;
  }

  private walkable(x: number, y: number, z: number): boolean {
    return (
      isSolid(this.getVoxel(x, y - 1, z)) && !isSolid(this.getVoxel(x, y, z)) && !isSolid(this.getVoxel(x, y + 1, z))
    );
  }

  private heuristic(left: Pick<Node, 'x' | 'y' | 'z'>, right: Pick<Node, 'x' | 'y' | 'z'>): number {
    return Math.abs(left.x - right.x) + Math.abs(left.z - right.z) + Math.abs(left.y - right.y) * 0.25;
  }

  private reconstruct(end: Node, visited: Map<string, Node>): NavigationPosition[] {
    const result: NavigationPosition[] = [];
    let current: Node | undefined = end;
    while (current) {
      result.push(position(current));
      current = current.parent ? visited.get(current.parent) : undefined;
    }
    return result.reverse();
  }
}
