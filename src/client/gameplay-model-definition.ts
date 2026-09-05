export type HeldAction = 'idle' | 'mine' | 'attack' | 'place' | 'eat';

export type ItemVisualKind =
  | Readonly<{ kind: 'voxel-block'; faces: 6 }>
  | Readonly<{ kind: 'lantern' | 'berry-cluster' | 'plank' | 'wood-axe' | 'stone-pickaxe' }>;

const blockItems = new Set(['dirt-block', 'stone-block', 'wood-block', 'sand-block', 'glowstone-block']);

export function itemVisualKind(itemId: string): ItemVisualKind {
  if (blockItems.has(itemId)) return { kind: 'voxel-block', faces: 6 };
  if (itemId === 'lantern') return { kind: 'lantern' };
  if (itemId === 'berry') return { kind: 'berry-cluster' };
  if (itemId === 'plank') return { kind: 'plank' };
  if (itemId === 'wood-axe') return { kind: 'wood-axe' };
  if (itemId === 'stone-pickaxe') return { kind: 'stone-pickaxe' };
  return { kind: 'plank' };
}

const actors = {
  grazer: {
    silhouette: ['block-body', 'square-head', 'muzzle', 'ears', 'four-legs'],
    face: ['dark-eyes', 'cream-muzzle'],
    joints: ['front-left-leg', 'front-right-leg', 'back-left-leg', 'back-right-leg'],
    primaryColor: 'umber',
  },
  'night-stalker': {
    silhouette: ['segmented-body', 'low-head', 'spines', 'claw-legs'],
    face: ['amber-eyes', 'jaw'],
    joints: ['front-left-leg', 'front-right-leg', 'back-left-leg', 'back-right-leg'],
    primaryColor: 'charcoal-teal',
  },
  settler: {
    silhouette: ['square-head', 'cloth-tunic', 'pack', 'boots'],
    face: ['eyes', 'nose', 'beard'],
    joints: ['arm-left', 'arm-right', 'leg-left', 'leg-right'],
    primaryColor: 'teal-cloth',
  },
} as const;

export function actorModelDefinition(archetype: keyof typeof actors) {
  return actors[archetype];
}

export function viewmodelPose(action: HeldAction, seconds: number) {
  if (action === 'idle') return { shoulder: 0, elbow: 0, wrist: 0 };
  const cycle = action === 'mine' ? Math.sin(seconds * Math.PI * 3.2) : Math.sin(Math.min(1, seconds * 4) * Math.PI);
  if (action === 'eat') return { shoulder: -22 + cycle * 13, elbow: 42 - cycle * 16, wrist: -12 + cycle * 9 };
  if (action === 'place') return { shoulder: -14 + cycle * 32, elbow: 21 - cycle * 27, wrist: cycle * 12 };
  return { shoulder: -15 + cycle * 48, elbow: 25 - cycle * 42, wrist: -8 + cycle * 21 };
}
