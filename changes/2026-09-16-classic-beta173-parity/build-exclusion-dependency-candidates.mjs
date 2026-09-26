import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = dirname(fileURLToPath(import.meta.url));
const writeFormatted = async (name, body) => {
  const path = join(root, name);
  const config = await resolveConfig(path);
  await writeFile(path, await format(body, { ...config, filepath: path }));
};
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const byId = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
const excluded = catalog.cases.filter((entry) => entry.scope === '排');
const netherIds = new Set(['B-087', 'B-088', 'B-089', 'B-090', 'I-348', 'E-Ghast', 'R-D10']);
const internalDependencies = {
  'B-034': ['B-029', 'B-033'],
  'B-036': ['B-029', 'B-033'],
  'B-071': ['I-330'],
  'B-075': ['B-076'],
  'B-093': ['I-356'],
  'B-094': ['I-356'],
  'I-348': ['B-089'],
};
const retainedBoundaries = {
  'B-023': ['B-054'],
  'B-027': ['B-066', 'E-Minecart'],
  'B-028': ['B-066', 'E-Minecart'],
  'B-055': ['I-331', 'B-073', 'B-074', 'B-025', 'R-D05', 'R-D48', 'R-D49'],
  'B-071': ['B-064'],
  'I-330': ['B-064'],
  'B-075': ['B-050'],
  'B-076': ['B-050'],
  'B-090': ['B-049', 'B-051', 'I-259'],
  'E-Ghast': ['E-PigZombie'],
};
const kindOf = (entry) => {
  if (entry.kind === 'crafting') return 'DISABLED_CRAFTING_OUTPUT';
  if (entry.caseId === 'B-055') return 'RETAINED_MATERIAL_PLACEMENT_DISABLED';
  if (entry.caseId === 'B-090') return 'PORTAL_CREATION_DISABLED';
  if (netherIds.has(entry.caseId)) return 'OTHER_DIMENSION_INACCESSIBLE';
  if (['B-034', 'B-036', 'B-075', 'B-093', 'B-094'].includes(entry.caseId)) return 'INTERNAL_EXCLUDED_STATE';
  return 'EXCLUDED_PRODUCT_UNOBTAINABLE';
};
const block = (id) => `B-${String(id).padStart(3, '0')}`;
const productCaseId = (entry) => {
  const id = entry.expected?.output?.id;
  if (!Number.isInteger(id)) return null;
  return id < 256 ? block(id) : `I-${id}`;
};
const recipesByProduct = new Map();
for (const entry of excluded.filter((candidate) => candidate.kind === 'crafting')) {
  const product = productCaseId(entry);
  if (!product || byId.get(product)?.scope !== '排')
    throw new Error(`excluded recipe has non-excluded product: ${entry.caseId}`);
  recipesByProduct.set(product, [...(recipesByProduct.get(product) ?? []), entry.caseId]);
}
const negativeFor = (entry, pathKind) => {
  if (pathKind === 'DISABLED_CRAFTING_OUTPUT')
    return {
      setup: '同版本普通生存背包和已登记的精确配方输入；逐格形状、数量与元数据待固定。',
      trigger: '在允许的 2×2 或 3×3 网格摆出该被排配方并尝试取产物。',
      expectedUnreachable: `不得取得 ${entry.caseId} 的被排产物，且材料不得因虚构输出而消耗；还须排除命中其他保留配方。`,
    };
  if (pathKind === 'RETAINED_MATERIAL_PLACEMENT_DISABLED')
    return {
      setup: '普通生存取得红石粉 I-331，在允许放置的地面上持有该物品。',
      trigger: '右键尝试铺设红石线。',
      expectedUnreachable: '不生成 B-055，不消耗 I-331；其非电路配方用途保持可用。',
    };
  if (pathKind === 'PORTAL_CREATION_DISABLED')
    return {
      setup: '用保留的黑曜石 B-049、打火石 I-259 和火 B-051 建立完整主世界框架。',
      trigger: '点燃框架并观察方块及维度入口。',
      expectedUnreachable: '不生成 B-090，也不能进入另一维度；普通可燃目标仍可被点燃。',
    };
  if (pathKind === 'OTHER_DIMENSION_INACCESSIBLE')
    return {
      setup: '新建仅有主世界的普通单人生存世界，禁止命令、创意背包或导入修改存档。',
      trigger: '遍历合法生成、掉落、合成和交易路径；具体有限路径集待审核。',
      expectedUnreachable: `不得取得或自然生成 ${entry.caseId}；保留的主世界派生态不能误删。`,
    };
  return {
    setup: '新建普通单人生存世界，保留可用的非电路输入材料；具体初态待固定。',
    trigger: '尝试原版直接合成、放置、掉落或内部状态转移中的相应路径。',
    expectedUnreachable: `不得得到 ${entry.caseId} 的被排方块/物品/状态。`,
  };
};

const cases = excluded.map((entry) => {
  const pathKind = kindOf(entry);
  const outputCaseId = entry.kind === 'crafting' ? productCaseId(entry) : null;
  const boundaries =
    retainedBoundaries[entry.caseId] ??
    (outputCaseId ? retainedBoundaries[outputCaseId] : null) ??
    (netherIds.has(entry.caseId) ? ['B-049', 'B-051', 'I-259', 'E-PigZombie'] : ['I-331']);
  const dependencyCaseIds = internalDependencies[entry.caseId] ?? [];
  const producerRecipeIds = recipesByProduct.get(entry.caseId) ?? [];
  for (const id of [
    ...boundaries,
    ...dependencyCaseIds,
    ...producerRecipeIds,
    ...(outputCaseId ? [outputCaseId] : []),
  ]) {
    if (!byId.has(id)) throw new Error(`unknown exclusion dependency ${entry.caseId} -> ${id}`);
  }
  for (const id of boundaries)
    if (byId.get(id)?.scope !== '做') throw new Error(`retained boundary not included: ${id}`);
  for (const id of [...dependencyCaseIds, ...producerRecipeIds, ...(outputCaseId ? [outputCaseId] : [])])
    if (byId.get(id)?.scope !== '排') throw new Error(`excluded dependency not excluded: ${id}`);
  return {
    caseId: entry.caseId,
    kind: entry.kind,
    candidateStatus: 'EXCLUSION_DEPENDENCY_CANDIDATE_NOT_APPROVED',
    decisionCause: netherIds.has(entry.caseId) ? 'OTHER_DIMENSIONS' : 'REDSTONE_CIRCUITS',
    pathKind,
    reason: '本项目明确排除该功能或其依赖链；不宣称原版没有此身份或行为。',
    closure: { outputCaseId, producerRecipeIds, dependencyCaseIds, retainedBoundaryCaseIds: boundaries },
    ordinarySurvivalNegative: negativeFor(entry, pathKind),
    positiveControl: `至少验证 ${boundaries.join('、')} 的被保留玩法不受本排除影响；具体输入/输出待固定。`,
    sourceLinks: [
      'spec.md#排除依赖的默认裁决供整份合同审核',
      ...entry.evidence
        .filter((source) => source.uri?.startsWith('https://'))
        .slice(0, 2)
        .map((source) => source.uri),
    ],
    unresolved: '逐案来源/依赖闭包、有限取得路径、夹具与用户范围裁决尚未审核；不得升为 REFERENCE_READY。',
  };
});
if (cases.length !== 38) throw new Error(`excluded denominator drift: ${cases.length}`);
const output = {
  schemaVersion: 1,
  referenceCaseSetVersion: catalog.referenceCaseSetVersion,
  sourceCaseCount: catalog.cases.length,
  caseCount: cases.length,
  status: 'CANDIDATE_ONLY_NOT_APPROVED',
  cases,
};
await writeFormatted('exclusion-dependency-candidates.json', `${JSON.stringify(output, null, 2)}\n`);
const table = [
  `# Classic 排除项依赖闭包与普通生存负例候选（v${catalog.referenceCaseSetVersion}）`,
  '',
  '本表覆盖当前 38 个 `排` 父项；逐案 setup/trigger/expected 与来源见 [机器可读候选](exclusion-dependency-candidates.json)。这是**范围偏离的候选设计**，不是原版行为不存在、来源等价或开工批准。31 项属红石电路边界，7 项属其他维度边界；保留材料/玩法必须另验。',
  '',
  '| case | 排除原因 | 阻断路径 | 被排依赖/产物 | 必须存活的保留项 |',
  '| --- | --- | --- | --- | --- |',
  ...cases.map((entry) => {
    const closure = entry.closure;
    const excludedLinks = [closure.outputCaseId, ...closure.producerRecipeIds, ...closure.dependencyCaseIds].filter(
      Boolean,
    );
    return `| ${entry.caseId} | ${entry.decisionCause} | ${entry.pathKind} | ${excludedLinks.join('、') || '项目直接排除'} | ${closure.retainedBoundaryCaseIds.join('、')} |`;
  }),
  '',
  '特别边界：`I-331` 红石粉保留为音符盒、指南针、时钟和地图材料，但不得铺设 `B-055`；`B-049` 黑曜石、`B-051` 火、`I-259` 打火石仍可普通使用，完整框架点火不生成 `B-090`。发射器的手动容器、红石火把照明、动力/探测轨被动形态也随主电路功能整体排除，仍待用户在全合同审核门确认。',
  '',
  '每项仍缺：独立来源裁决、穷尽的可取得路径、精确 seed/初态/tick 输入/负控、保留项正控和 reviewer。生成器与校验器只能保证这 38 个 ID 的图边存在及范围分类自洽；不能证明游戏里确实不可达。',
  '',
];
await writeFormatted('exclusion-dependency-audit.md', `${table.join('\n')}\n`);
console.log(JSON.stringify({ caseCount: cases.length, status: output.status }));
