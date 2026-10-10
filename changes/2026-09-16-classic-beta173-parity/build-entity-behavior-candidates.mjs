import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const parentEntities = catalog.cases.filter((entry) => entry.kind === 'entity');
const expectedNames = [
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
if (
  parentEntities.length !== 30 ||
  parentEntities.some((entry, index) => entry.caseId !== `E-${expectedNames[index]}`)
) {
  throw new Error('Entity parent denominator or ordering drift');
}

// This commit is a reconstructed-source navigation aid, not an original jar or official behavioral oracle.
const commit = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const rawBase = `https://raw.githubusercontent.com/jacobo-mc/mc_b1.7.3_release/${commit}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const blobBase = `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${commit}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const runtimeClass = new Map([
  ['Player', 'EntityPlayer'],
  ['FishHook', 'EntityFish'],
  ['Egg', 'EntityEgg'],
  ['Lightning', 'EntityLightningBolt'],
  ['MinecartChest', 'EntityMinecart'],
  ['MinecartFurnace', 'EntityMinecart'],
]);

const ref = (file, line, method = null) => ({
  uri: `${blobBase}/${file}#L${line}`,
  file,
  line,
  ...(method ? { method } : {}),
});
async function get(file) {
  const response = await fetch(`${rawBase}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}
function inspect(text, file) {
  const result = [];
  for (const [index, line] of text.split('\n').entries()) {
    const method = line.match(/^\s*(?:public|protected|private)\s+(?:static\s+)?\S+\s+(\w+)\s*\(/)?.[1];
    if (method) result.push(ref(file, index + 1, method));
    if (/\bsetSize\(|\bhealth\s*=/.test(line)) result.push(ref(file, index + 1, 'constructor state candidate'));
  }
  return result;
}
function choose(all, names) {
  return all.filter(({ method }) => names.includes(method));
}

const entityList = await get('EntityList.java');
const registrations = new Map();
for (const match of entityList.matchAll(/addMapping\((Entity\w+)\.class, "(\w+)", (\d+)\)/g)) {
  const line = entityList.slice(0, match.index).split('\n').length;
  registrations.set(match[2], {
    className: match[1],
    numericId: Number(match[3]),
    source: ref('EntityList.java', line, 'addMapping'),
  });
}
const classNames = [
  ...new Set(expectedNames.map((name) => registrations.get(name)?.className ?? runtimeClass.get(name))),
];
if (classNames.some((name) => !name)) throw new Error('Missing class mapping');
const classSources = new Map();
async function loadClass(className) {
  if (classSources.has(className)) return classSources.get(className);
  const file = `${className}.java`;
  try {
    const text = await get(file);
    const declaration = text.match(/\bclass\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (!declaration || declaration[1] !== className) throw new Error(`${file}: class declaration or parent not found`);
    const result = { parent: declaration[2] ?? null, methods: inspect(text, file) };
    classSources.set(className, result);
    if (result.parent) await loadClass(result.parent);
  } catch (error) {
    classSources.set(className, { error: String(error) });
  }
  return classSources.get(className);
}
for (const className of classNames) await loadClass(className);

function ancestry(className) {
  const chain = [];
  const seen = new Set();
  let current = className;
  while (current && !seen.has(current)) {
    seen.add(current);
    const entry = classSources.get(current);
    if (!entry || entry.error) return { chain, error: entry?.error ?? `Missing class ${current}` };
    chain.push({ className: current, ...entry });
    current = entry.parent;
  }
  return { chain, error: current ? `Inheritance cycle at ${current}` : null };
}

const categories = {
  spawn: ['getCanSpawnHere'],
  aabbAndMotion: ['onUpdate', 'onLivingUpdate', 'moveEntity', 'setSize', 'setPosition', 'setVelocity'],
  aiAndInteraction: ['interact', 'updatePlayerActionState', 'attackEntity', 'onCollideWithPlayer'],
  damageAndDrop: ['attackEntityFrom', 'dropFewItems', 'getDropItemId', 'onDeath', 'setDead'],
  soundAndAnimation: ['getLivingSound', 'getHurtSound', 'getDeathSound', 'getSoundVolume', 'handleHealthUpdate'],
  saveAndLoad: ['writeEntityToNBT', 'readEntityFromNBT'],
};
const naturalSpawnClass = new Set([
  'Chicken',
  'Cow',
  'Creeper',
  'Ghast',
  'Pig',
  'PigZombie',
  'Sheep',
  'Skeleton',
  'Slime',
  'Spider',
  'Squid',
  'Wolf',
  'Zombie',
]);
function inheritedMethods(chain, names) {
  const ownMethods = chain[0]?.methods ?? [];
  const result = [];
  for (const name of names) {
    if (ownMethods.some((candidate) => candidate.method === name)) continue;
    for (const ancestor of chain.slice(1)) {
      const inherited = ancestor.methods.filter((candidate) => candidate.method === name);
      if (!inherited.length) continue;
      result.push(...inherited);
      break;
    }
  }
  return result;
}
// Each string is deliberately a source-candidate target, not a frozen result. The corresponding
// methodCandidates field provides the line-level navigation needed to turn it into a runnable case.
const focus = new Map([
  ['Player', '玩家死亡、受伤与 NBT 读写的候选；玩家生成、碰撞尺寸、音效仍需独立 fixture。'],
  ['Item', '物品实体 tick、受伤销毁、玩家拾取与 NBT 的候选。'],
  ['Arrow', '箭矢发射/飞行/嵌入或拾取与 NBT 的候选；命中伤害为当前空槽 GAP。'],
  ['Boat', '船受伤破坏、载人 interact、水上 tick 运动与 NBT 的候选。'],
  ['Chicken', '鸡的 living tick、掉落项、声音和 NBT 的候选；产蛋计时数值需固定 RNG/tick fixture。'],
  ['Cow', '奶桶交互、掉落项、声音和 NBT 的候选。'],
  ['Creeper', '雷击带电、攻击倒计时、死亡掉落和 NBT 的候选。'],
  ['FallingSand', '下落方块 tick 与携带方块 id 的 NBT 候选；落地放置/掉落为当前 GAP。'],
  ['Ghast', '排除对象：仅保留生成判定、AI、掉落/声音导航，禁止纳入普通单人生存。'],
  ['Giant', '存档/资料对象：该直接类未定位行为方法；继承行为和可观察状态均为 GAP。'],
  ['Minecart', '普通矿车 rail tick、攻击破坏、骑乘交互与 NBT（type=0 需 fixture）候选。'],
  ['Mob', '存档/资料对象：生物基类的生成、受伤、死亡、AI、声音与 NBT 候选。'],
  ['Monster', '存档/资料对象：敌对生物基类的生成、攻击、受伤与 NBT 候选。'],
  ['Painting', '画的存活检查、移动/受伤移除及 motive/direction NBT 候选。'],
  ['Pig', '猪的骑乘交互、掉落与遭雷击转换候选。'],
  ['PigZombie', '僵尸猪人的生成、受伤激怒、living tick、掉落与 NBT 候选。'],
  ['PrimedTnt', '已点燃 TNT 的 tick/fuse 与 NBT 候选；爆炸半径、方块破坏和声音为 GAP。'],
  ['Sheep', '羊毛掉落/剪羊毛交互、声音和 NBT 颜色/剪毛状态候选。'],
  ['Skeleton', '骷髅 living tick、远程攻击、掉落与声音候选；保存方法当前 GAP。'],
  ['Slime', '史莱姆 tick、玩家碰撞伤害、掉落、声音和 Size NBT 候选；分裂数量需固定 RNG fixture。'],
  ['Snowball', '雪球发射/飞行、玩家碰撞与 NBT 候选；命中效果的状态 oracle 是 GAP。'],
  ['Spider', '蜘蛛攻击、掉落与声音候选；攀爬/骑手生成需独立方法或世界生成来源。'],
  ['Squid', '鱿鱼 water/living tick、交互、墨囊掉落、声音与 NBT 候选。'],
  ['Wolf', '狼 AI、受伤、攻击、喂骨驯服/坐下交互、声音和 NBT 候选。'],
  ['Zombie', '僵尸 daylight/living tick、掉落和声音候选；攻击与 NBT 当前 GAP。'],
  ['FishHook', '鱼钩发射/飞行/tick 与 NBT 候选；咬钩、拉回和战利品 RNG 为 GAP。'],
  ['Egg', '蛋发射/飞行、玩家碰撞和 NBT 候选；孵化 RNG/数量为 GAP。'],
  ['Lightning', '雷电 tick、目标影响与 NBT 候选；起火范围/实体传播需固定世界 fixture。'],
  ['MinecartChest', '箱矿车复用矿车 tick/交互/NBT 候选；库存及 type=1 的 owner/readback 为 GAP。'],
  ['MinecartFurnace', '炉矿车复用矿车 tick/交互/NBT 候选；fuel/push 向量及 type=2 的 owner/readback 为 GAP。'],
]);
const excluded = new Set(['Ghast']);
const stored = new Set(['Giant', 'Mob', 'Monster']);
const scope = (name) => (excluded.has(name) ? '排' : stored.has(name) ? '存' : '做');
const scopedParent = new Map(parentEntities.map((entry) => [entry.caseId, entry.scope]));

const records = expectedNames.map((name) => {
  const registration = registrations.get(name);
  const className = registration?.className ?? runtimeClass.get(name);
  const inheritance = ancestry(className);
  const allMethods = inheritance.chain[0]?.methods ?? [];
  const methodCandidates = Object.fromEntries(
    Object.entries(categories).map(([category, methods]) => [category, choose(allMethods, methods)]),
  );
  const inheritedMethodCandidates = Object.fromEntries(
    Object.entries(categories).map(([category, methods]) => [
      category,
      category === 'spawn' && !naturalSpawnClass.has(name) ? [] : inheritedMethods(inheritance.chain, methods),
    ]),
  );
  const lightningDerivationCandidates = choose(allMethods, ['onStruckByLightning']);
  const scopeStatus = scope(name);
  const catalogScope = scopedParent.get(`E-${name}`);
  if (!catalogScope) throw new Error(`Missing parent E-${name}`);
  return {
    caseId: `E-${name}`,
    name,
    className,
    inheritanceChain: inheritance.chain.map(({ className: owner }) => owner),
    scopeStatus,
    parentScope: catalogScope,
    registration: registration ?? {
      kind: 'runtime-derived',
      note: 'No named EntityList mapping: source file is a class-navigation candidate only, not a registration assertion.',
    },
    expectedCandidate: {
      identity: registration
        ? `EntityList numeric id ${registration.numericId} maps to ${className}`
        : `runtime-derived ${className}`,
      behaviorFocus: focus.get(name),
      spawn:
        'Use a fixed position/surface/light or explicit derivation input; no spawn rate, biome matrix, or source of acquisition is asserted.',
      aabbAndMotion:
        'Measure AABB, velocity and owner state over a fixed tick trace from the located constructor/update methods; no numeric result is frozen here.',
      aiAndInteraction:
        'Use a fixed player/target/item input and tick count; assert only an explicitly selected owner-state or event transition.',
      damageAndDrop:
        'Fix attacker, cause, world state and RNG before asserting emitted items, entities, health or removal.',
      soundAndAnimation:
        'Assert event key/timing separately from audiovisual asset fidelity; copyrighted asset matching is out of this source audit.',
      saveAndLoad:
        'Round-trip only fields demonstrated through a located NBT read/write method and a deterministic readback fixture.',
    },
    methodCandidates,
    inheritedMethodCandidates,
    lightningDerivationCandidates,
    sources: [
      ...(registration ? [registration.source] : []),
      ...Object.values(methodCandidates).flat(),
      ...Object.values(inheritedMethodCandidates).flat(),
      ...lightningDerivationCandidates,
    ],
    gaps: [
      ...(inheritance.error ? [inheritance.error] : []),
      'Fixed reconstructed-source candidate is not proof of equivalence to the original b1.7.3 jar.',
      'Inherited base methods may be no-op/default and do not prove natural spawn, sound emission, drop, or save behavior.',
      'No fixed RNG/tick trace, expected owner-state oracle, negative execution, sound/animation capture, or NBT readback evidence.',
    ],
    fixture: {
      positive:
        scopeStatus === '做'
          ? 'Create one legal spawn/derivation fixture; apply one normal interaction, tick, damage, or save/load path and assert exact selected owner state/event.'
          : 'Identity/source navigation fixture only; do not elevate an excluded or stored survival path into ordinary gameplay.',
      negative:
        scopeStatus === '排'
          ? 'Attempt excluded spawn/interaction and assert that the product boundary does not expose it.'
          : scopeStatus === '存'
            ? 'Attempt ordinary survival acquisition/spawn and assert no silent inclusion.'
            : 'Use invalid surface/light, target, attacker, item, or save payload; assert no forbidden owner-state mutation.',
    },
    confidence: inheritance.error
      ? 'low: registration/runtime mapping only; class source unavailable'
      : 'medium: fixed reconstructed-source method candidates; no behavior executed',
  };
});

if (records.length !== 30 || new Set(records.map(({ caseId }) => caseId)).size !== 30)
  throw new Error('Entity coverage failure');
await writeFile(
  join(root, 'entity-behavior-candidates.json'),
  `${JSON.stringify(
    {
      schemaVersion: 2,
      referenceCaseSetVersion: catalog.referenceCaseSetVersion,
      sourceCommit: commit,
      records,
    },
    null,
    2,
  )}\n`,
);
const summary = records.reduce(
  (acc, record) => {
    for (const [category, candidates] of Object.entries(record.methodCandidates)) {
      if (candidates.length) acc.locatedSlots += 1;
      else {
        acc.gapSlots += 1;
        if (record.inheritedMethodCandidates[category].length) acc.inheritedOnlySlots += 1;
        else acc.noLocatedMethodSlots += 1;
      }
    }
    if (record.confidence.startsWith('low')) acc.lowConfidence += 1;
    return acc;
  },
  { locatedSlots: 0, gapSlots: 0, inheritedOnlySlots: 0, noLocatedMethodSlots: 0, lowConfidence: 0 },
);
console.log(
  JSON.stringify({
    records: records.length,
    classes: classNames.length,
    byScope: Object.fromEntries(
      Object.entries(Object.groupBy(records, ({ scopeStatus }) => scopeStatus)).map(([key, value]) => [
        key,
        value.length,
      ]),
    ),
    ...summary,
  }),
);
