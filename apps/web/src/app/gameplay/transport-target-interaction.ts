import type {
  AuthorityAction,
  AuthorityGameplayView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { itemInteractionSelection } from '../player/secondary-interaction';

type Point = readonly [number, number, number];
type View = Pick<AuthorityGameplayView, 'inventory' | 'player' | 'transports' | 'transportDefinitions'>;
type TransportStateReference = NonNullable<AuthorityGameplayView['transports']>[number]['reference'];

/** Pick the accepted body's oriented bounds, clipped by the native voxel ray. */
export function transportTargetAction(
  view: View,
  origin: Point,
  direction: Point,
  maxDistance: number,
  intent: 'use' | 'alternate',
): Extract<AuthorityAction, { type: 'interact' }> | null {
  const selection = itemInteractionSelection(view);
  const transports = view.transports ?? [];
  if (intent === 'alternate' && transports.some((state) => state.rider?.entityId === view.player.entityId))
    return { type: 'interact', intent, target: { kind: 'self' }, expectedSelection: selection };
  if (intent !== 'use') return null;
  if (![...origin, ...direction, maxDistance].every(Number.isFinite) || maxDistance <= 0) return null;
  const length = Math.hypot(...direction);
  if (!length) return null;
  const ray = direction.map((value) => value / length);
  const definitions = new Map((view.transportDefinitions ?? []).map((definition) => [definition.id, definition]));
  let nearest = Math.min(5, maxDistance);
  let reference: TransportStateReference | null = null;
  for (const state of transports) {
    const definition = definitions.get(state.definitionId);
    if (!definition) continue;
    const cos = Math.cos(state.pose.yaw),
      sin = Math.sin(state.pose.yaw);
    const delta = origin.map((value, axis) => value - state.pose.position[axis]);
    const localOrigin = [cos * delta[0] - sin * delta[2], delta[1], sin * delta[0] + cos * delta[2]];
    const localRay = [cos * ray[0] - sin * ray[2], ray[1], sin * ray[0] + cos * ray[2]];
    const { min, max } = definition.bodyAabb;
    const lower = [min.x, min.y, min.z],
      upper = [max.x, max.y, max.z];
    let enter = 0,
      exit = nearest;
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(localRay[axis]) < 1e-12) {
        if (localOrigin[axis] < lower[axis] || localOrigin[axis] > upper[axis]) exit = -1;
      } else {
        const a = (lower[axis] - localOrigin[axis]) / localRay[axis];
        const b = (upper[axis] - localOrigin[axis]) / localRay[axis];
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (enter <= exit && enter < nearest) {
      nearest = enter;
      reference = state.reference;
    }
  }
  return reference
    ? { type: 'interact', intent, target: { kind: 'entity', reference }, expectedSelection: selection }
    : null;
}

export async function performTransportTargetInteraction(
  input: Readonly<{
    gameplay: View;
    origin: Point;
    direction: Point;
    maxDistance: number;
    intent: 'use' | 'alternate';
    perform(action: Extract<AuthorityAction, { type: 'interact' }>): Promise<{ result: unknown }>;
    refresh(): void;
    succeeded(): void;
    failed(reason: string): void;
  }>,
): Promise<'handled' | 'fallback'> {
  const action = transportTargetAction(input.gameplay, input.origin, input.direction, input.maxDistance, input.intent);
  if (!action) return 'fallback';
  try {
    const response = await input.perform(action);
    const result = response.result as { success?: boolean; reason?: string };
    input.refresh();
    if (result.success) input.succeeded();
    else input.failed(result.reason ?? 'interaction-rejected');
  } catch (error) {
    input.failed(error instanceof Error ? error.message : String(error));
  }
  return 'handled';
}
