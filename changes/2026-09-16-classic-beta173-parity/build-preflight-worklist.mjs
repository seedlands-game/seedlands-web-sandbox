import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const variants = JSON.parse(await readFile(join(root, 'variant-cases.json'), 'utf8'));
if (variants.referenceCaseSetVersion !== catalog.referenceCaseSetVersion) throw new Error('Reference version drift');
const gaps = catalog.cases.filter((entry) => ['REFERENCE_GAP', 'PROJECT_CONTRACT_GAP'].includes(entry.referenceStatus));
const projectGaps = gaps.filter((entry) => entry.referenceStatus === 'PROJECT_CONTRACT_GAP').length;
const projectCandidates = catalog.cases.filter(
  (entry) => entry.referenceStatus === 'PROJECT_CONTRACT_CANDIDATE_REVIEW',
);
const worklist = [...gaps, ...projectCandidates];
const partial = catalog.cases.filter((entry) => entry.referenceStatus === 'PARTIAL_REFERENCE_GAP').length;
const candidates = catalog.cases.filter((entry) => entry.referenceStatus === 'SOURCE_CANDIDATE_REVIEW').length;
const escapeCell = (value) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = [
  `# Classic b1.7.3 逐项补证队列（v${catalog.referenceCaseSetVersion}）`,
  '',
  `本表从 [${catalog.cases.length} 行父总账](reference-cases.json)确定性生成：没有绑定 expected 的 ${gaps.length} 项（其中项目合同空白 ${projectGaps} 项）；另列 ${projectCandidates.length} 项**已写候选、仍待审核**的项目治理/性能/原创体验合同。其余 ${partial} 项仍仅有局部原版事实、${candidates} 项仍是待复核配方候选；[${variants.cases.length} 变体与 ${variants.openEndedFamilies.length} 开放状态族](variant-cases.json)另行审核。所有 ${catalog.cases.length + variants.cases.length} 行均没有完整固定夹具。来源位置只供审查，不是已经证实的预期值。`,
  '',
  '处理每行时：静态核对固定版本的具体方法和边界 → 明确初态、RNG、tick 输入、逐字段期望和反例 → 记录可定位出处/来源等级与冲突裁决 → owner 审查；没有独立证据就继续保留缺口。视觉/音频需合法的同期画面/录音参照和用户指定评审者，不复制原版资产进产品。',
  '',
  '| ID | 待锁定的行为 | 首选查证位置 | 最低交付 |',
  '| --- | --- | --- | --- |',
];
for (const entry of worklist) {
  const governance = ['PROJECT_CONTRACT_GAP', 'PROJECT_CONTRACT_CANDIDATE_REVIEW'].includes(entry.referenceStatus);
  const experience = /^M(?:30|32)-/.test(entry.caseId);
  const location = governance
    ? (entry.evidence?.[0]?.uri ?? '项目 Harness/原创体验/治理合同（非原版玩法 oracle）')
    : entry.sourceCandidates?.length
      ? entry.sourceCandidates.map((url) => `[${url.split('/').at(-1)}](${url})`).join('、')
      : '同期体验证据（暂无源码候选）';
  const delivery =
    entry.referenceStatus === 'PROJECT_CONTRACT_CANDIDATE_REVIEW'
      ? '审核项目 expected 与定向负例，固定夹具/设备或人工签署；仍非原版玩法 oracle'
      : experience
        ? '原创资产的事件/画面/音频、人审量表和拒绝线；不复用原版素材'
        : governance
          ? '确定性门禁/设备、证据身份或人工审核条款与可触发失败的反例'
          : /^M(?:28|29|30|31|32)-/.test(entry.caseId)
            ? '事件/画面/音频及人工评审量表；若涉及行为再补逐 tick 状态'
            : '正例、边界反例、明确 tick/RNG/权威状态或事件 expected';
  lines.push(`| ${entry.caseId} | ${escapeCell(entry.action)} | ${location} | ${delivery} |`);
}
lines.push(
  '',
  `所有 ${catalog.cases.length} 行的逐项 \`unresolved\`、证据链接、审查和夹具状态以 JSON 为准；本文件不把候选当黄金事实。`,
  '',
);
await writeFile(join(root, 'reference-worklist.md'), `${lines.join('\n')}\n`);
console.log(JSON.stringify({ unboundExpected: gaps.length, projectCandidates: projectCandidates.length }));
