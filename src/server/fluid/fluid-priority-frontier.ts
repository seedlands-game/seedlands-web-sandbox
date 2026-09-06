import type { FluidActivationPriority, FluidPosition } from './fluid-transaction';

const positionKey = (position: FluidPosition) => position.join(',');

export class FluidPriorityFrontier {
  private readonly ordinary: FluidPosition[] = [];
  private readonly interactive: FluidPosition[] = [];
  private readonly queued = new Set<string>();
  private readonly interactiveQueued = new Set<string>();

  get pending(): number {
    return this.ordinary.length + this.interactive.length;
  }

  has(position: FluidPosition): boolean {
    return this.queued.has(positionKey(position));
  }

  enqueue(position: FluidPosition, priority: FluidActivationPriority): void {
    const key = positionKey(position);
    if (this.queued.has(key)) {
      if (priority === 'interactive' && !this.interactiveQueued.has(key)) {
        const ordinaryIndex = this.ordinary.findIndex((candidate) => positionKey(candidate) === key);
        if (ordinaryIndex >= 0) {
          const [promoted] = this.ordinary.splice(ordinaryIndex, 1);
          this.interactive.push(promoted!);
          this.interactiveQueued.add(key);
        }
      }
      return;
    }
    this.queued.add(key);
    if (priority === 'interactive') {
      this.interactiveQueued.add(key);
      this.interactive.push([...position] as FluidPosition);
    } else this.ordinary.push([...position] as FluidPosition);
  }

  take(limit: number, interactiveLimit: number): { frontier: FluidPosition[]; interactiveCount: number } {
    let interactiveCount = Math.min(interactiveLimit, limit, this.interactive.length);
    const ordinaryCount = Math.min(limit - interactiveCount, this.ordinary.length);
    interactiveCount += Math.min(limit - interactiveCount - ordinaryCount, this.interactive.length - interactiveCount);
    const frontier = [...this.interactive.splice(0, interactiveCount), ...this.ordinary.splice(0, ordinaryCount)];
    frontier.forEach((position) => this.queued.delete(positionKey(position)));
    frontier.slice(0, interactiveCount).forEach((position) => this.interactiveQueued.delete(positionKey(position)));
    return { frontier, interactiveCount };
  }

  restore(frontier: readonly FluidPosition[], interactiveCount: number): void {
    for (let index = interactiveCount - 1; index >= 0; index -= 1)
      this.restorePosition(frontier[index]!, this.interactive, this.interactiveQueued);
    for (let index = frontier.length - 1; index >= interactiveCount; index -= 1)
      this.restorePosition(frontier[index]!, this.ordinary);
  }

  private restorePosition(position: FluidPosition, queue: FluidPosition[], priorityQueued?: Set<string>): void {
    const key = positionKey(position);
    if (this.queued.has(key)) return;
    this.queued.add(key);
    priorityQueued?.add(key);
    queue.unshift(position);
  }
}
