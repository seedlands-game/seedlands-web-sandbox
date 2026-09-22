import type { StandardWorldgenProvider } from '@seedlands/stdlib/host';
import { makeChunk, type WorldChange } from '@seedlands/stdlib/world/chunk-generation';
import { macroAt } from '@seedlands/stdlib/world/macro-world';
import type { MacroContext } from '@seedlands/stdlib/world/macro-world';
import { baseVoxel } from '@seedlands/stdlib/world/voxel';

export const classicWorldgenIdentity = Object.freeze({
  id: 'seedlands:classic-worldgen',
  implementationVersion: '10.0.0',
  configurationIdentity: 'seedlands:classic-terrain-g2-g10',
  supportedGeneratorVersions: Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]),
  artifactIdentity: 'seedlands:overworld@1.0.0',
});

type GenerateChunk = (
  seed: number,
  cx: number,
  cy: number,
  cz: number,
  changes: WorldChange[],
  generatorVersion: number,
) => Uint16Array;

type SampleMacro = (seed: number, x: number, z: number, generatorVersion: number) => MacroContext;

export function createClassicWorldgenProvider(
  generateChunk: GenerateChunk = makeChunk,
  sampleMacro: SampleMacro = macroAt,
): StandardWorldgenProvider {
  const macroColumns = new Map<string, MacroContext>();
  const queryMacro = (seed: number, generatorVersion: number, x: number, z: number): MacroContext => {
    const key = [seed, generatorVersion, x, z].join(':');
    const cached = macroColumns.get(key);
    if (cached) return cached;
    const context = sampleMacro(seed, x, z, generatorVersion);
    if (macroColumns.size >= 4096) macroColumns.clear();
    macroColumns.set(key, context);
    return context;
  };
  return Object.freeze({
    identity: classicWorldgenIdentity,
    generate(input) {
      const { seed, generatorVersion, coordinate, epoch, revision } = input;
      return {
        coordinate,
        provider: classicWorldgenIdentity,
        generatorVersion,
        epoch,
        revision,
        voxels: generateChunk(seed, coordinate.x, coordinate.y, coordinate.z, [], generatorVersion),
      };
    },
    sampleVoxel({ seed, generatorVersion, x, y, z }) {
      const sampleColumn = (qx: number, qz: number) => queryMacro(seed, generatorVersion, qx, qz);
      return baseVoxel(seed, x, y, z, sampleColumn(x, z), sampleColumn, generatorVersion);
    },
  });
}

export const classicWorldgenProvider = createClassicWorldgenProvider();
