import type { ResidentBirthPackage, ResidentWorldBinding } from '@seedlands/cognition-protocol';
import type { BehaviorCapability } from '@seedlands/stdlib/runtime/behavior-control-protocol';
import type { ResidentFactory } from '../resident-factory.js';
import type { HostPayload } from './resident-host-types.js';
import { textId, validBirth } from './resident-host-validation.js';

const MAX_INFLIGHT_BIRTHS = 3;

type BirthMessage = Readonly<{ requestId: string; tags: readonly string[] }>;
type BirthOperation = Readonly<{
  controller: AbortController;
  tagsKey: string;
  world: ResidentWorldBinding;
}>;

type ResidentHostBirthOptions = Readonly<{
  factory: ResidentFactory | null;
  world(): ResidentWorldBinding | null;
  capabilities(): readonly BehaviorCapability[] | null;
  closed(): boolean;
  send(payload: HostPayload): boolean;
}>;

/** Keeps slow Factory work outside the ordered WebSocket control-message chain. */
export class ResidentHostBirths {
  private readonly active = new Map<string, BirthOperation>();

  constructor(private readonly options: ResidentHostBirthOptions) {}

  start(message: BirthMessage): void {
    const world = this.options.world();
    const capabilities = this.options.capabilities();
    if (
      !this.options.factory ||
      !world ||
      !capabilities ||
      !textId(message.requestId) ||
      !Array.isArray(message.tags)
    ) {
      this.options.send({
        kind: 'error',
        code: 'FACTORY_UNAVAILABLE',
        message: '出生服务暂不可用',
        requestId: message.requestId,
      });
      return;
    }
    const tagsKey = JSON.stringify(message.tags);
    const prior = this.active.get(message.requestId);
    if (prior) {
      if (prior.tagsKey === tagsKey) return;
      prior.controller.abort(new Error('Conflicting resident birth request.'));
      this.active.delete(message.requestId);
      this.options.send({
        kind: 'error',
        code: 'BIRTH_REJECTED',
        message: '出生资料生成失败',
        requestId: message.requestId,
      });
      return;
    }
    if (this.active.size >= MAX_INFLIGHT_BIRTHS) {
      this.options.send({
        kind: 'error',
        code: 'FACTORY_UNAVAILABLE',
        message: '出生服务正在处理其他请求',
        requestId: message.requestId,
      });
      return;
    }
    const operation: BirthOperation = { controller: new AbortController(), tagsKey, world };
    this.active.set(message.requestId, operation);
    void this.generate(message, capabilities, operation);
  }

  dispose(): void {
    for (const operation of this.active.values()) operation.controller.abort(new Error('Resident socket closed.'));
    this.active.clear();
  }

  private async generate(
    message: BirthMessage,
    capabilities: readonly BehaviorCapability[],
    operation: BirthOperation,
  ): Promise<void> {
    try {
      const birth = await this.options.factory!.generate(
        operation.world,
        message.requestId,
        message.tags,
        capabilities,
        operation.controller.signal,
      );
      if (!validBirth(birth)) throw new Error('generated birth failed validation');
      if (!this.current(message.requestId, operation)) return;
      this.options.send({ kind: 'birth-package', requestId: message.requestId, birth: birth as ResidentBirthPackage });
    } catch {
      if (this.current(message.requestId, operation) && !operation.controller.signal.aborted)
        this.options.send({
          kind: 'error',
          code: 'BIRTH_REJECTED',
          message: '出生资料生成失败',
          requestId: message.requestId,
        });
    } finally {
      if (this.active.get(message.requestId) === operation) this.active.delete(message.requestId);
    }
  }

  private current(requestId: string, operation: BirthOperation): boolean {
    return (
      !this.options.closed() &&
      this.active.get(requestId) === operation &&
      this.options.world() === operation.world &&
      !operation.controller.signal.aborted
    );
  }
}
