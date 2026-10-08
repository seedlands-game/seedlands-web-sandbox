import { afterEach, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { PlayerController } from '../../../src/app/player/player-controller';
import { BrowserPointerAttackInput } from '../../../src/app/gameplay/pointer-attack-input';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import type { PointerAttackRequest } from '../../../src/client/authority/pointer-attack-protocol';
import { PointerAttackInputPump } from '../../../src/worker/pointer-attack-input-pump';
import { GameplayRuntime, classicContent, classicOptions } from '../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { FakeAuthorityWorker, frequencies, ready } from '../client/fixtures/browser-authority';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function heldAttack(
  heldCallbacks: Pick<
    ConstructorParameters<typeof PlayerController>[0],
    'onHeldAttackTarget' | 'onStopHeldAttack'
  > = {},
) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const world = new GameplayRuntime({
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 8,
    getVoxel: () => 0,
    getLoadedCell: () => ({ voxel: 0, fluid: 0 }),
    prepareVoxelEdit: () => {
      throw new Error('Unexpected voxel edit');
    },
    prepareVoxelEdits: () => {
      throw new Error('Unexpected voxel edit batch');
    },
  });
  world.spawnPlayer({ id: 'held-player', position: [0, 1, 0] });
  world.spawnAutonomous(
    { id: 'held-target', type: 'creature', archetype: 'zombie', position: [0, 1, -1] },
    { archetype: 'zombie' },
  );
  world.giveItem('held-player', { itemId: 'wood-sword', count: 1 });
  const canvas = {};
  const documentStub = {
    pointerLockElement: canvas as object | null,
    visibilityState: 'visible',
    onmousedown: null as null | ((event: { button: number }) => void),
    onmouseup: null as null | ((event: { button: number }) => void),
    onpointerlockchange: null as null | (() => void),
    onvisibilitychange: null as null | (() => void),
    exitPointerLock: vi.fn(),
  };
  const windowStub = { onblur: null as null | (() => void) };
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', windowStub);
  const requests: unknown[] = [];
  let blocked = false;
  let paused = false;
  let worldAvailable = true;
  let creative = false;
  const directions: readonly number[][] = [];
  const camera = new pc.Entity();
  camera.setPosition(0, 1, 0);
  const controller = new PlayerController({
    canvas,
    camera,
    physicsHz: 60,
    authority: { epoch: 'held-attack', snapshot: () => null },
    getWorld: () =>
      worldAvailable
        ? {
            authority: { voxelSemantics: classicContent.voxelSemantics },
            getChunkRevision: () => 1,
            getVoxel: () => 0,
            getFluidCell: () => null,
          }
        : null,
    isPaused: () => paused,
    isUiBlockingInput: () => blocked,
    canTargetFluidSource: () => false,
    isCreativeMode: () => creative,
    telemetry: {
      beginSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: (_category: string, _name: string, callback: () => void) => callback(),
    },
    onAttackTarget: (_position: readonly number[], direction: readonly number[]) => {
      (directions as number[][]).push([...direction]);
      requests.push(world.attackEntity('held-player', 'held-target'));
      return true;
    },
    ...heldCallbacks,
  } as unknown as ConstructorParameters<typeof PlayerController>[0]);
  controller.install();
  const advance = (ticks: number) => {
    for (let tick = 0; tick < ticks; tick++) {
      world.advanceRules(1 / 60);
      vi.advanceTimersByTime(1_000 / 60);
    }
  };
  return {
    controller,
    world,
    documentStub,
    windowStub,
    requests,
    advance,
    directions,
    press: () => documentStub.onmousedown!({ button: 0 }),
    block: () => {
      blocked = true;
    },
    pause: () => {
      paused = true;
    },
    removeWorld: () => {
      worldAvailable = false;
    },
    changeMode: () => {
      creative = true;
    },
  };
}

function isPointerAttackRequest(post: unknown): post is PointerAttackRequest {
  return typeof post === 'object' && post !== null && (post as { kind?: unknown }).kind === 'pointer-attack-input';
}

async function workerDrivenHeldAttack() {
  let browserInput: BrowserPointerAttackInput | null = null;
  const driver = heldAttack({
    onHeldAttackTarget: (origin, direction, maxDistance) => browserInput?.held(origin, direction, maxDistance) ?? false,
    onStopHeldAttack: () => browserInput?.stop(),
  });
  const attack = vi.spyOn(driver.world, 'attackEntity');
  const worker = new FakeAuthorityWorker();
  const client = new BrowserAuthorityClient(worker, 'held-attack');
  const starting = client.start({
    seedText: 'held-attack',
    openMode: 'continue',
    legacySnapshots: [],
    initialWorldTime: 8,
    frequencies,
  });
  const authorityReady = ready();
  worker.emit({
    kind: 'authority-ready',
    protocolVersion: 1,
    epoch: 'held-attack',
    ready: {
      ...authorityReady,
      snapshot: { ...authorityReady.snapshot, epoch: 'held-attack' },
      gameplay: { ...authorityReady.gameplay, entities: driver.world.queryEntities() },
    },
  });
  await starting;
  browserInput = new BrowserPointerAttackInput({
    authority: () => ({
      gameplay: client.gameplay,
      sendPointerAttack: (direction) => client.sendPointerAttack(direction),
    }),
    execute: () => {
      throw new Error('Held attack must use the pointer input envelope.');
    },
    feedback: vi.fn(),
  });
  const pointerPump = new PointerAttackInputPump({
    actor: () => {
      const reference = driver.world.entities.createReference('held-player');
      const player = driver.world.getPlayerState('held-player');
      return reference && player.lifecycle === 'alive' ? { reference, mode: player.mode?.value ?? 'survival' } : null;
    },
    attack: async () => {
      driver.world.attackEntity('held-player', 'held-target');
      return null;
    },
  });
  let workerNow = performance.timeOrigin + performance.now();
  let postCursor = 0;
  const acceptedInputs: PointerAttackRequest[] = [];
  const acceptPostedInputs = () => {
    const posts = worker.posts.slice(postCursor);
    postCursor = worker.posts.length;
    for (const post of posts)
      if (isPointerAttackRequest(post)) {
        expect(pointerPump.accept(post.input, workerNow)).toBe(true);
        acceptedInputs.push(post);
      }
  };
  const advanceAuthorityOnly = async (ticks: number) => {
    for (let tick = 0; tick < ticks; tick++) {
      driver.world.advanceRules(1 / 60);
      workerNow += 1_000 / 60;
      await pointerPump.service(workerNow);
      acceptPostedInputs();
    }
  };

  driver.press();
  acceptPostedInputs();
  expect(acceptedInputs[0]).toMatchObject({
    kind: 'pointer-attack-input',
    input: { gesture: 1, sequence: 0, direction: expect.any(Array) },
  });

  return {
    driver,
    worker,
    client,
    pointerPump,
    attack,
    acceptedInputs,
    advanceAuthorityOnly,
    acceptPostedInputs,
    finish: () => {
      driver.controller.dispose(false);
      acceptPostedInputs();
      client.dispose();
    },
  };
}

it('held mouse buffers the registered Classic second hit while rendering is stopped', () => {
  const driver = heldAttack();
  driver.press();
  driver.advance(12);
  expect(driver.world.simulation.combat.snapshotFor('held-player').lastResult).toMatchObject({
    comboStep: 0,
    outcome: 'hit',
    damage: 5,
  });
  driver.advance(1);
  expect(driver.requests).toContainEqual(expect.objectContaining({ success: true, buffered: true }));
  driver.advance(30);
  expect(driver.world.simulation.combat.snapshotFor('held-player').lastResult).toMatchObject({
    comboStep: 1,
    outcome: 'hit',
    damage: 7,
  });
  driver.controller.dispose(false);
});

it('held mouse sustains registered Classic attacks through the authority input pump while the main thread is blocked', async () => {
  const session = await workerDrivenHeldAttack();
  await session.advanceAuthorityOnly(43);

  expect(session.driver.world.simulation.combat.snapshotFor('held-player').lastResult).toMatchObject({
    sequence: 2,
    comboStep: 1,
    outcome: 'hit',
    damage: 7,
  });
  session.finish();
});

it.each(['mouseup', 'blur', 'unlock', 'hidden', 'dispose'] as const)(
  'worker driven held attack stops on the actual controller boundary %s',
  async (reason) => {
    const session = await workerDrivenHeldAttack();
    await session.advanceAuthorityOnly(12);
    expect(session.attack).toHaveBeenCalledOnce();
    expect(session.driver.world.simulation.combat.snapshotFor('held-player').lastResult).toMatchObject({
      sequence: 1,
      comboStep: 0,
      damage: 5,
    });

    if (reason === 'mouseup') session.driver.documentStub.onmouseup!({ button: 0 });
    if (reason === 'blur') session.driver.windowStub.onblur!();
    if (reason === 'unlock') {
      session.driver.documentStub.pointerLockElement = null;
      session.driver.documentStub.onpointerlockchange!();
    }
    if (reason === 'hidden') {
      session.driver.documentStub.visibilityState = 'hidden';
      session.driver.documentStub.onvisibilitychange!();
    }
    if (reason === 'dispose') session.driver.controller.dispose(false);
    session.acceptPostedInputs();
    expect(session.acceptedInputs.at(-1)?.input.direction).toBeNull();

    await session.advanceAuthorityOnly(43);
    expect(session.attack).toHaveBeenCalledOnce();
    expect(session.driver.world.simulation.combat.snapshotFor('held-player').lastResult).toMatchObject({
      sequence: 1,
      comboStep: 0,
      damage: 5,
    });
    session.finish();
  },
);

it.each(['mouseup', 'blur', 'unlock', 'hidden', 'ui', 'pause', 'world', 'mode', 'dispose'] as const)(
  'held mouse cancels without a render on %s',
  (reason) => {
    const driver = heldAttack();
    driver.press();
    if (reason === 'mouseup') driver.documentStub.onmouseup!({ button: 0 });
    if (reason === 'blur') driver.windowStub.onblur!();
    if (reason === 'unlock') {
      driver.documentStub.pointerLockElement = null;
      driver.documentStub.onpointerlockchange!();
    }
    if (reason === 'hidden') {
      driver.documentStub.visibilityState = 'hidden';
      driver.documentStub.onvisibilitychange!();
    }
    if (reason === 'ui') driver.block();
    if (reason === 'pause') driver.pause();
    if (reason === 'world') driver.removeWorld();
    if (reason === 'mode') driver.changeMode();
    if (reason === 'dispose') driver.controller.dispose(false);
    driver.advance(60);
    expect(driver.requests).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    driver.controller.dispose(false);
  },
);

it('a delayed callback sends one attack and shares its deadline with render', () => {
  const driver = heldAttack();
  driver.press();
  vi.spyOn(performance, 'now').mockReturnValue(5_000);
  vi.advanceTimersByTime(200);
  expect(driver.requests).toHaveLength(2);
  driver.controller.update(0.05, 5);
  expect(driver.requests).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(1);
  driver.controller.dispose(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('held retry reads actual mouse yaw without advancing render prediction', () => {
  const driver = heldAttack();
  driver.press();
  const eventDocument = driver.documentStub as unknown as { onmousemove(event: object): void };
  eventDocument.onmousemove({ movementX: 80, movementY: 0 });
  driver.advance(13);
  expect(driver.directions[1]).not.toEqual(driver.directions[0]);
  expect(driver.controller.viewAngles[0]).toBe(-10.4);
  expect(driver.controller.predictedPhysicsState).toBeNull();
  driver.controller.dispose(false);
});
