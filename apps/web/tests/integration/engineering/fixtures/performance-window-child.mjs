import { existsSync, writeFileSync } from 'node:fs';

const [childReadback, ownerPath, measurementPath] = process.argv.slice(2);
const measurement = {
  status: 'MEASURED',
  runId: 'fixture-run',
  owner: 'web-runtime',
  scenario: 'fixture',
  windowId: process.env.SEEDLANDS_PERFORMANCE_WINDOW_ID,
  evidencePath: process.env.SEEDLANDS_PERFORMANCE_WINDOW_EVIDENCE,
  sampleStartedAt: new Date().toISOString(),
  sampleCompletedAt: new Date().toISOString(),
  sourceSha: 'a'.repeat(40),
  sourceDigest: 'b'.repeat(64),
  lockDigest: 'c'.repeat(64),
  artifactDigest: 'd'.repeat(64),
};
writeFileSync(measurementPath, JSON.stringify(measurement));
writeFileSync(
  process.env.SEEDLANDS_PERFORMANCE_MEASUREMENT_DECLARATION,
  JSON.stringify({
    schemaVersion: 1,
    windowId: measurement.windowId,
    evidencePath: measurement.evidencePath,
    measurementPath,
    format: 'local',
    runId: measurement.runId,
    owner: measurement.owner,
    scenario: measurement.scenario,
  }),
);
writeFileSync(
  childReadback,
  JSON.stringify({
    reserved: process.env.SEEDLANDS_PERFORMANCE_WINDOW_RESERVED,
    windowId: measurement.windowId,
    locked: existsSync(ownerPath),
  }),
);
