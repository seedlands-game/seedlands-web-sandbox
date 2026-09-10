import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResidentBridge } from '../../apps/web/src/client/character/resident-bridge';
import type { BoundCharacterControlPort } from '../../apps/web/src/client/authority/browser-authority-client-contract';
import type { CharacterObservation } from '@seedlands/game-core/runtime/character-control-protocol';
import type { ResidentStatus } from '@seedlands/cognition-protocol';
import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  defineBehaviorRegistryModule,
  definePack,
  type BehaviorCapabilityRegistry,
} from '@seedlands/game-core/mod-api';
import { assembleWorldPacks } from '@seedlands/game-core/server/composition/host-api';
import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';

const behaviorPack = definePack({
  id: 'seedlands:resident-bridge-test',
  version: '1.0.0',
  kind: 'playbook',
  modules: [defineBehaviorRegistryModule()],
});
const currentCapabilities = assembleWorldPacks([
  {
    ...behaviorPack,
    integrity: {
      algorithm: 'sha256',
      manifestDigest: 'a'.repeat(64),
      entryDigest: 'b'.repeat(64),
      resources: [],
    },
  },
])
  .capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY)
  .catalog();
const capabilitiesFor = (id: string): readonly BehaviorCapability[] => {
  const capability = currentCapabilities.find((entry) => entry.id === id);
  if (!capability) throw new Error(`Missing test capability: ${id}`);
  return [capability];
};
const actorCapabilities = new Map([
  ['a', capabilitiesFor('wait')],
  ['b', capabilitiesFor('hold')],
  ['c', capabilitiesFor('speak')],
]);

const world = { worldId: 'world', epoch: 'epoch-1', timelineId: 'timeline-1' };
const frontier = {
  worldId: 'world',
  epoch: 'epoch-1',
  worldRevision: 0,
  commitSequence: 0,
  physicsTick: 0,
  fluidWorkSequence: 0,
  logicObservationSequence: 0,
};
const status: ResidentStatus = {
  phase: 'living',
  message: 'living',
  windowId: 'window-1',
  memoryRevision: 0,
  receivedThrough: 0,
  includedThrough: 0,
  compactedThrough: 0,
  estimatedContextTokens: 0,
  remainingFallbackMs: 180000,
  logicalRounds: 0,
  compactions: 0,
};
const observation = {
  cursor: 0,
  events: [],
  eventCoverage: { requestedAfter: 0, through: 0, returnedThrough: 0, hasMore: false },
} as unknown as CharacterObservation;
class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: Record<string, unknown>[] = [];
  close = vi.fn();
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ protocolVersion: 2, ...message }) });
  }
}
const bridges: ResidentBridge[] = [];
const port = (id: string) => {
  const failure = async () => ({
    ok: false as const,
    frontier,
    error: { code: 'BEHAVIOR_REVISION_CONFLICT', kind: 'conflict' as const, message: 'stale' },
  });
  return {
    binding: {
      sessionId: `channel-${id}`,
      worldId: world.worldId,
      epoch: world.epoch,
      entityId: id,
      incarnation: `born-${id}`,
      policyRevision: 1,
      actor: { entityId: id, epoch: 1, lifetime: 1 },
    },
    capabilities: vi.fn(async () => ({
      ok: true as const,
      frontier,
      data: { kind: 'capabilities' as const, capabilities: actorCapabilities.get(id)! },
    })),
    observe: vi.fn(async () => ({ ok: true as const, frontier, data: { kind: 'observation' as const, observation } })),
    behavior: vi.fn(failure),
    speak: vi.fn(failure),
    intent: vi.fn(failure),
    memory: vi.fn(failure),
    dispose: vi.fn(async () => {}),
  } satisfies BoundCharacterControlPort;
};
async function setup() {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  const socket = new Socket();
  let paused = false;
  const onConnection = vi.fn();
  const bridge = new ResidentBridge({
    paused: () => paused,
    onConnection,
    onCharacter: vi.fn(),
    socket: () => socket as unknown as WebSocket,
  });
  bridges.push(bridge);
  bridge.connect('ws://127.0.0.1:8787', 'local-test-pairing', world, currentCapabilities);
  const ports = [port('a'), port('b'), port('c')];
  for (const entry of ports) await bridge.bind(entry);
  socket.onopen?.();
  socket.receive({ kind: 'ready', sequence: 0, world, modelAvailable: true });
  await vi.advanceTimersByTimeAsync(0);
  ports.forEach((entry, i) =>
    socket.receive({
      kind: 'bound',
      sequence: i + 1,
      channelId: entry.binding.sessionId,
      binding: entry.binding,
      status,
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  return {
    bridge,
    ports,
    socket,
    onConnection,
    pause: () => {
      paused = true;
    },
  };
}
afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.disconnect();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('multiplexed resident bridge', () => {
  it('retires a channel whose Authority disposal rejects after an epoch change', async () => {
    const { bridge, ports, socket } = await setup();
    ports[0].dispose.mockRejectedValueOnce(new Error('WORLD_EPOCH_STALE'));
    await expect(bridge.unbind('a')).resolves.toBeUndefined();
    expect(
      socket.sent.filter((message) => message.kind === 'unbind' && message.channelId === 'channel-a'),
    ).toHaveLength(1);
    await bridge.unbind('a');
    expect(ports[0].dispose).toHaveBeenCalledTimes(1);
  });

  it('binds three actors through one handshake and only dispatches a proposal to its bound actor', async () => {
    const { socket, ports } = await setup();
    expect(socket.sent.filter((message) => message.kind === 'hello')).toEqual([
      expect.objectContaining({ world, authoringCapabilities: currentCapabilities }),
    ]);
    expect(socket.sent.filter((message) => message.kind === 'bind')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binding: expect.objectContaining({ sessionId: 'channel-a' }),
          capabilities: actorCapabilities.get('a'),
        }),
        expect.objectContaining({
          binding: expect.objectContaining({ sessionId: 'channel-b' }),
          capabilities: actorCapabilities.get('b'),
        }),
        expect.objectContaining({
          binding: expect.objectContaining({ sessionId: 'channel-c' }),
          capabilities: actorCapabilities.get('c'),
        }),
      ]),
    );
    socket.receive({
      kind: 'behavior-proposal',
      sequence: 4,
      channelId: 'channel-b',
      requestId: 'r1',
      proposal: {
        expectedBehaviorRevision: 7,
        goal: { description: 'rest' },
        definition: { version: 1, root: { id: 'rest', type: 'action', skill: 'hold' } },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports[0]!.behavior).not.toHaveBeenCalled();
    expect(ports[1]!.behavior).toHaveBeenCalledOnce();
    expect(ports[2]!.behavior).not.toHaveBeenCalled();
    expect(socket.sent.at(-1)).toMatchObject({
      kind: 'receipt',
      channelId: 'channel-b',
      requestId: 'r1',
      result: { ok: false, error: { code: 'BEHAVIOR_REVISION_CONFLICT' } },
    });
  });

  it('keeps polling B and C while A has an unresolved observation', async () => {
    const { ports } = await setup();
    ports[0]!.observe.mockImplementationOnce(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(2000);
    expect(ports[0]!.observe).toHaveBeenCalledTimes(2);
    expect(ports[1]!.observe.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(ports[2]!.observe.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects a paused proposal without disconnecting other actors or submitting world writes', async () => {
    const { socket, ports, pause, onConnection } = await setup();
    pause();
    socket.receive({
      kind: 'speak',
      effectRequestId: 'speech-effect',
      sequence: 4,
      channelId: 'channel-a',
      requestId: 'late-speech',
      text: 'hello',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports[0]!.speak).not.toHaveBeenCalled();
    expect(socket.sent.at(-1)).toMatchObject({
      kind: 'receipt',
      requestId: 'late-speech',
      result: { ok: false, error: { code: 'WORLD_PAUSED' } },
    });
    expect(onConnection).not.toHaveBeenCalledWith('failed', expect.anything());
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('ignores a removed channel and rejects replayed sequence before invoking its port', async () => {
    const { bridge, socket, ports } = await setup();
    await bridge.unbind('a');
    socket.receive({
      kind: 'speak',
      effectRequestId: 'speech-effect',
      sequence: 4,
      channelId: 'channel-a',
      requestId: 'late',
      text: 'hello',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports[0]!.speak).not.toHaveBeenCalled();
    socket.receive({
      kind: 'speak',
      effectRequestId: 'speech-effect',
      sequence: 4,
      channelId: 'channel-b',
      requestId: 'replay',
      text: 'hello',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ports[1]!.speak).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
