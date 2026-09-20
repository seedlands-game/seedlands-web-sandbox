#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { mergeWorldMechanismCandidates } from './mechanism-world-merge.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const path = join(root, 'reference-cases.json');
const parent = JSON.parse(await readFile(path, 'utf8'));
const catalog = JSON.parse(await readFile(join(root, 'mechanism-world-candidates.json'), 'utf8'));
mergeWorldMechanismCandidates(parent.cases, catalog);
const body = await format(JSON.stringify(parent), { ...(await resolveConfig(path)), filepath: path });
await writeFile(path, body);
const auditPath = join(root, 'mechanism-acceptance-audit.md');
const candidates = new Map(catalog.cases.map((entry) => [entry.caseId, entry]));
let replaced = 0;
const markdown = (await readFile(auditPath, 'utf8')).replace(
  /^\| (M(?:0[2-9]|1[0-3])-\d\d) \|.*$/gm,
  (line, caseId) => {
    const candidate = candidates.get(caseId);
    if (!candidate) throw new Error(`missing acceptance candidate ${caseId}`);
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 8) throw new Error(`invalid acceptance row ${caseId}`);
    replaced++;
    cells[1] = candidate.behavior;
    cells[2] = `${candidate.fixture.initialState}；${candidate.fixture.trigger}`;
    cells[3] = candidate.candidateExpected;
    cells[4] = candidate.sourceLocations.join('、');
    cells[5] = candidate.negativeControl;
    cells[7] = candidate.saveResumeDependency;
    return `| ${cells.join(' | ')} |`;
  },
);
if (replaced !== catalog.cases.length) throw new Error(`acceptance sync denominator: ${replaced}`);
await writeFile(auditPath, await format(markdown, { ...(await resolveConfig(auditPath)), filepath: auditPath }));
console.log(JSON.stringify({ synchronizedWorldMechanisms: catalog.cases.length, status: 'CANDIDATE_ONLY' }));
