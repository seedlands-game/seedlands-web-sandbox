import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { mergeMechanismSourceReview, parseMechanismSourceReview } from './mechanism-review-merge.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = async (name) => JSON.parse(await readFile(join(root, name), 'utf8'));
const [catalog, candidates, reviewText, auditText] = await Promise.all([
  readJson('reference-cases.json'),
  readJson('mechanism-play-candidates.json'),
  readFile(join(root, 'mechanism-play-source-review.md'), 'utf8'),
  readFile(join(root, 'mechanism-acceptance-audit.md'), 'utf8'),
]);
const reviews = parseMechanismSourceReview(reviewText);
mergeMechanismSourceReview(catalog.cases, candidates, reviews);
const byId = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
const candidateById = new Map(candidates.cases.map((entry) => [entry.caseId, entry]));
const updatedAudit = auditText
  .split('\n')
  .map((line) => {
    if (!/^\| M\d\d-\d\d \|/.test(line)) return line;
    const cells = line.split('|').slice(1, -1);
    const caseId = cells[0].trim();
    if (!reviews.has(caseId)) return line;
    if (cells.length !== 8) throw new Error(`invalid mechanism audit row ${caseId}`);
    cells[3] = ` ${byId.get(caseId).expected.sourcedPartialExpected} `;
    cells[4] = ` ${candidateById.get(caseId).sourceLocations.join('、')} `;
    return `|${cells.join('|')}|`;
  })
  .join('\n');
const writeFormatted = async (name, body) => {
  const path = join(root, name);
  const config = await resolveConfig(path);
  await writeFile(path, await format(body, { ...config, filepath: path }));
};
await writeFormatted('reference-cases.json', `${JSON.stringify(catalog, null, 2)}\n`);
await writeFormatted('mechanism-acceptance-audit.md', updatedAudit);
console.log(JSON.stringify({ synced: reviews.size, status: 'STATIC_CANDIDATES_NOT_APPROVED' }));
