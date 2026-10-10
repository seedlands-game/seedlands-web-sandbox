export const metadataSubcases = new Map([
  [
    8,
    {
      values: ['level bits 0–7', 'falling flag 8'],
      note: 'raw 0–15 includes falling states 8–15; source/reflow transition and cross-cell evolution require a tick fixture',
      file: 'BlockFlowing.java',
    },
  ],
  [
    9,
    {
      values: ['level bits 0–7', 'falling flag 8'],
      note: 'raw 0–15 includes falling states 8–15; source/reflow transition and cross-cell evolution require a tick fixture',
      file: 'BlockStationary.java',
    },
  ],
  [
    10,
    {
      values: ['level bits 0–7', 'falling flag 8'],
      note: 'raw 0–15 includes falling states 8–15; source/reflow transition and cross-cell evolution require a tick fixture',
      file: 'BlockFlowing.java',
    },
  ],
  [
    11,
    {
      values: ['level bits 0–7', 'falling flag 8'],
      note: 'raw 0–15 includes falling states 8–15; source/reflow transition and cross-cell evolution require a tick fixture',
      file: 'BlockStationary.java',
    },
  ],
  [
    6,
    {
      values: ['oak', 'spruce', 'birch', 'raw type bits 3'],
      note: 'low bits 0–3 with bit 8 growth flag; type bits 3 enter default tree branch but ordinary obtainability is unproven',
      file: 'BlockSapling.java',
    },
  ],
  [
    17,
    {
      values: ['oak', 'spruce', 'birch'],
      note: 'values 0–2; other raw metadata needs invalid-state tests',
      file: 'BlockLog.java',
    },
  ],
  [
    18,
    {
      values: ['oak', 'spruce', 'birch', 'raw type bits 3'],
      note: 'low bits 0–3 plus decay bit 8; bit 4 and full transitions remain unclosed',
      file: 'BlockLeaves.java',
    },
  ],
  [
    31,
    {
      values: ['shrub', 'grass', 'fern'],
      note: 'values 0–2; invalid value 3 must be checked',
      file: 'BlockTallGrass.java',
    },
  ],
  [
    35,
    {
      values: [
        'white',
        'orange',
        'magenta',
        'light-blue',
        'yellow',
        'lime',
        'pink',
        'gray',
        'light-gray',
        'cyan',
        'purple',
        'blue',
        'brown',
        'green',
        'red',
        'black',
      ],
      note: 'all metadata values 0–15',
      file: 'BlockCloth.java',
    },
  ],
  [
    43,
    {
      values: ['stone', 'sandstone', 'wood', 'cobblestone'],
      note: 'double slab values 0–3; raw 4–15 invalid-state behavior unclosed',
      file: 'BlockStep.java',
    },
  ],
  [
    44,
    {
      values: ['stone', 'sandstone', 'wood', 'cobblestone'],
      note: 'single slab values 0–3; raw 4–15 invalid-state behavior unclosed',
      file: 'BlockStep.java',
    },
  ],
  [
    50,
    {
      values: ['wall directions 1–4', 'upright 5'],
      note: 'placement support and raw 0/6–15 behavior require placement/removal fixtures',
      file: 'BlockTorch.java',
    },
  ],
  [
    51,
    {
      values: ['age 0–15'],
      note: 'age drives tick propagation/extinguish behavior; each boundary is still an RNG/tick case',
      file: 'BlockFire.java',
    },
  ],
  [
    59,
    {
      values: ['growth 0–7'],
      note: 'stage 7 is mature; lower stages and growth RNG need fixed-random tick fixtures',
      file: 'BlockCrops.java',
    },
  ],
  [
    60,
    {
      values: ['moisture 0–7'],
      note: '7 is hydrated; hydration, drying, and trampling require separate tick/entity fixtures',
      file: 'BlockFarmland.java',
    },
  ],
  [
    61,
    {
      values: ['facing 2–5'],
      note: 'idle furnace facing; activation swaps block ID and must preserve metadata in a fixture',
      file: 'BlockFurnace.java',
    },
  ],
  [
    62,
    {
      values: ['facing 2–5'],
      note: 'lit furnace facing; extinguish swap and inventory persistence require a fixture',
      file: 'BlockFurnace.java',
    },
  ],
  [
    63,
    {
      values: ['rotation 0–15'],
      note: 'standing-sign rotation; text belongs to TileEntitySign rather than this metadata byte',
      file: 'BlockSign.java',
    },
  ],
  [
    64,
    {
      values: ['lower-half facing/open bits', 'upper-half hinge bit'],
      note: 'two-block atomic placement, toggling, and invalid half recovery are separate cases',
      file: 'BlockDoor.java',
    },
  ],
  [
    65,
    {
      values: ['wall directions 2–5'],
      note: 'support removal and raw metadata recovery require a fixture',
      file: 'BlockLadder.java',
    },
  ],
  [
    66,
    {
      values: ['straight/ascending/curve rail shapes 0–9'],
      note: 'neighbor-driven shape transitions are distinct from static metadata labels',
      file: 'BlockRail.java',
    },
  ],
  [
    67,
    {
      values: ['facing 0–3'],
      note: 'stair collision geometry must be checked independently of this orientation encoding',
      file: 'BlockStairs.java',
    },
  ],
  [
    68,
    {
      values: ['wall directions 2–5'],
      note: 'sign text is TileEntitySign state; support removal needs a fixture',
      file: 'BlockSign.java',
    },
  ],
  [
    78,
    {
      values: ['snow layers 0–7'],
      note: 'layer collision/selection and melt behavior remain separate fixtures',
      file: 'BlockSnow.java',
    },
  ],
  [
    86,
    {
      values: ['facing 0–3'],
      note: 'placement direction and golem construction are separate behavior cases',
      file: 'BlockPumpkin.java',
    },
  ],
  [
    91,
    {
      values: ['facing 0–3'],
      note: 'lit pumpkin placement direction and lighting are separate cases',
      file: 'BlockPumpkin.java',
    },
  ],
  [
    92,
    {
      values: ['bites 0–5'],
      note: 'the next use changes metadata or removes the block; full-health negative control is required',
      file: 'BlockCake.java',
    },
  ],
  [
    96,
    {
      values: ['facing bits', 'open bit'],
      note: 'trapdoor support, collision, toggle, and invalid-state recovery require fixtures',
      file: 'BlockTrapDoor.java',
    },
  ],
]);
export const itemMetadataSubcases = new Map([
  [
    263,
    {
      values: ['coal', 'charcoal'],
      note: 'metadata 0/1; other raw values map to coal label in source',
      file: 'ItemCoal.java',
    },
  ],
  [
    351,
    {
      values: [
        'black',
        'red',
        'green',
        'brown',
        'blue',
        'purple',
        'cyan',
        'light-gray',
        'gray',
        'pink',
        'lime',
        'yellow',
        'light-blue',
        'magenta',
        'orange',
        'white',
      ],
      note: 'all metadata values 0–15; wool uses reversed color index',
      file: 'ItemDye.java',
    },
  ],
]);
export const blockBehaviorCandidates = new Map([
  [
    59,
    {
      text: '小麦成熟阶段 7 掉 1 个小麦；每次收割再做 3 次 nextInt(15)<=生长阶段 的种子候选判定。',
      file: 'BlockCrops.java',
    },
  ],
  [
    60,
    {
      text: '耕地受水平四格内水或上方雨水保持湿润元数据 7；无水且不受雨逐次减 1，实体踩踏有 1/4 退化机会。',
      file: 'BlockFarmland.java',
    },
  ],
  [46, { text: '正常引燃 TNT 后实体引信初始 80 tick；链式爆炸另有独立初始化路径。', file: 'EntityTNTPrimed.java' }],
]);
export const entityNames = [
  'Player',
  'Item',
  'Arrow',
  'Boat',
  'Chicken',
  'Cow',
  'Creeper',
  'FallingSand',
  'Ghast',
  'Giant',
  'Minecart',
  'Mob',
  'Monster',
  'Painting',
  'Pig',
  'PigZombie',
  'PrimedTnt',
  'Sheep',
  'Skeleton',
  'Slime',
  'Snowball',
  'Spider',
  'Squid',
  'Wolf',
  'Zombie',
  'FishHook',
  'Egg',
  'Lightning',
  'MinecartChest',
  'MinecartFurnace',
];
export const runtimeEntities = new Map([
  ['Player', { className: 'EntityPlayer' }],
  ['FishHook', { className: 'EntityFish' }],
  ['Egg', { className: 'EntityEgg' }],
  ['Lightning', { className: 'EntityLightningBolt' }],
  ['MinecartChest', { className: 'EntityMinecart', variant: { minecartType: 1 } }],
  ['MinecartFurnace', { className: 'EntityMinecart', variant: { minecartType: 2 } }],
]);
export const entityBehaviorAnchors = new Map([
  ['Player', 'constructor, onUpdate, damageEntity, readEntityFromNBT, writeEntityToNBT'],
  ['Item', 'constructor, onUpdate, onCollideWithPlayer, readEntityFromNBT, writeEntityToNBT'],
  ['Arrow', 'constructors, onUpdate, onCollideWithPlayer, readEntityFromNBT, writeEntityToNBT'],
  ['Boat', 'constructor, onUpdate, interact'],
  ['Chicken', 'constructor, onLivingUpdate, getDropItemId'],
  ['Cow', 'getDropItemId, interact'],
  ['Creeper', 'onUpdate, attackEntity, getDropItemId'],
  ['FallingSand', 'constructor, onUpdate, readEntityFromNBT, writeEntityToNBT'],
  ['Ghast', 'constructor, updatePlayerActionState, getDropItemId'],
  ['Giant', 'constructor'],
  ['Minecart', 'constructors, onUpdate, interact, readEntityFromNBT, writeEntityToNBT'],
  ['Mob', 'constructor, getCanSpawnHere'],
  ['Monster', 'base monster behavior inherited from EntityMob'],
  ['Painting', 'constructor, onValidSurface, onUpdate'],
  ['Pig', 'interact, getDropItemId, onStruckByLightning, readEntityFromNBT, writeEntityToNBT'],
  ['PigZombie', 'constructor and inherited EntityZombie behavior'],
  ['PrimedTnt', 'position constructor, onUpdate, readEntityFromNBT, writeEntityToNBT'],
  ['Sheep', 'dropFewItems, interact, readEntityFromNBT, writeEntityToNBT'],
  ['Skeleton', 'constructor, attackEntity'],
  ['Slime', 'constructor, setSlimeSize, setEntityDead, getCanSpawnHere'],
  ['Snowball', 'constructors, onUpdate'],
  ['Spider', 'constructor, findPlayerToAttack'],
  ['Squid', 'constructor, onLivingUpdate'],
  ['Wolf', 'constructor, interact, readEntityFromNBT, writeEntityToNBT'],
  ['Zombie', 'constructor, attackEntity'],
  ['FishHook', 'constructor, onUpdate, catchFish'],
  ['Egg', 'constructors, onUpdate'],
  ['Lightning', 'constructor, onUpdate'],
  ['MinecartChest', 'ItemMinecart.onItemUse; EntityMinecart constructors/readEntityFromNBT/writeEntityToNBT'],
  ['MinecartFurnace', 'ItemMinecart.onItemUse; EntityMinecart constructors/readEntityFromNBT/writeEntityToNBT'],
]);
export const entityObservations = new Map([
  ['Chicken', '初始化生命 4；每次产蛋计时为 6000+nextInt(6000) tick，产 1 枚蛋并重置该计时。'],
  ['Cow', '普通死亡掉皮革；手持空桶交互换为奶桶；本版本没有牛肉掉落。'],
  ['Pig', '鞍状态持久化；着火时掉熟猪肉、否则生猪肉；雷击后在同位置生成僵尸猪人并移除猪。'],
  ['Sheep', '未剪时死亡掉同色羊毛 1 个；持剪刀剪未剪羊掉同色羊毛 2+nextInt(3) 个，剪刀耗损 1；剪毛/颜色写入 NBT。'],
  ['Wolf', '未驯服且非愤怒状态可消耗骨头尝试驯服，成功门槛 nextInt(3)==0；成功后坐下、生命 20、记录主人。'],
  ['Slime', '初始化尺寸为 1/2/4 中一值；宽高均为 0.6×尺寸，生命为尺寸平方；NBT 保存尺寸减 1。'],
  ['PrimedTnt', '正常点燃的 TNT 实体引信初始化为 80 tick；Fuse 以字节写入 NBT。'],
  ['Egg', '鸡蛋碰撞后以 1/8 门槛生成小鸡；若成功，再以 1/32 门槛改为生成 4 只而非 1 只。'],
]);
