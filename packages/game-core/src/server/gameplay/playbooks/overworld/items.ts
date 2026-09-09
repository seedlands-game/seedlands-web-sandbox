import type { ItemDefinitionInput } from '@seedlands/game-core/mod-api';

/** Version 1 storage IDs and voxel palette preserve supported save inputs. */
export const overworldItems: readonly ItemDefinitionInput[] = [
  {
    id: 'glowstone-block',
    name: '辉光石',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 9 }],
  },
  {
    id: 'lantern',
    name: '灯笼',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 10 }],
  },
  {
    id: 'dirt-block',
    name: '泥土块',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 2 }],
  },
  {
    id: 'stone-block',
    name: '石块',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 3 }],
  },
  {
    id: 'wood-block',
    name: '原木',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 4 }],
  },
  {
    id: 'sand-block',
    name: '沙块',
    itemType: 'block',
    stackLimit: 64,
    capabilities: [{ type: 'place', voxel: 6 }],
  },
  {
    id: 'berry',
    name: '浆果',
    itemType: 'food',
    stackLimit: 64,
    capabilities: [{ type: 'consume', hungerRestore: 4 }],
  },
  {
    id: 'plank',
    name: '木板',
    itemType: 'resource',
    stackLimit: 64,
    capabilities: [],
  },
  {
    id: 'wood-axe',
    name: '木斧',
    itemType: 'tool',
    stackLimit: 1,
    capabilities: [{ type: 'mine', tool: 'axe', multiplier: 3 }],
  },
  {
    id: 'stone-pickaxe',
    name: '石镐',
    itemType: 'tool',
    stackLimit: 1,
    capabilities: [{ type: 'mine', tool: 'pickaxe', multiplier: 4 }],
  },
  {
    id: 'wood-sword',
    name: '木剑',
    itemType: 'tool',
    stackLimit: 1,
    capabilities: [{ type: 'melee', definitionId: 'wood-sword' }],
  },
];
