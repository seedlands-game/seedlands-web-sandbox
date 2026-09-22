import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('apps/web/public/models/classic/manifest.json', root), 'utf8'));
const names = {
  pig: '猪',
  cow: '牛',
  sheep: '羊',
  chicken: '鸡',
  squid: '鱿鱼',
  wolf: '狼',
  zombie: '僵尸',
  skeleton: '骷髅',
  spider: '蜘蛛',
  creeper: '爬行者',
  slime: '史莱姆',
  'pig-zombie': '僵尸猪人',
};
const definitions = manifest.models.map(({ kind, byteLength, nodeCount, triangleCount, height }) => ({
  kind,
  name: names[kind],
  modelId: `seedlands:model/actor/${kind}`,
  path: `models/classic/${kind}.glb`,
  byteLength,
  nodeCount,
  triangleCount,
  height,
  clips: { idle: 'idle', move: 'move', attack: 'attack', hurt: 'hurt' },
}));
if (definitions.length !== 12 || definitions.some((d) => !d.name)) throw new Error('Expected all 12 Classic creatures');
await writeFile(
  new URL('apps/web/src/client/presentation/classic-creature-definitions.ts', root),
  `// Generated from the original Blender recipe manifest by scripts/assets/classic-creatures/sync-metadata.mjs.\nexport const classicCreatureKinds = ${JSON.stringify(definitions.map((d) => d.kind))} as const;\nexport type ClassicCreatureKind = (typeof classicCreatureKinds)[number];\nexport const classicCreatureDefinitions = ${JSON.stringify(definitions, null, 2)} as const;\nexport function classicCreatureDefinition(kindOrModelId: string) {\n  return classicCreatureDefinitions.find(definition => definition.kind === kindOrModelId || definition.modelId === kindOrModelId);\n}\n`,
);
