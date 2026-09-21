import { expect, it } from 'vitest';
import { selectStoredWorldVersion } from '../../../src/client/persistence/stored-world-selection';
import { classicWorldgenIdentity } from '@seedlands/playbook-classic/worldgen';
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
  expect(selectStoredWorldVersion([record], 'same', classicWorldgenIdentity, 'new-current')).toBe(5);
  expect(record.generatorVersion).toBe(4);
  expect(() =>
    selectStoredWorldVersion([{ ...record, provider: undefined }], 'same', classicWorldgenIdentity, 'continue'),
  ).toThrow(/不兼容/);
});
it('同provider可继续V4或V5，未知版本不被吞掉', () => {
  const compatible = { ...record, provider: classicWorldgenIdentity };
  expect(selectStoredWorldVersion([compatible], 'same', classicWorldgenIdentity, 'continue')).toBe(4);
  expect(selectStoredWorldVersion([], 'fresh', classicWorldgenIdentity, 'continue')).toBe(5);
  expect(
    selectStoredWorldVersion([{ ...compatible, generatorVersion: 5 }], 'same', classicWorldgenIdentity, 'continue'),
  ).toBe(5);
  expect(() =>
    selectStoredWorldVersion([{ ...record, generatorVersion: 99 }], 'same', classicWorldgenIdentity, 'continue'),
  ).toThrow(/不兼容/);
});
