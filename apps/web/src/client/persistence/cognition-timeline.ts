/** A failed two-owner restore must never reconnect an old world to future memories. */
export class CognitionTimeline {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  private key(worldId: string) {
    return `seedlands.cognition.timeline:${worldId}`;
  }
  private pendingKey(worldId: string) {
    return `${this.key(worldId)}:pending-restore`;
  }
  current(worldId: string): string {
    return this.storage.getItem(this.key(worldId)) ?? crypto.randomUUID();
  }
  hasMemory(worldId: string): boolean {
    return this.storage.getItem(this.key(worldId)) !== null;
  }
  select(worldId: string, timelineId: string): void {
    this.storage.setItem(this.key(worldId), timelineId);
  }
  fork(worldId: string): string {
    const timelineId = crypto.randomUUID();
    this.select(worldId, timelineId);
    return timelineId;
  }
  beginRestore(worldId: string): void {
    this.storage.setItem(this.pendingKey(worldId), 'pending');
  }
  finishRestore(worldId: string): void {
    this.storage.removeItem(this.pendingKey(worldId));
  }
  requiresRestore(worldId: string): boolean {
    return this.storage.getItem(this.pendingKey(worldId)) !== null;
  }
}
