import type { WorkspaceBinding } from '../workspace/index.js';
import type { ResidentChannel } from '../resident-channel.js';

const identityKey = (identity: WorkspaceBinding) =>
  JSON.stringify([identity.worldId, identity.timelineId, identity.actorId, identity.incarnation]);

/** Serializes the final durable write of an old connection before the same namespace is rebound. */
export class ResidentChannelRetirement {
  private readonly pending = new Map<string, Promise<void>>();

  retire(channel: ResidentChannel): Promise<void> {
    const key = identityKey(channel.identity);
    const prior = this.pending.get(key) ?? Promise.resolve();
    const completion = prior
      .then(() => channel.shutdown())
      .finally(() => {
        if (this.pending.get(key) === completion) this.pending.delete(key);
      });
    this.pending.set(key, completion);
    return completion;
  }

  async wait(identity: WorkspaceBinding): Promise<void> {
    await this.pending.get(identityKey(identity));
  }

  async drain(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}
