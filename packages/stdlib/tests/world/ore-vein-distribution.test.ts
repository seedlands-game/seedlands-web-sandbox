import { expect, it } from 'vitest';
import { oreVoxel } from '../../src/world/ore-generation';

// Fixed seed / column so the measurement is deterministic and reproducible.
const SEED = 1837;
const HEIGHT = 80;

function scanDensities(version: number) {
  const counts = { coal: 0, iron: 0, gold: 0, diamond: 0, stone: 0 };
  let total = 0;
  for (let y = 0; y < 64; y += 1)
    for (let z = -24; z < 24; z += 1)
      for (let x = -24; x < 24; x += 1) {
        const v = oreVoxel(SEED, x, y, z, HEIGHT, 3, version);
        total += 1;
        if (v === 14) counts.coal += 1;
        else if (v === 15) counts.iron += 1;
        else if (v === 19) counts.gold += 1;
        else if (v === 20) counts.diamond += 1;
        else counts.stone += 1;
      }
  return { counts, total };
}

it('矿脉深度门槛与生成次序确定：钻石>金优先于铁>煤，稀有度递减', () => {
  // Generation precedence: diamond and gold (V5) take a deep stone cell before iron/coal.
  const { counts } = scanDensities(6);
  expect(counts.diamond).toBeGreaterThan(0);
  expect(counts.gold).toBeGreaterThan(0);
  expect(counts.iron).toBeGreaterThan(0);
  expect(counts.coal).toBeGreaterThan(0);
  // Rarity ordering — diamond scarcest, coal most common among ores.
  expect(counts.diamond).toBeLessThan(counts.gold);
  expect(counts.gold).toBeLessThan(counts.iron);
  expect(counts.iron).toBeLessThan(counts.coal);
});

it('深度门槛：钻石仅 y<16 且表下≥12，金仅 y<32 且表下≥8，煤铁按各自深度', () => {
  // Shallow band (depth < 4) never yields any ore.
  for (let x = -20; x < 20; x += 1)
    expect([14, 15, 19, 20]).not.toContain(oreVoxel(SEED, x, HEIGHT - 2, x, HEIGHT, 3, 6));
  // Diamond disappears above y=16 even when deep enough.
  for (let x = -32; x < 32; x += 1) expect(oreVoxel(SEED, x, 20, x, 200, 3, 6)).not.toBe(20);
  // Gold disappears above y=32.
  for (let x = -32; x < 32; x += 1) expect(oreVoxel(SEED, x, 40, x, 200, 3, 6)).not.toBe(19);
});

it('矿脉分布不随 V6 洞穴改变：同参数 V5 与 V6 的 oreVoxel 输出一致', () => {
  for (let y = 0; y < 40; y += 3)
    for (let x = -16; x < 16; x += 3)
      expect(oreVoxel(SEED, x, y, x, HEIGHT, 3, 5)).toBe(oreVoxel(SEED, x, y, x, HEIGHT, 3, 6));
});
