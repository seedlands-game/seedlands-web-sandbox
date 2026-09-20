import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lower-bound, finite variant ledger. This enumerates observable states, not
// complete gameplay fixtures or an executable copy of the reference game.
const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const parentById = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
const sourceBase =
  'https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src';
const variants = [];
const mechanismIds = (groups) =>
  catalog.cases
    .filter((entry) => entry.kind === 'mechanism' && groups.some((group) => entry.caseId.startsWith(group + '-')))
    .map((entry) => entry.caseId);
// These cannot be exhausted as a finite metadata list. Each family needs a
// source-backed partition rule and fixed boundary/negative fixtures before
// the whole reference contract can be accepted.
const openEndedFamilies = [
  {
    familyId: 'V-O01-sign-text',
    affectedCaseIds: ['B-063', 'B-068'],
    coverageRule: '空串、最大可见长度、换行/字符编码、持久化与多人内容入口排除的等价类和边界值',
  },
  {
    familyId: 'V-O02-container-contents',
    affectedCaseIds: ['B-054', 'B-061', 'B-062', 'B-084', 'E-MinecartChest'],
    coverageRule: '槽位、堆叠、物品元数据、余物、溢出、保存恢复及错误输入的组合覆盖',
  },
  {
    familyId: 'V-O03-map-state',
    affectedCaseIds: ['I-358'],
    coverageRule: '地图 ID、缩放、像素/颜色、视角移动与存档恢复的边界分区',
  },
  {
    familyId: 'V-O04-neighbor-updates',
    affectedCaseIds: ['B-008', 'B-009', 'B-010', 'B-011', 'B-051', 'B-078', 'B-085'],
    coverageRule: '邻居朝向/更新顺序、流体源与流动、火传播、遮挡、载入边界的成对与反例覆盖',
  },
  {
    familyId: 'V-O05-world-generation',
    affectedCaseIds: mechanismIds(['M02', 'M03', 'M04', 'M05']),
    coverageRule: 'seed、区块坐标、生物群系、结构、矿脉、跨区块及生成顺序的预注册样本/边界覆盖',
  },
  {
    familyId: 'V-O06-entity-ai',
    affectedCaseIds: mechanismIds(['M20', 'M21', 'M22', 'M23']),
    coverageRule: '目标、障碍、地形、光照、感知、路径重算、随机源与存档恢复的状态分区',
  },
  {
    familyId: 'V-O07-player-action-state',
    affectedCaseIds: mechanismIds(['M14', 'M15', 'M16', 'M17', 'M18', 'M19']),
    coverageRule: '玩家姿态、速度、手持物、目标面、游戏 tick、碰撞及 UI 反馈的边界组合',
  },
  {
    familyId: 'V-O08-perceptual-state',
    affectedCaseIds: mechanismIds(['M28', 'M29', 'M30', 'M31', 'M32']),
    coverageRule: '时刻/天气/光照、视距、材质动画、实体姿态和声源混音的原创资产感知样本',
  },
].map((entry) => ({
  ...entry,
  status: 'NOT_FIXED',
  sourceReview: 'PENDING',
  ownerReview: 'PENDING',
  partitionFixture: null,
}));
const add = (parentId, key, state, sourceFiles) => {
  const parent = parentById.get(parentId);
  if (!parent) throw new Error('Missing parent ' + parentId);
  if (parent.scope !== '做') throw new Error('Non-playable variant parent ' + parentId);
  variants.push({
    caseId: parentId + '~' + key,
    parentCaseId: parentId,
    kind: parent.kind,
    scope: parent.scope,
    expected: { variantState: state },
    evidence: (Array.isArray(sourceFiles) ? sourceFiles : [sourceFiles]).map((sourceFile) => ({
      uri: sourceBase + '/' + sourceFile + '.java',
      supports: 'fixed reconstructed-source variant candidate only',
    })),
    unresolved: '逐变体行为、原版来源等价、固定初态/RNG/输入/结果/负控和 owner 审核未关闭。',
    referenceStatus: 'PARTIAL_REFERENCE_GAP',
    review: { evidenceLevel: 'RECONSTRUCTED_SOURCE_CANDIDATE', confidence: 'UNREVIEWED', ownerReview: 'PENDING' },
    fixture: { status: 'NOT_FIXED', initialStateDigest: null, rngState: null, tickInputs: null, negativeControl: null },
    executionStatus: 'NOT_RUN',
  });
};
const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => start + index);
const block = (id) => 'B-' + String(id).padStart(3, '0');
const item = (id) => 'I-' + id;
const metadata = (id, values, file) => {
  for (const value of values) add(block(id), 'm' + String(value).padStart(2, '0'), { metadata: value }, file);
};

for (const [key, aboveBlockMaterial] of [
  ['clear', 'air'],
  ['snow-covered', 'snow'],
])
  add(block(2), key, { grassMetadata: 0, aboveBlockMaterial, observation: 'top/side texture selection' }, 'BlockGrass');
for (const typeBits of range(0, 3))
  for (const growFlag of [0, 8]) {
    const value = typeBits | growFlag;
    add(
      block(6),
      'm' + String(value).padStart(2, '0'),
      { metadata: value, typeBits, growFlag: Boolean(growFlag), type3UsesDefaultBranch: typeBits === 3 },
      'BlockSapling',
    );
  }
for (const id of [8, 9, 10, 11])
  for (const value of range(0, 15))
    add(
      block(id),
      'm' + String(value).padStart(2, '0'),
      { metadata: value, levelBits: value & 7, fallingFlag: value >= 8 },
      id === 8 || id === 10 ? ['BlockFluid', 'BlockFlowing'] : ['BlockFluid', 'BlockStationary'],
    );
metadata(17, range(0, 2), 'BlockLog');
for (const typeBits of range(0, 3))
  for (const decayFlag of [0, 8]) {
    const value = typeBits | decayFlag;
    add(
      block(18),
      'm' + String(value).padStart(2, '0'),
      { metadata: value, typeBits, decayFlag: Boolean(decayFlag) },
      'BlockLeaves',
    );
  }
for (const pitch of range(0, 24))
  add(
    block(25),
    'pitch-' + String(pitch).padStart(2, '0'),
    { note: pitch, supportingMaterial: 'other', eventKey: 'note.harp' },
    ['TileEntityNote', 'BlockNote'],
  );
for (const [supportingMaterial, eventKey] of [
  ['rock', 'note.bd'],
  ['sand', 'note.snare'],
  ['glass', 'note.hat'],
  ['wood', 'note.bassattack'],
])
  add(block(25), 'instrument-' + supportingMaterial, { note: 12, supportingMaterial, eventKey }, [
    'TileEntityNote',
    'BlockNote',
  ]);
for (const facing of range(0, 3))
  for (const occupied of [false, true]) {
    add(
      block(26),
      'f' + facing + '-occupied-' + Number(occupied),
      {
        facing,
        occupied,
        placedFirstCellMetadata: facing,
        placedOffsetCellMetadata: facing | 8,
        observedOffsetCellMetadata: facing | 8 | (occupied ? 4 : 0),
        occupiedSetBySuccessfulSleep: occupied,
        bothCellsRequired: true,
      },
      ['ItemBed', 'BlockBed'],
    );
  }
metadata(31, range(0, 2), 'BlockTallGrass');
metadata(35, range(0, 15), 'BlockCloth');
for (const id of [43, 44]) metadata(id, range(0, 3), 'BlockStep');
metadata(50, range(1, 5), 'BlockTorch');
metadata(51, range(0, 15), 'BlockFire');
for (const mob of ['Skeleton', 'Zombie', 'Spider'])
  add(block(52), 'mob-' + mob.toLowerCase(), { mobType: mob }, 'WorldGenDungeons');
for (const id of [53, 67]) metadata(id, range(0, 3), 'BlockStairs');
for (const state of [
  'single-north',
  'single-south',
  'single-east',
  'single-west',
  'double-x',
  'double-z',
  'top-blocked',
  'invalid-third',
]) {
  add(block(54), state, { chestTopology: state }, 'BlockChest');
}
for (const id of [59, 60]) metadata(id, range(0, 7), id === 59 ? 'BlockCrops' : 'BlockFarmland');
for (const id of [61, 62]) metadata(id, range(2, 5), 'BlockFurnace');
metadata(63, range(0, 15), 'BlockSign');
metadata(68, range(2, 5), 'BlockSign');
for (const facing of range(0, 3))
  for (const open of [false, true]) {
    const lowerMetadata = facing | (open ? 4 : 0);
    add(
      block(64),
      'f' + facing + '-open-' + Number(open),
      { facing, open, lowerMetadata, twoHalvesConsistent: true },
      'BlockDoor',
    );
    add(
      block(64),
      'upper-m' + String(lowerMetadata + 8).padStart(2, '0'),
      { facing, open, upperMetadata: lowerMetadata + 8, pairedLowerMetadata: lowerMetadata },
      'BlockDoor',
    );
  }
metadata(65, range(2, 5), 'BlockLadder');
metadata(66, range(0, 9), 'BlockRail');
add(block(73), 'ore-idle', { blockId: 73, transition: 'idle' }, 'BlockRedstoneOre');
add(block(74), 'ore-glowing', { blockId: 74, transition: 'activated' }, 'BlockRedstoneOre');
metadata(78, range(0, 7), 'BlockSnow');
for (const id of [81, 83]) metadata(id, range(0, 15), id === 81 ? 'BlockCactus' : 'BlockReed');
for (const record of ['empty', '2256', '2257'])
  add(block(84), 'record-' + record, { record }, 'TileEntityRecordPlayer');
for (const mask of range(0, 15))
  add(block(85), 'neighbors-' + String(mask).padStart(2, '0'), { horizontalNeighborMask: mask }, 'BlockFence');
for (const id of [86, 91]) metadata(id, range(0, 3), 'BlockPumpkin');
metadata(92, range(0, 5), 'BlockCake');
for (const facing of range(0, 3))
  for (const open of [false, true]) {
    const value = facing | (open ? 4 : 0);
    add(block(96), 'm' + String(value).padStart(2, '0'), { metadata: value, facing, open }, 'BlockTrapDoor');
  }

for (const value of [0, 1]) add(item(263), 'm' + value, { metadata: value }, 'ItemCoal');
for (const value of range(0, 15)) add(item(351), 'm' + String(value).padStart(2, '0'), { metadata: value }, 'ItemDye');
const toolClasses = new Set(['ItemSpade', 'ItemPickaxe', 'ItemAxe', 'ItemSword', 'ItemHoe']);
const armorClasses = new Set(['ItemArmor']);
const tools = catalog.cases.filter(
  (entry) =>
    entry.kind === 'item' && entry.scope === '做' && toolClasses.has(entry.expected.staticRegistration.className),
);
const armor = catalog.cases.filter(
  (entry) =>
    entry.kind === 'item' && entry.scope === '做' && armorClasses.has(entry.expected.staticRegistration.className),
);
if (tools.length !== 25 || armor.length !== 16) throw new Error('Durability family denominator drift');
for (const entry of [...tools, ...armor, ...[259, 346, 359].map((id) => parentById.get(item(id)))]) {
  const max = entry.expected.staticRegistration.maxUses;
  if (!Number.isInteger(max) || max < 3) throw new Error('Invalid max durability ' + entry.caseId);
  const values = [0, Math.floor(max / 2), max];
  const file = entry.expected.staticRegistration.className;
  for (const [index, value] of values.entries()) {
    add(
      entry.caseId,
      'damage-' + ['new', 'mid', 'last'][index],
      {
        rawDamage: value,
        maxDamage: max,
        nextOneDamageBreaksStack: value === max,
        breakCondition: 'itemDamage > maxDamage',
      },
      [file, 'ItemStack'],
    );
  }
}
for (const state of ['new-map-id', 'distinct-map-id', 'save-reload-id'])
  add(item(358), state, { mapIdBoundary: state }, 'ItemMap');

const entity = (name) => 'E-' + name;
const states = (name, keys, file) => {
  for (const key of keys) add(entity(name), key, { state: key }, file);
};
states('Item', ['airborne', 'grounded', 'picked-up'], 'EntityItem');
states('Arrow', ['airborne', 'embedded', 'recovered'], 'EntityArrow');
for (const age of [0, 5999, 6000])
  add(entity('Item'), 'age-' + age, { age, removedOnUpdate: age >= 5999 }, 'EntityItem');
for (const delayBeforeCanPickup of [0, 1])
  add(
    entity('Item'),
    'pickup-delay-' + delayBeforeCanPickup,
    { delayBeforeCanPickup, pickupAllowedAtCollision: delayBeforeCanPickup === 0 },
    'EntityItem',
  );
for (const ticksInGround of [0, 1199, 1200])
  add(
    entity('Arrow'),
    'embedded-age-' + ticksInGround,
    { ticksInGround, removedOnUpdate: ticksInGround === 1199 },
    'EntityArrow',
  );
for (const doesArrowBelongToPlayer of [false, true])
  add(
    entity('Arrow'),
    'player-owned-' + Number(doesArrowBelongToPlayer),
    { doesArrowBelongToPlayer, pickupAllowedWhenEmbeddedAndSettled: doesArrowBelongToPlayer },
    'EntityArrow',
  );
states('Snowball', ['airborne', 'impact', 'despawn'], 'EntitySnowball');
states('Boat', ['empty', 'ridden', 'broken'], 'EntityBoat');
states('Chicken', ['egg-timer-before', 'egg-timer-at'], 'EntityChicken');
states('Cow', ['milk-interaction', 'leather-drop'], 'EntityCow');
states('Creeper', ['normal', 'charged', 'skeleton-kill-record'], 'EntityCreeper');
states('FallingSand', ['sand', 'gravel'], 'EntityFallingSand');
add(entity('Minecart'), 'ordinary', { minecartType: 0 }, 'EntityMinecart');
add(entity('MinecartChest'), 'chest-type', { minecartType: 1 }, 'EntityMinecart');
add(entity('MinecartFurnace'), 'furnace-type', { minecartType: 2 }, 'EntityMinecart');
const paintings = [
  'Kebab',
  'Aztec',
  'Alban',
  'Aztec2',
  'Bomb',
  'Plant',
  'Wasteland',
  'Pool',
  'Courbet',
  'Sea',
  'Sunset',
  'Creebet',
  'Wanderer',
  'Graham',
  'Match',
  'Bust',
  'Stage',
  'Void',
  'SkullAndRoses',
  'Fighters',
  'Pointer',
  'Pigscene',
  'BurningSkull',
  'Skeleton',
  'DonkeyKong',
];
for (const art of paintings) add(entity('Painting'), 'motive-' + art.toLowerCase(), { motive: art }, 'EnumArt');
states('Pig', ['unsaddled', 'saddled', 'raw-drop', 'cooked-drop', 'lightning-conversion'], 'EntityPig');
states('PigZombie', ['lightning-derived'], 'EntityPigZombie');
states('PrimedTnt', ['fuse-start', 'fuse-middle', 'explosion-boundary'], 'EntityTNTPrimed');
for (const color of range(0, 15))
  for (const sheared of [false, true]) {
    add(
      entity('Sheep'),
      'color-' + String(color).padStart(2, '0') + '-sheared-' + Number(sheared),
      { color, sheared },
      'EntitySheep',
    );
  }
for (const size of [1, 2, 4]) add(entity('Slime'), 'size-' + size, { size }, 'EntitySlime');
states('Spider', ['ordinary'], 'EntitySpider');
add(
  entity('Spider'),
  'skeleton-rider',
  { state: 'skeleton-rider', spawnGate: 'nextInt(100)==0 after eligible spider spawn' },
  'SpawnerAnimals',
);
states('Wolf', ['wild', 'angry', 'tamed-standing', 'tamed-sitting', 'tamed-healing'], 'EntityWolf');
states('FishHook', ['flying', 'hooked', 'retrieved'], 'EntityFish');
states('Egg', ['zero-chicks', 'one-chick', 'four-chicks'], 'EntityEgg');
states('Lightning', ['start', 'strike', 'end'], 'EntityLightningBolt');

const counts = Object.fromEntries(
  ['block', 'item', 'entity'].map((kind) => [kind, variants.filter((entry) => entry.kind === kind).length]),
);
if (counts.block !== 346 || counts.item !== 153 || counts.entity !== 119)
  throw new Error('Variant denominator drift ' + JSON.stringify(counts));
if (new Set(variants.map((entry) => entry.caseId)).size !== variants.length) throw new Error('Duplicate variant ID');
await writeFile(
  join(root, 'variant-cases.json'),
  JSON.stringify(
    {
      schemaVersion: 2,
      referenceCaseSetVersion: catalog.referenceCaseSetVersion,
      status: 'PARTIAL_REFERENCE_GAP',
      counts,
      openEndedFamilies,
      cases: variants,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ variants: variants.length, openEndedFamilies: openEndedFamilies.length, counts }));
