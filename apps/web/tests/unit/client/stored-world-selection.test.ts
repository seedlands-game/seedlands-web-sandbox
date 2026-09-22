import { expect, it } from 'vitest';
import { selectStoredWorldVersion } from '../../../src/client/persistence/stored-world-selection';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
const { identity: classicWorldgenIdentity } = classicWorldgenProvider;
import { GENERATOR_VERSION } from '@seedlands/stdlib/world/voxel';
const record = {
  worldId: 'seedlands:g4:same',
  seedText: 'same',
  generatorVersion: 4,
  updatedAt: 1,
  provider: {
    ...classicWorldgenIdentity,
    implementationVersion: '4.0.0',
    configurationIdentity: 'seedlands:classic-terrain-g2-g4',
    supportedGeneratorVersions: [2, 3, 4],
  },
};

it('继续旧provider世界时明确拒绝，不能静默开同seed新世界', () => {
  expect(() => selectStoredWorldVersion([record], 'same', classicWorldgenIdentity, 'continue')).toThrow(/不兼容/);
  expect(selectStoredWorldVersion([record], 'same', classicWorldgenIdentity, 'new-current')).toBe(GENERATOR_VERSION);
  expect(record.generatorVersion).toBe(4);
  expect(() =>
    selectStoredWorldVersion([{ ...record, provider: undefined }], 'same', classicWorldgenIdentity, 'continue'),
  ).toThrow(/不兼容/);
});
it('同provider可继续旧版或当前版，未知版本不被吞掉', () => {
  const compatible = { ...record, provider: classicWorldgenIdentity };
  expect(selectStoredWorldVersion([compatible], 'same', classicWorldgenIdentity, 'continue')).toBe(4);
  expect(selectStoredWorldVersion([], 'fresh', classicWorldgenIdentity, 'continue')).toBe(GENERATOR_VERSION);
  expect(
    selectStoredWorldVersion(
      [{ ...compatible, worldId: `seedlands:g${GENERATOR_VERSION}:same`, generatorVersion: GENERATOR_VERSION }],
      'same',
      classicWorldgenIdentity,
      'continue',
    ),
  ).toBe(GENERATOR_VERSION);
  expect(() =>
    selectStoredWorldVersion([{ ...record, generatorVersion: 99 }], 'same', classicWorldgenIdentity, 'continue'),
  ).toThrow(/不兼容/);
});

it('只允许精确的历史 Classic provider 身份继续原版本世界', () => {
  expect(
    selectStoredWorldVersion(
      [record],
      'same',
      classicWorldgenIdentity,
      'continue',
      classicWorldgenProvider.acceptsStoredIdentity,
    ),
  ).toBe(4);
  for (const provider of [
    { ...record.provider, id: 'other:worldgen' },
    { ...record.provider, artifactIdentity: 'tampered:classic@1' },
    { ...record.provider, supportedGeneratorVersions: [2, 4] },
    { ...record.provider, configurationIdentity: 'seedlands:classic-terrain-g2-g10' },
  ])
    expect(() =>
      selectStoredWorldVersion(
        [{ ...record, provider }],
        'same',
        classicWorldgenIdentity,
        'continue',
        classicWorldgenProvider.acceptsStoredIdentity,
      ),
    ).toThrow(/不兼容/);
});
