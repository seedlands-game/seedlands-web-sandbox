import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const parentBlocks = new Map(
  catalog.cases.filter((entry) => entry.kind === 'block').map((entry) => [entry.caseId, entry]),
);
if (parentBlocks.size !== 97) throw new Error('Block parent denominator drift');
const commit = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const rawBase = `https://raw.githubusercontent.com/jacobo-mc/mc_b1.7.3_release/${commit}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const blobBase = `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${commit}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const scopeFor = (id) => {
  const scope = parentBlocks.get(`B-${String(id).padStart(3, '0')}`)?.scope;
  if (!scope) throw new Error(`Missing block parent ${id}`);
  return scope;
};

async function get(file) {
  const response = await fetch(`${rawBase}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

function methods(text, file) {
  const result = [];
  for (const [index, line] of text.split('\n').entries()) {
    const match = line.match(/^\s*(?:public|protected|private)\s+(?:static\s+)?\S+\s+(\w+)\s*\(/);
    if (match) result.push({ file, line: index + 1, method: match[1] });
  }
  return result;
}

function source(file, line, method = null) {
  return { uri: `${blobBase}/${file}#L${line}`, file, line, ...(method ? { method } : {}) };
}

const block = await get('Block.java');
const registrations = new Map();
for (const [index, line] of block.split('\n').entries()) {
  const match = line.match(/^\s*(\w+)\s*=.*?new (Block\w*)\((\d+)(?:,|\))/);
  if (!match) continue;
  const id = Number(match[3]);
  if (id < 1 || id > 96) continue;
  const value = (name) => line.match(new RegExp(`\\.${name}\\((-?[\\d.]+)F?\\)`))?.[1] ?? null;
  registrations.set(id, {
    id,
    field: match[1],
    className: match[2],
    source: source('Block.java', index + 1, 'static initializer'),
    static: {
      hardness: value('setHardness') === null ? null : Number(value('setHardness')),
      lightLevel: value('setLightValue') === null ? null : Math.trunc(Number(value('setLightValue')) * 15),
      lightOpacity: value('setLightOpacity') === null ? null : Number(value('setLightOpacity')),
      resistanceArgument: value('setResistance') === null ? null : Number(value('setResistance')),
      stepSound: line.match(/\.setStepSound\((\w+)\)/)?.[1] ?? null,
      unbreakable: line.includes('.setBlockUnbreakable()'),
    },
  });
}
registrations.set(0, { id: 0, field: 'air', className: null, source: null, static: {} });
registrations.set(35, {
  id: 35,
  field: 'cloth',
  className: 'BlockCloth',
  source: source(
    'Block.java',
    block.indexOf('cloth =') < 0 ? 0 : block.slice(0, block.indexOf('cloth =')).split('\n').length,
    'static initializer',
  ),
  static: {
    hardness: 0.8,
    lightLevel: null,
    lightOpacity: null,
    resistanceArgument: null,
    stepSound: 'soundClothFootstep',
    unbreakable: false,
  },
});
if (registrations.size !== 97) throw new Error(`Expected 97 IDs, found ${registrations.size}`);

const classNames = [...new Set([...registrations.values()].map(({ className }) => className).filter(Boolean))];
const classSources = new Map();
classSources.set('Block', { parent: null, methods: methods(block, 'Block.java') });
async function loadClass(className) {
  if (classSources.has(className)) return classSources.get(className);
  const file = `${className}.java`;
  try {
    const text = await get(file);
    const declaration = text.match(/\bclass\s+(\w+)\s+extends\s+(\w+)/);
    if (!declaration || declaration[1] !== className) throw new Error(`${file}: class declaration or parent not found`);
    const result = { parent: declaration[2], methods: methods(text, file) };
    classSources.set(className, result);
    if (result.parent !== 'Block') await loadClass(result.parent);
  } catch (error) {
    // A failed class read remains an explicit source gap in every affected ID.
    classSources.set(className, { error: String(error) });
  }
  return classSources.get(className);
}
for (const className of classNames) await loadClass(className);

function inheritanceChain(className) {
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
  placement: [
    'canPlaceBlockAt',
    'canBlockStay',
    'onBlockPlaced',
    'onBlockAdded',
    'onNeighborBlockChange',
    'blockActivated',
    'onBlockClicked',
  ],
  breakingAndDrop: ['idDropped', 'quantityDropped', 'damageDropped', 'dropBlockAsItemWithChance', 'harvestBlock'],
  collisionAndShape: [
    'getCollisionBoundingBoxFromPool',
    'setBlockBoundsBasedOnState',
    'setBlockBoundsForItemRender',
    'isOpaqueCube',
    'renderAsNormalBlock',
  ],
  tickAndInteraction: ['updateTick', 'randomDisplayTick', 'onEntityWalking', 'onEntityCollidedWithBlock'],
  tileEntity: ['getBlockEntity', 'createNewTileEntity', 'hasTileEntity'],
};
function resolveMethods(chain, names) {
  const resolved = [];
  for (const methodName of names) {
    for (const owner of chain) {
      const candidates = owner.methods.filter(({ method }) => method === methodName);
      if (candidates.length) {
        resolved.push(...candidates.map(({ file, line, method }) => source(file, line, method)));
        break;
      }
    }
  }
  return resolved;
}

const records = [...registrations.values()]
  .sort((a, b) => a.id - b.id)
  .map((registration) => {
    if (registration.id === 0) {
      return {
        caseId: 'B-000',
        id: 0,
        className: null,
        scopeStatus: '做',
        expectedCandidate: {
          identity: 'air / empty voxel',
          placement: 'not a placeable block item',
          collisionAndShape: 'empty collision candidate',
        },
        sources: [],
        gaps: ['Air behavior requires world storage/selection fixture; no Block.java registration line.'],
        fixture: {
          positive: 'empty voxel is non-colliding and replaceable',
          negative: 'placing into non-empty voxel must not silently erase owner state',
        },
        confidence: 'medium: static architecture candidate only',
      };
    }
    const inheritance = inheritanceChain(registration.className);
    const behavior = Object.fromEntries(
      Object.entries(categories).map(([category, names]) => {
        return [category, resolveMethods(inheritance.chain, names)];
      }),
    );
    const sourceGap = inheritance.error ? [inheritance.error] : [];
    return {
      caseId: `B-${String(registration.id).padStart(3, '0')}`,
      id: registration.id,
      field: registration.field,
      className: registration.className,
      scopeStatus: scopeFor(registration.id),
      inheritanceChain: inheritance.chain.map(({ className }) => className),
      expectedCandidate: {
        identity: `registered ${registration.className} at ID ${registration.id}`,
        static: registration.static,
        placement:
          'execute the located placement/neighbor/activation methods with a fixed face and support fixture; no result is frozen here',
        breakingAndDrop:
          'execute the located drop hooks with fixed tool, metadata and RNG; base fallback is not proof an override is absent',
        collisionAndShape:
          'measure AABB/opaque/render predicates from the located methods; no full-cube assumption is made',
        light:
          registration.static.lightLevel === null
            ? 'no explicit Block.java light value; inheritance/renderer behavior remains open'
            : `explicit registration light level ${registration.static.lightLevel}`,
        metadata: 'raw metadata domain and valid transitions require the class method plus a fixed-world fixture',
        tileEntityAndSave:
          'a located TileEntity factory is only a navigation candidate; NBT fields and save/resume remain unverified',
      },
      sources: [registration.source, ...Object.values(behavior).flat()],
      methodCandidates: behavior,
      gaps: [
        ...sourceGap,
        'No official-jar equivalence proof for reconstructed source.',
        'No fixed seed/RNG/input trace, expected owner state, negative control, or save/resume execution evidence.',
      ],
      fixture: {
        positive:
          scopeFor(registration.id) === '做'
            ? 'fixed empty/support world; perform the normal placement or interaction path selected above and assert exact block/metadata/tile/entity owner state'
            : 'fixed controlled world; assert registry/source identity only and do not elevate it to an included survival behavior',
        negative:
          scopeFor(registration.id) === '排'
            ? 'attempt ordinary acquisition, placement, or excluded mechanism trigger; assert the product boundary does not expose excluded gameplay'
            : scopeFor(registration.id) === '存'
              ? 'attempt ordinary survival acquisition; assert no ordinary source is silently introduced'
              : 'repeat with invalid support, blocked target, wrong tool, or invalid metadata; assert no forbidden mutation',
      },
      confidence: inheritance.error
        ? 'low: registration only; subclass source unavailable'
        : 'medium: fixed reconstructed-source method candidate; behavior not executed',
    };
  });

await writeFile(
  join(root, 'block-behavior-candidates.json'),
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
    for (const sources of Object.values(record.methodCandidates ?? {})) {
      if (sources.length) acc.methodLocated += 1;
      else acc.methodGap += 1;
    }
    if (record.confidence.startsWith('low')) acc.lowConfidence += 1;
    return acc;
  },
  { methodLocated: 0, methodGap: 0, lowConfidence: 0 },
);
console.log(JSON.stringify({ records: records.length, classNames: classNames.length, ...summary }));
