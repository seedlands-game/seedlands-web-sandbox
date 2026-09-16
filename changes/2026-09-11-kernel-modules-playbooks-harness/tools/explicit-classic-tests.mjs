import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { relative, resolve, dirname } from 'node:path';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../../..');
const list = (dir) =>
  readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
const sourceNames = new Map([
  ['inventory', new Set(['Inventory'])],
  ['entity-store', new Set(['EntityStore'])],
  ['player-state', new Set(['PlayerState'])],
  [
    'item-registry',
    new Set(['getItemDefinition', 'getItemCapability', 'listItemDefinitions', 'defaultItemDefinitionRegistry']),
  ],
  [
    'recipe-registry',
    new Set(['getRecipe', 'listRecipes', 'craftRecipe', 'listCraftableRecipes', 'defaultRecipeRegistry']),
  ],
  ['voxel-gameplay', new Set(['getVoxelGameplayDefinition', 'listVoxelGameplayDefinitions'])],
  ['combat-runtime', new Set(['CombatRuntime', 'getMeleeDefinition', 'listMeleeDefinitions'])],
  ['gameplay-runtime', new Set(['GameplayRuntime'])],
  ['game-server', new Set(['GameServer'])],
]);
const classicRuntimeFiles = new Set([
  'actor-components-integration.test.ts',
  'authority-actor-rules.test.ts',
  'authority-entity-lifetime.test.ts',
  'authority-game-server-port.test.ts',
  'combat-durable-origin.test.ts',
  'combat-identity-restore.test.ts',
  'combat-lethal-recovery.test.ts',
  'combat-result-exhaustion.test.ts',
  'developer-tool-give-command.test.ts',
  'ecs-entity-owner.test.ts',
  'fluid-interactive-priority.test.ts',
  'game-save-persistence.test.ts',
  'gameplay-action-identity.test.ts',
  'gameplay-atomic-inventory.test.ts',
  'gameplay-atomic-vitals.test.ts',
  'gameplay-command-persistence.test.ts',
  'gameplay-content-consumers.test.ts',
  'gameplay-content-integration.test.ts',
  'gameplay-unknown-chunk.test.ts',
  'prepared-combat-frontier.test.ts',
  'prepared-combat-request.test.ts',
  'prepared-world-edit.test.ts',
  'simulation-command-persistence.test.ts',
  'survival-gameplay.test.ts',
]);
const mapPath = resolve(root, 'changes/2026-09-11-kernel-modules-playbooks-harness/explicit-classic-test-map.json');
const prior = JSON.parse(readFileSync(mapPath, 'utf8'));
const changed = new Set(prior.files ?? []);
for (const path of [
  ...list('packages/stdlib/tests'),
  ...list('apps/web/tests/unit'),
  ...list('apps/web/tests/integration/runtime'),
]) {
  if (!path.endsWith('.ts') || path.includes('/composition/')) continue;
  let text = readFileSync(resolve(root, path), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  for (const node of source.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.importClause?.namedBindings ||
      !ts.isNamedImports(node.importClause.namedBindings)
    )
      continue;
    const name = node.moduleSpecifier.text.split('/').at(-1);
    const candidates = sourceNames.get(name);
    if (!candidates) continue;
    const elements = node.importClause.namedBindings.elements;
    const selected = elements.filter(
      (e) =>
        !e.isTypeOnly &&
        candidates.has(e.propertyName?.text ?? e.name.text) &&
        (!['CombatRuntime', 'getMeleeDefinition', 'listMeleeDefinitions', 'GameplayRuntime', 'GameServer'].includes(
          e.propertyName?.text ?? e.name.text,
        ) ||
          classicRuntimeFiles.has(path.split('/').at(-1))),
    );
    if (!selected.length) continue;
    const retained = elements.filter((e) => !selected.includes(e));
    let target = relative(dirname(path), 'apps/web/tests/fixtures/classic/content').replaceAll('\\', '/');
    if (!target.startsWith('.')) target = `./${target}`;
    const replacement =
      (retained.length
        ? `import { ${retained.map((e) => e.getText(source)).join(', ')} } from '${node.moduleSpecifier.text}';\n`
        : '') + `import { ${selected.map((e) => e.getText(source)).join(', ')} } from '${target}';`;
    edits.push({ start: node.getStart(source), end: node.getEnd(), replacement });
  }
  if (edits.length) {
    for (const e of edits.reverse()) text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
    writeFileSync(resolve(root, path), text);
    changed.add(path);
  }
}
writeFileSync(
  mapPath,
  JSON.stringify(
    {
      reason:
        'Frozen base tests using former implicit content now choose the explicit Classic fixture; no assertion changed.',
      files: [...changed].sort(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Explicit Classic fixtures in ${changed.size} tests.`);
