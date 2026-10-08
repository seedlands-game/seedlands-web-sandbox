import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityAction } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { PointerAttackRequest, PointerAttackResponse } from '../client/authority/pointer-attack-protocol';
import { createAuthorityPointerAttackPump } from './authority-pointer-attack-target';

/** Worker adapter: call under the existing serialized world host operation. */
export class AuthorityPointerAttackController {
  private readonly pump;
  private sequence = 0;
  constructor(
    private readonly port: Readonly<{
      runtime(): AuthorityRuntime | null;
      authorize(action: AuthorityAction): AuthorityAction;
      context(): Readonly<{ epoch: string; runtimeEpoch: string }>;
      post(message: PointerAttackResponse): void;
    }>,
  ) {
    this.pump = createAuthorityPointerAttackPump(port.runtime, port.authorize);
  }

  async accept(message: PointerAttackRequest, now: number): Promise<void> {
    if (message.runtimeEpoch !== this.port.context().runtimeEpoch) return;
    this.port.runtime()?.wake(now);
    if (this.pump.accept(message.input, performance.timeOrigin + now)) await this.service(now);
  }

  async service(now: number): Promise<void> {
    const result = await this.pump.service(performance.timeOrigin + now);
    if (result)
      this.port.post({
        kind: 'pointer-attack-result',
        protocolVersion: PROTOCOL_VERSION,
        ...this.port.context(),
        sequence: this.sequence++,
        result,
      });
  }

  suspend(value: boolean): void {
    this.pump.suspend(value);
  }
  stop(): void {
    this.pump.stop();
  }
}
