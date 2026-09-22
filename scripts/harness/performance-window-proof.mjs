import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const windowIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export const measurementDigest = (record) => createHash('sha256').update(JSON.stringify(record)).digest('hex');

export function performanceWindowContext(environment = process.env) {
  const windowId = environment.SEEDLANDS_PERFORMANCE_WINDOW_ID;
  const evidencePath = environment.SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE;
  const declarationPath = environment.SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION;
  if (
    environment.SEEDLANDS_PERFORMANCE_WINDOW_RESERVED !== '1' ||
    !windowIdPattern.test(windowId ?? '') ||
    !evidencePath?.trim() ||
    !declarationPath?.trim()
  )
    return null;
  return Object.freeze({ windowId, evidencePath, declarationPath });
}

export function writeMeasurementDeclaration(context, { measurementPath, format, runId, owner, scenario }) {
  if (!['local', 'classic'].includes(format) || !measurementPath || !runId || !owner || !scenario)
    throw new Error('Performance measurement declaration is incomplete.');
  const declaration = {
    schemaVersion: 1,
    windowId: context.windowId,
    evidencePath: context.evidencePath,
    measurementPath,
    format,
    runId,
    owner,
    scenario,
  };
  mkdirSync(dirname(resolve(context.declarationPath)), { recursive: true });
  writeFileSync(resolve(context.declarationPath), JSON.stringify(declaration, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return declaration;
}

const parseJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(label + ' is missing or unreadable.');
  }
};

export function measurementSummary(declarationPath, { rootDirectory = process.cwd() } = {}) {
  const declaration = parseJson(resolve(rootDirectory, declarationPath), 'Performance measurement declaration');
  if (
    declaration?.schemaVersion !== 1 ||
    !windowIdPattern.test(declaration.windowId ?? '') ||
    !declaration.evidencePath ||
    !declaration.measurementPath ||
    !['local', 'classic'].includes(declaration.format)
  )
    throw new Error('Performance measurement declaration is invalid.');
  const contents = parseJson(resolve(rootDirectory, declaration.measurementPath), 'Declared performance measurement');
  const record =
    declaration.format === 'local'
      ? contents
      : contents?.attempts?.length === 1
        ? contents.attempts[0]?.benchmark?.measurement
        : null;
  if (!record || typeof record !== 'object') throw new Error('Declared performance measurement is invalid.');
  for (const key of ['windowId', 'evidencePath', 'runId', 'owner', 'scenario'])
    if (record[key] !== declaration[key]) throw new Error('Declared performance measurement mismatches ' + key + '.');
  return {
    status: 'RECORDED',
    path: declaration.measurementPath,
    format: declaration.format,
    digest: measurementDigest(record),
    runId: record.runId,
    owner: record.owner,
    scenario: record.scenario,
    sampleStartedAt: record.sampleStartedAt,
    sampleCompletedAt: record.sampleCompletedAt,
    sourceSha: record.sourceSha,
    sourceDigest: record.sourceDigest,
    lockDigest: record.lockDigest,
    artifactDigest: record.artifactDigest ?? record.bundleDigest,
  };
}
