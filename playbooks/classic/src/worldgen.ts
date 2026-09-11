import type { StandardWorldgenProvider } from '@seedlands/stdlib/host';
import { makeChunk, type WorldChange } from '@seedlands/stdlib/world/chunk-generation';
import { macroAt } from '@seedlands/stdlib/world/macro-world';
import { baseVoxel } from '@seedlands/stdlib/world/voxel';

export const classicWorldgenIdentity = Object.freeze({
  id: 'seedlands:classic-worldgen',
  implementationVersion: '4.0.0',
  configurationIdentity: 'seedlands:classic-terrain-g2-g4',
  supportedGeneratorVersions: Object.freeze([2, 3, 4]),
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

export function createClassicWorldgenProvider(generateChunk: GenerateChunk = makeChunk): StandardWorldgenProvider {
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
      const queryMacro = (qx: number, qz: number) => macroAt(seed, qx, qz, generatorVersion);
      return baseVoxel(seed, x, y, z, queryMacro(x, z), queryMacro, generatorVersion);
    },
  });
}

export const classicWorldgenProvider = createClassicWorldgenProvider();
