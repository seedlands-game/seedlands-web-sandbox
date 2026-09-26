import type { ModuleActorAuthority } from '../composition/gameplay-actor-authority';
import type { GameplayModuleRuntime } from './modules/gameplay-module-runtime';
import type { ModeRuntime } from './modules/mode-runtime';

export function selectGameplayHotbarSlot(
  id: string,
  slot: number,
  options: Readonly<{
    modeState: ReturnType<ModeRuntime['stateFor']> | null;
    inventory: { select(id: string, slot: number): { success: boolean; reason?: string } };
    hasCompositionGuard: boolean;
    modes: ModeRuntime;
    modules: GameplayModuleRuntime;
    actorAuthority?: ModuleActorAuthority;
  }>,
) {
  const state = options.modeState;
  if (state?.mode !== 'creative') return options.inventory.select(id, slot);
  if (!options.hasCompositionGuard) return options.modes.selectCreativeSlot(id, slot);
  if (!Number.isSafeInteger(slot) || slot < 0 || slot >= state.creativeCatalog.hotbar.length)
    return { success: false, reason: 'invalid-slot' };
  const result = options.modules.invokeActor(options.actorAuthority, id, {
    operationId: 'seedlands:set-creative-catalog',
    target: { kind: 'entity', entityId: id },
    input: { slot, itemId: state.creativeCatalog.hotbar[slot] },
  });
  return result.ok ? { success: true } : { success: false, reason: result.message };
}

export const createGameplayHotbarSelection =
  (
    options: Readonly<{
      state(id: string): ReturnType<ModeRuntime['stateFor']> | null;
      inventory: { select(id: string, slot: number): { success: boolean; reason?: string } };
      hasCompositionGuard: boolean;
      modes: ModeRuntime;
      modules: GameplayModuleRuntime;
      actorAuthority?: ModuleActorAuthority;
    }>,
  ) =>
  (id: string, slot: number) =>
    selectGameplayHotbarSlot(id, slot, {
      modeState: options.state(id),
      inventory: options.inventory,
      hasCompositionGuard: options.hasCompositionGuard,
      modes: options.modes,
      modules: options.modules,
      actorAuthority: options.actorAuthority,
    });
