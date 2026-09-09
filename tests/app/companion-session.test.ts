import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanionSession } from '../../apps/web/src/app/gameplay/companion/companion-session';
import type { CharacterState } from '@seedlands/game-core/runtime/character-control-protocol';
import type { CharacterControllerPort } from '../../apps/web/src/client/character/controller-bridge';
const frontier = {
  worldId: 'w',
  epoch: 'e',
  worldRevision: 1,
  commitSequence: 0,
  physicsTick: 0,
  fluidWorkSequence: 0,
  logicObservationSequence: 0,
};
const character: CharacterState = {
  lifecycle: 'active',
  entityId: 'n',
  incarnation: 'i',
  revision: 0,
  policyRevision: 1,
  profile: { name: '阿岚', personality: '谨慎' },
  currentGoal: { revision: 0, requestId: 'create', goal: { kind: 'forage' }, status: 'active' },
  behavior: 'forage',
  hunger: 60,
  inventory: [],
  memory: { revision: 0, summary: '', throughCursor: 0 },
  eventCursor: 10,
};
afterEach(() => vi.useRealTimers());
describe('companion UI session lifecycle', () => {
  it('keeps a saved identity and requests recent events; releases a binding that arrives after world exit', async () => {
    vi.useFakeTimers();
    let bind!: (port: CharacterControllerPort) => void;
    const port: CharacterControllerPort = {
      binding: { sessionId: 's', worldId: 'w', epoch: 'e', entityId: 'n', incarnation: 'i', policyRevision: 1 },
      dispose: vi.fn(),
      observe: vi.fn(),
      intent: vi.fn(),
      memory: vi.fn(),
    };
    const characterRequest = vi.fn(async () => ({
      ok: true as const,
      frontier,
      data: { kind: 'list' as const, characters: [character] },
    }));
    const session = new CompanionSession(
      () => ({ character: characterRequest, bindCharacter: () => new Promise((resolve) => (bind = resolve)) }),
      () => false,
    );
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.get().character?.entityId).toBe('n');
    expect(characterRequest).toHaveBeenCalledWith({ kind: 'observe', entityId: 'n', sinceCursor: 2 });
    const connecting = session.connect('ws://localhost:8787', 'pair');
    session.stop();
    bind(port);
    await connecting;
    expect(port.dispose).toHaveBeenCalledOnce();
    expect(session.get().character).toBeNull();
    expect(session.get().connection.phase).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(2000);
    expect(characterRequest).toHaveBeenCalledTimes(2);
  });
});
