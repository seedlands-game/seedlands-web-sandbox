import type { LogicObservation } from '../logic/logic-protocol';
import type { AuthoritySnapshot } from './authority-session';

type BuildObservation = (sequence: number, snapshot: AuthoritySnapshot) => LogicObservation;

/** Tracks the bounded set of observations that may still authorize a Logic result. */
export class AuthorityLogicCandidates {
  private sequence = 0;
  private readonly observations = new Map<number, LogicObservation>();
  private requestedValue = false;

  get issuedSequence(): number {
    return this.sequence;
  }

  get requested(): boolean {
    return this.requestedValue;
  }

  request(): void {
    this.requestedValue = true;
  }

  publish(snapshot: AuthoritySnapshot, build: BuildObservation, send?: (observation: LogicObservation) => void): void {
    if (!this.requestedValue) return;
    this.requestedValue = false;
    send?.(this.create(snapshot, build));
  }

  create(snapshot: AuthoritySnapshot, build: BuildObservation): LogicObservation {
    const observation = build(++this.sequence, snapshot);
    this.observations.set(observation.observationSequence, observation);
    while (this.observations.size > 8) this.observations.delete(this.observations.keys().next().value!);
    return observation;
  }

  consume(sequence: number): LogicObservation | null {
    const observation = this.observations.get(sequence) ?? null;
    if (observation) this.observations.delete(sequence);
    return observation;
  }

  invalidate(): void {
    this.observations.clear();
    this.requestedValue = false;
  }

  hasPendingThrough(sequence: number): boolean {
    return [...this.observations.keys()].some((candidate) => candidate <= sequence);
  }
}
