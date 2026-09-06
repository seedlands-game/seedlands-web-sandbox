import { Voxel } from '../../world/voxel';
import type { SfxKey, SurfaceSound } from './audio-types';

export type GameplayPresentationEvent =
  | { kind: 'break' | 'place'; voxel: number; position: readonly [number, number, number] }
  | {
      kind: 'pickup' | 'craft' | 'eat' | 'attack' | 'damage' | 'rejected';
      position?: readonly [number, number, number];
    };

export function surfaceSound(voxel: number): SurfaceSound {
  if (voxel === Voxel.Wood || voxel === Voxel.Leaves) return 'wood';
  if (voxel === Voxel.Grass || voxel === Voxel.Dirt) return 'grass';
  if (voxel === Voxel.Sand) return 'sand';
  if (voxel === Voxel.Water) return 'water';
  if (voxel === Voxel.Snow) return 'snow';
  return 'stone';
}

export function soundForGameplayEvent(event: GameplayPresentationEvent): {
  key: SfxKey;
  priority: number;
  position?: readonly [number, number, number];
} {
  if (event.kind === 'break' || event.kind === 'place')
    return { key: `${event.kind}-${surfaceSound(event.voxel)}`, position: event.position, priority: 1 };
  const keys: Record<Exclude<GameplayPresentationEvent['kind'], 'break' | 'place'>, SfxKey> = {
    pickup: 'pickup',
    craft: 'confirm',
    eat: 'eat',
    attack: 'attack',
    damage: 'damage',
    rejected: 'cancel',
  };
  return {
    key: keys[event.kind],
    position: event.position,
    priority: event.kind === 'damage' ? 4 : event.kind === 'rejected' ? 0 : 2,
  };
}
