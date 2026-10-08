import type {
  AuthorityActionResult,
  AuthorityGameplayView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { nearestEntityHit } from '../../client/presentation/entity-hit-volume';

type Point = readonly [number, number, number];
type Result = AuthorityActionResult['result'];
type Port = Readonly<{
  authority(): Readonly<{ gameplay: AuthorityGameplayView; sendPointerAttack?(direction: Point | null): void }>;
  execute(targetId: string, consume: (result: Result) => void): void;
  feedback(message: string, tone: 'info' | 'error'): void;
}>;

/** Browser ray input and feedback adapter; combat state remains exclusively in Authority. */
export class BrowserPointerAttackInput {
  constructor(private readonly port: Port) {}

  attack(origin: Point, direction: Point, maxDistance: number): boolean {
    const target = this.target(origin, direction, maxDistance);
    if (!target) return false;
    this.port.execute(target.id, (result) => this.consume(result));
    return true;
  }

  held(origin: Point, direction: Point, maxDistance: number): boolean {
    const authority = this.port.authority();
    if (!authority.sendPointerAttack) return this.attack(origin, direction, maxDistance);
    authority.sendPointerAttack(direction);
    return Boolean(this.target(origin, direction, maxDistance));
  }

  stop(): void {
    this.port.authority().sendPointerAttack?.(null);
  }

  consume(result: Result): void {
    if (!result || typeof result !== 'object' || Array.isArray(result) || !('success' in result)) return;
    const response = result as Record<string, unknown>;
    if (response.success === true) {
      if (response.buffered === true) this.port.feedback('已衔接下一击', 'info');
      return;
    }
    if (response.success !== false) return;
    if (response.reason === 'cooldown' || response.reason === 'attack-cooldown' || response.reason === 'buffer-full')
      return;
    if (response.reason === 'combo-window-closed') return this.port.feedback('等待衔接窗口', 'info');
    const reason =
      response.reason === 'out-of-range'
        ? '目标超出攻击距离'
        : response.reason === 'blocked'
          ? '目标被方块遮挡'
          : response.reason === 'invalid-target'
            ? '目标已离开或倒下'
            : '当前无法攻击';
    this.port.feedback(reason, 'error');
  }

  private target(origin: Point, direction: Point, maxDistance: number) {
    return nearestEntityHit(
      this.port.authority().gameplay.entities.filter((entity) => entity.type === 'creature' || entity.type === 'npc'),
      origin,
      direction,
      maxDistance,
    );
  }
}
