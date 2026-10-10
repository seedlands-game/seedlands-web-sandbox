import type { EntityLifetimeReference } from '@seedlands/stdlib/server/gameplay/entity-store';
import type { AuthorityActionResult } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { PointerAttackDirection, PointerAttackInput } from '../client/authority/pointer-attack-protocol';

type Actor = Readonly<{ reference: EntityLifetimeReference; mode: string }>;
type Port = Readonly<{
  actor(): Actor | null;
  attack(direction: PointerAttackDirection): Promise<AuthorityActionResult | null>;
}>;
const sameActor = (left: Actor, right: Actor) =>
  left.mode === right.mode &&
  left.reference.entityId === right.reference.entityId &&
  left.reference.epoch === right.reference.epoch &&
  left.reference.lifetime === right.reference.lifetime;

function validDirection(value: unknown): value is PointerAttackDirection {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    [0, 1, 2].every((index) => Object.hasOwn(value, index)) &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component)) &&
    Math.abs(Math.hypot(...value) - 1) <= 0.001
  );
}

/** Retains input intent only; every attempt still enters the existing authoritative attack transaction. */
export class PointerAttackInputPump {
  private lastSequence = -1;
  private retiredGesture = 0;
  private gesture = 0;
  private direction: PointerAttackDirection | null = null;
  private actor: Actor | null = null;
  private expiresAt = 0;
  private nextAttemptAt = Number.POSITIVE_INFINITY;
  private suspended = false;

  constructor(private readonly port: Port) {}

  accept(input: PointerAttackInput, now: number): boolean {
    if (
      !input ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence <= this.lastSequence ||
      !Number.isSafeInteger(input.gesture) ||
      input.gesture < 0 ||
      typeof input.capturedAtTimeOriginMs !== 'number' ||
      !Number.isFinite(input.capturedAtTimeOriginMs) ||
      !Number.isFinite(now)
    )
      return false;
    const age = now - input.capturedAtTimeOriginMs;
    if (age < -100 || age > 2_000) return false;
    if (input.direction !== null && !validDirection(input.direction)) return false;
    if (this.direction !== null && now >= this.expiresAt) this.stop();
    this.lastSequence = input.sequence;
    if (input.direction === null) {
      this.retiredGesture = Math.max(this.retiredGesture, input.gesture);
      this.stop();
      return true;
    }
    if (this.suspended || input.gesture <= this.retiredGesture) return false;
    const actor = this.port.actor();
    if (!actor) {
      this.retiredGesture = Math.max(this.retiredGesture, input.gesture);
      this.stop();
      return false;
    }
    if (this.direction === null || input.gesture !== this.gesture) {
      this.stop();
      this.gesture = input.gesture;
      this.actor = { reference: { ...actor.reference }, mode: actor.mode };
      this.nextAttemptAt = now;
    }
    this.direction = [...input.direction];
    this.expiresAt = input.capturedAtTimeOriginMs + 2_000;
    return true;
  }

  async service(now: number): Promise<AuthorityActionResult | null> {
    if (!Number.isFinite(now) || !this.direction || this.suspended) return null;
    const actor = this.port.actor();
    if (!actor || !this.actor || !sameActor(actor, this.actor) || now >= this.expiresAt) {
      this.stop();
      return null;
    }
    if (now < this.nextAttemptAt) return null;
    this.nextAttemptAt = now + 200;
    return this.port.attack(this.direction);
  }

  suspend(value: boolean): void {
    this.suspended = value;
    this.stop();
  }

  stop(): void {
    this.retiredGesture = Math.max(this.retiredGesture, this.gesture);
    this.direction = null;
    this.actor = null;
    this.expiresAt = 0;
    this.nextAttemptAt = Number.POSITIVE_INFINITY;
  }
}
