import type { VoxelTarget } from '../../client/presentation/voxel-target';
import type {
  AuthorityAction,
  AuthorityGameplayView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

export type SecondaryInteractionResult = 'target' | 'held-item' | 'place' | 'out-of-range' | 'blocked';
export type TargetInteractionResult = 'handled' | 'fallback';

export function createVoxelInteractionAction(
  gameplay: Pick<AuthorityGameplayView, 'inventory' | 'player'>,
  target: Readonly<{ position: [number, number, number]; adjacent: [number, number, number] }>,
  intent: 'use' | 'alternate',
): Extract<AuthorityAction, { type: 'interact' }> {
  const player = gameplay.player;
  return {
    type: 'interact',
    intent,
    target: { kind: 'voxel', hit: [...target.position], adjacent: [...target.adjacent] },
    expectedSelection: {
      inventoryRevision: gameplay.inventory.revision,
      modeRevision: player.mode?.revision ?? 0,
      creativeCatalogRevision: player.creativeCatalog?.revision ?? 0,
      selectedSlot:
        player.mode?.value === 'creative' ? (player.creativeCatalog?.selectedSlot ?? 0) : player.selectedSlot,
    },
  };
}

export async function performVoxelTargetInteraction(
  input: Readonly<{
    gameplay: Pick<AuthorityGameplayView, 'inventory' | 'player'>;
    target: Pick<VoxelTarget, 'position' | 'adjacent'>;
    intent: 'use' | 'alternate';
    openStation(position: [number, number, number]): boolean;
    perform(action: Extract<AuthorityAction, { type: 'interact' }>): Promise<{ result: unknown }>;
    refresh(): void;
    succeeded(): void;
    failed(reason: string): void;
  }>,
): Promise<TargetInteractionResult> {
  if (input.intent === 'use' && input.openStation(input.target.position)) return 'handled';
  if (!input.target.adjacent) return 'fallback';
  let response: { result: unknown };
  try {
    response = await input.perform(
      createVoxelInteractionAction(
        input.gameplay,
        { position: input.target.position, adjacent: input.target.adjacent },
        input.intent,
      ),
    );
  } catch (error) {
    input.failed(error instanceof Error ? error.message : String(error));
    return 'handled';
  }
  const result = response.result as { success?: boolean; reason?: string };
  input.refresh();
  if (result.success) {
    input.succeeded();
    return 'handled';
  }
  if (result.reason === 'no-selected-item' || result.reason === 'item-no-interaction') return 'fallback';
  input.failed(result.reason ?? 'interaction-rejected');
  return 'handled';
}

export async function performSecondaryInteraction(
  input: Readonly<{
    target: VoxelTarget | null;
    bypassTarget: boolean;
    useTarget: (
      target: Pick<VoxelTarget, 'position' | 'adjacent'>,
      intent: 'use' | 'alternate',
    ) => Promise<TargetInteractionResult>;
    useHeldItem: () => boolean;
    place: (position: [number, number, number]) => void;
    feedback: (message: string, tone: 'error') => void;
  }>,
): Promise<SecondaryInteractionResult> {
  if (input.target) {
    const target = await input.useTarget(input.target, input.bypassTarget ? 'alternate' : 'use');
    if (target === 'handled') return 'target';
  }
  if (input.useHeldItem()) return 'held-item';
  if (!input.target) {
    input.feedback('距离过远', 'error');
    return 'out-of-range';
  }
  if (!input.target.adjacent) {
    input.feedback('无法放置', 'error');
    return 'blocked';
  }
  input.place(input.target.adjacent);
  return 'place';
}
