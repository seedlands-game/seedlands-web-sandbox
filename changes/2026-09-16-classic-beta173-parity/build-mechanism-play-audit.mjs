import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'mechanism-play-candidates.json'), 'utf8'));
const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const rows = catalog.cases.map((entry) =>
  [entry.caseId, entry.classification, entry.candidateExpected, entry.sourceLocations.join(', '), entry.gap]
    .map(escapeCell)
    .join(' | '),
);
const markdown = [
  '# M14–M36 玩法与项目合同候选审计',
  '',
  `覆盖 ${catalog.caseCount}/${catalog.caseCount} 项：${catalog.classificationCounts.RECONSTRUCTED_SOURCE_CANDIDATE} 项固定重构源码的局部玩法候选、${catalog.classificationCounts.PROJECT_CONTRACT_CANDIDATE} 项项目合同候选；另 3 项项目条款属于范围外 M01，未挪入凑数。两类均未执行、未固定夹具、未获 owner 审核，项目合同绝不冒充 b1.7.3 行为。`,
  '',
  '67 条源码候选的方法/行级复核、矛盾和未解项见 [固定源码逐项复核](mechanism-play-source-review.md)。表中的文件名只是候选 owner，不代替逐字段 expected 的来源映射。',
  '',
  '| ID | 分级 | 局部候选期望 | 可复核定位 | 精确缺口 |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((row) => `| ${row} |`),
  '',
].join('\n');
const output = join(root, 'mechanism-play-audit.md');
const config = await resolveConfig(output);
await writeFile(output, await format(markdown, { ...config, filepath: output }));
