import { readFileSync } from 'node:fs';

export type Point = readonly [number, number, number];
export type RoutePoint = readonly [number, number];

export type ClassicScenario = Readonly<{
  schemaVersion: 1;
  scenarioId: string;
  playbookId: 'seedlands:overworld';
  playbookVersion: '1.0.0';
  referenceMinecraftVersion: 'unfrozen';
  seed: string;
  generatorVersion: number;
  quality: 'low' | 'medium' | 'high';
  runtime: Readonly<{ renderer: 'webgl2'; wasm: true; simd: true; packEntryPath: 'packs/overworld.mjs' }>;
  initialState: Readonly<{
    floor: Readonly<{ from: Point; to: Point; voxel: number }>;
    air: Readonly<{ from: Point; to: Point; voxel: number }>;
    player: Point;
    view: Readonly<{ yaw: number; pitch: number }>;
    worldTime: number;
    hungerAdvanceMs: number;
    resourceVoxels: readonly Readonly<{ position: Point; voxel: number; itemId: string }>[];
    hostile: Readonly<{ id: string; position: Point }>;
    npc: Readonly<{
      creationRequestId: string;
      name: string;
      personality: string;
      position: Point;
      homePosition: Point;
      food: Readonly<{ position: Point; itemId: 'berry'; count: number }>;
    }>;
  }>;
  route: Readonly<{
    chunkCrossing: RoutePoint;
    buildTarget: Point;
    stationTarget: Point;
    hostileApproach: RoutePoint;
    stationApproach: RoutePoint;
    farTurnaround: RoutePoint;
    returnPoint: RoutePoint;
  }>;
  faultDesign: Readonly<Record<string, string>>;
  coverage: Readonly<{
    included: readonly string[];
    integratedLegacyBrowserProtection: readonly Readonly<{
      source: string;
      stages: readonly `C${0 | 1 | 2 | 3 | 4 | 5}`[];
      observation: string;
    }>[];
    explicitGaps: readonly Readonly<{ source: string; reason: string; requiredDisposition: string }>[];
    notCovered: readonly string[];
  }>;
}>;

const scenarioUrl = new URL('../../../../../playbooks/classic/scenarios/canonical-runtime-v1.json', import.meta.url);

export const classicScenario = JSON.parse(readFileSync(scenarioUrl, 'utf8')) as ClassicScenario;

if (classicScenario.schemaVersion !== 1 || classicScenario.scenarioId !== 'classic-canonical-runtime-v1')
  throw new Error('Unsupported Classic canonical scenario.');
