import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../../../../../packages/stdlib/src/server/commands/command-contract';
import type { ItemDefinition } from '../../../../../packages/stdlib/src/server/gameplay/item-registry';
import type { Recipe } from '../../../../../packages/stdlib/src/server/gameplay/recipe-registry';
import { ApplicationShell } from '../../../src/app/application-shell';
import type { GlobalAudio } from '../../../src/app/audio/global-audio';
import type { Game } from '../../../src/app/game';
import { executeBrowserModeCommand } from '../../../src/app/gameplay/browser-gameplay-actions';
import { projectGameplayUi } from '../../../src/app/ui/gameplay-ui-projector';
import { createUiBridge } from '../../../src/app/ui/ui-bridge';

const customItems: readonly ItemDefinition[] = [
  {
    id: 'sample:marble',
    name: '月纹石',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 2 }],
    placesVoxel: 2,
  },
  {
    id: 'sample:dust',
    name: '月尘',
    itemType: 'resource',
    stackLimit: 64,
    capabilities: [],
  },
];
const customRecipes: readonly Recipe[] = [
  {
    id: 'sample:marble-from-dust',
    inputs: [{ itemId: 'sample:dust', count: 2 }],
    outputs: [{ itemId: 'sample:marble', count: 1 }],
  },
];

const source = () => ({
  revision: 9,
  items: customItems,
  recipes: customRecipes,
  player: {
    lifecycle: 'alive' as const,
    health: 7,
    hunger: 4,
    selectedHotbarSlot: 3,
    inventory: [{ itemId: 'sample:dust', count: 6 }, ...Array.from({ length: 23 }, () => null)],
    mode: { version: 1 as const, value: 'creative' as const, revision: 1 },
    creativeCatalog: {
      version: 1 as const,
      hotbar: ['sample:marble', null, null, null, null, null, null, null],
      selectedSlot: 0,
      revision: 2,
    },
    flight: { version: 1 as const, enabled: true, revision: 1 },
  },
  inventoryOpen: true,
  craftableRecipeIds: ['sample:marble-from-dust'],
  target: null,
  breaking: null,
});

describe('creative mode UI projection', () => {
  it('uses per-world definitions and keeps creative references separate from survival inventory', () => {
    const projected = projectGameplayUi(source());

    expect(projected.hud).toMatchObject({ mode: 'creative', flightEnabled: true, selectedHotbarSlot: 0 });
    expect(projected.hud.hotbar[0]).toMatchObject({ itemId: 'sample:marble', name: '月纹石', count: 0 });
    expect(projected.shell.gameplay.inventory[0]).toMatchObject({ itemId: 'sample:dust', name: '月尘', count: 6 });
    expect(projected.shell.gameplay.creativeCatalog).toEqual([
      expect.objectContaining({ itemId: 'sample:marble', name: '月纹石' }),
      expect.objectContaining({ itemId: 'sample:dust', name: '月尘' }),
    ]);
    expect(projected.shell.gameplay.recipes).toEqual([
      expect.objectContaining({ id: 'sample:marble-from-dust', name: '月纹石', craftable: true }),
    ]);
  });
});

describe('browser player mode commands', () => {
  it('submits mutation-only commands as the host-bound browser player', async () => {
    const execute = vi.fn(async (): Promise<CommandResult> => ({
      success: true,
      message: 'ok',
      affectedChunks: [],
      worldRevision: 1,
      observation: {
        commandType: 'set-mode',
        category: 'mutation',
        actorId: 'browser-player',
        sourceType: 'browser-player',
        durationMs: 0,
        success: true,
        affectedChunks: [],
        worldRevision: 1,
        mutationCount: 0,
        structuralEventCount: 0,
      },
    }));

    await executeBrowserModeCommand(execute, 'player-7', { type: 'set-mode', mode: 'creative' });

    expect(execute).toHaveBeenCalledWith(
      {
        actorId: 'browser-player',
        sourceType: 'browser-player',
        entityId: 'player-7',
        capabilities: ['mutation'],
      },
      { type: 'set-mode', mode: 'creative' },
    );
  });

  it('propagates the authority rejection message for safe-landing feedback', async () => {
    const execute = vi.fn(async (): Promise<CommandResult> => ({
      success: false,
      message: 'failed',
      error: { kind: 'execution', code: 'COMMAND_EXECUTION_FAILED', message: 'No safe landing position.' },
      affectedChunks: [],
      worldRevision: 1,
      observation: {
        commandType: 'set-mode',
        category: 'mutation',
        actorId: 'browser-player',
        sourceType: 'browser-player',
        durationMs: 0,
        success: false,
        errorKind: 'execution',
        affectedChunks: [],
        worldRevision: 1,
        mutationCount: 0,
        structuralEventCount: 0,
      },
    }));

    await expect(
      executeBrowserModeCommand(execute, 'player-7', { type: 'set-mode', mode: 'survival' }),
    ).rejects.toThrow('No safe landing position.');
  });
});

describe('new-world mode start request', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the requested mode through the low-core confirmation path', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false, querySelector: vi.fn(() => null) }));
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('location', { search: '', href: 'https://seedlands.test/', reload: vi.fn() });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn() });
    const game = {
      onRuntimeFailure: null,
      loadLatestWorldSeed: vi.fn(async () => null),
      loadSavedSession: vi.fn(() => null),
      start: vi.fn(async () => undefined),
      abortStart: vi.fn(),
      leaveWorld: vi.fn(async () => undefined),
      setPaused: vi.fn(),
      releaseInput: vi.fn(),
    } as unknown as Game;
    const audio = { unlock: vi.fn(async () => true) } as unknown as GlobalAudio;
    const application = new ApplicationShell(game, createUiBridge(), audio, {
      preflight: async () => ({
        workerSupport: 'supported',
        estimatedCores: 4,
        coreEstimateFallback: false,
        requiredWorkerCount: 5,
        lowCoreWarning: true,
      }),
    });
    await application.initialize();

    await application.start('creative-seed', 'medium', 'new-current', 'creative');
    await application.confirmPerformanceWarning();

    expect(game.start).toHaveBeenCalledWith('creative-seed', null, 'medium', 'new-current', 'creative');
    application.dispose();
  });
});
