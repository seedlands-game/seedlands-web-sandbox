import type {
  AuthorityAction,
  AuthorityGameplayView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { itemInteractionSelection } from '../player/secondary-interaction';

/** Only the accepted held-item projection decides whether this real right click is navigation. */
type NavigationInput = Readonly<{
  gameplay: Pick<AuthorityGameplayView, 'inventory' | 'player' | 'navigation'>;
  perform(action: Extract<AuthorityAction, { type: 'interact' }>): Promise<{ result: unknown }>;
  refresh(): void;
  succeeded(): void;
  failed(reason: string): void;
}>;
export function useNavigationHeldItem(input: NavigationInput): boolean {
  const navigation = input.gameplay.navigation;
  if (!navigation) return false;
  if (navigation.kind !== 'map') return true;
  const completed = (response: { result: unknown }) => {
    const result = response.result;
    if (result && typeof result === 'object' && 'success' in result && result.success === true) {
      input.refresh();
      input.succeeded();
    } else
      input.failed(
        result && typeof result === 'object' && 'reason' in result ? String(result.reason) : 'navigation-rejected',
      );
  };
  const action: Extract<AuthorityAction, { type: 'interact' }> = {
    type: 'interact',
    intent: 'use',
    target: { kind: 'self' },
    expectedSelection: itemInteractionSelection(input.gameplay),
  };
  void Promise.resolve()
    .then(() => input.perform(action))
    .then(completed)
    .catch((error: unknown) => input.failed(error instanceof Error ? error.message : String(error)));
  return true;
}

export function useGameplayHeldItem(
  input: NavigationInput &
    Readonly<{
      isEdible(itemId: string): boolean;
      consume(slot: number): void;
    }>,
): boolean {
  if (useNavigationHeldItem(input)) return true;
  const player = input.gameplay.player;
  if (player.mode?.value === 'creative') return false;
  const stack = player.inventory[player.selectedSlot];
  if (!stack || !input.isEdible(stack.itemId)) return false;
  input.consume(player.selectedSlot);
  return true;
}
