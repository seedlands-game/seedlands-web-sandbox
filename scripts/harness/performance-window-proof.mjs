import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { root } from './artifact.mjs';

const windowIdPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const digestPattern = /^[0-9a-f]{64}$/;

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

export function requirePerformanceWindowContext(environment = process.env) {
  const context = performanceWindowContext(environment);
  if (!context)
    throw new Error('A complete machine performance window context is required; direct measurements are diagnostic.');
  return context;
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
  writeFileSync(resolve(context.declarationPath), `${JSON.stringify(declaration, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return declaration;
}

const parseJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${label} is missing or unreadable.`);
  }
};

const dateValue = (value) => {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export function measurementFromDeclaration(declarationPath, { rootDirectory = root } = {}) {
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
    if (record[key] !== declaration[key]) throw new Error(`Declared performance measurement mismatches ${key}.`);
  return { declaration, record };
}

export function measurementSummary(declarationPath, options) {
  const { declaration, record } = measurementFromDeclaration(declarationPath, options);
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

export function assertMeasurementWindow(record, { rootDirectory = root } = {}) {
  if (!windowIdPattern.test(record?.windowId ?? '') || !record?.evidencePath)
    throw new Error('A successful external performance window receipt is required.');
  const receipt = parseJson(resolve(rootDirectory, record.evidencePath), 'Performance window receipt');
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.kind !== 'seedlands-performance-window' ||
    receipt.status !== 'PASS' ||
    receipt.exitCode !== 0 ||
    receipt.windowId !== record.windowId
  )
    throw new Error('A successful external performance window receipt is required.');
  const startedAt = dateValue(receipt.startedAt);
  const endedAt = dateValue(receipt.endedAt);
  const sampleStartedAt = dateValue(record.sampleStartedAt);
  const sampleCompletedAt = dateValue(record.sampleCompletedAt);
  if (
    startedAt === null ||
    endedAt === null ||
    sampleStartedAt === null ||
    sampleCompletedAt === null ||
    startedAt > sampleStartedAt ||
    sampleStartedAt > sampleCompletedAt ||
    sampleCompletedAt > endedAt
  )
    throw new Error('Performance window receipt does not cover the measurement sample interval.');
  const proof = receipt.measurement;
  const artifactDigest = record.artifactDigest ?? record.bundleDigest;
  if (
    proof?.status !== 'RECORDED' ||
    !digestPattern.test(proof.digest ?? '') ||
    proof.digest !== measurementDigest(record) ||
    proof.runId !== record.runId ||
    proof.owner !== record.owner ||
    proof.scenario !== record.scenario ||
    proof.sampleStartedAt !== record.sampleStartedAt ||
    proof.sampleCompletedAt !== record.sampleCompletedAt ||
    proof.sourceSha !== record.sourceSha ||
    proof.sourceDigest !== record.sourceDigest ||
    proof.lockDigest !== record.lockDigest ||
    proof.artifactDigest !== artifactDigest
  )
    throw new Error('Performance window measurement proof does not match the measured record.');
  return receipt;
}
