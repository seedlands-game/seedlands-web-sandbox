import { describe, expect, it } from 'vitest';
import { createCollisionDebugBatch } from '../../../src/client/presentation/collision-debug-projection';

describe('碰撞调试投影', () => {
  it('projects the configured carrier bounds and rejects a carrier without its authoritative geometry', () => {
    const carrier = {
      id: 'carrier',
      kind: null,
      state: { position: { x: 32, y: 33, z: 32 }, velocity: { x: 0, y: 0, z: 0 } },
      grounded: false,
      contacts: [],
      localAabb: { min: { x: -0.25, y: 0, z: -1.5 }, max: { x: 0.25, y: 0.8, z: 1.5 } },
    };
    const snapshot = { epoch: 'carrier-debug', physicsTick: 1, authoritative: [carrier], truncatedBodyCount: 0 };
    const batch = createCollisionDebugBatch(snapshot, carrier.state.position);
    expect(batch.lines).toHaveLength(12);
    const xs = [...batch.positions].filter((_, i) => i % 3 === 0);
    const zs = [...batch.positions].filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBe(31.75);
    expect(Math.max(...xs)).toBe(32.25);
    expect(Math.min(...zs)).toBe(30.5);
    expect(Math.max(...zs)).toBe(33.5);
    expect(() =>
      createCollisionDebugBatch(
        { ...snapshot, authoritative: [{ ...carrier, localAabb: undefined }] },
        carrier.state.position,
      ),
    ).toThrow('configured body');
  });
  it('从同一身体注册表投影权威和预测箱，且来源和颜色可区分', () => {
    const batch = createCollisionDebugBatch(
      {
        epoch: 'world-a',
        physicsTick: 42,
        authoritative: [
          {
            id: 'player-1',
            kind: 'player',
            state: { position: { x: 3, y: 10, z: -2 }, velocity: { x: 0, y: 0, z: 0 } },
            grounded: true,
            contacts: [],
          },
        ],
        predictedPlayer: {
          id: 'player-1',
          kind: 'player',
          physicsTick: 45,
          state: { position: { x: 3.1, y: 10, z: -2 }, velocity: { x: 0, y: 0, z: 0 } },
        },
        truncatedBodyCount: 0,
      },
      { x: 0, y: 10, z: 0 },
    );

    expect(batch.physicsTick).toBe(42);
    expect(batch.truncatedBodyCount).toBe(0);
    expect(batch.positions).toBeInstanceOf(Float32Array);
    expect(batch.positions.length).toBe(24 * 6);
    expect(batch.colors.length).toBe(batch.positions.length);
    expect(batch.lines).toHaveLength(24);
    expect(batch.lines.filter((line) => line.source === 'authoritative-body')).toHaveLength(12);
    expect(batch.lines.filter((line) => line.source === 'predicted-body')).toHaveLength(12);
    expect(batch.lines[0]?.color).not.toEqual(batch.lines[12]?.color);
    expect(batch.lines[0]).toMatchObject({ entityId: 'player-1', grounded: true, physicsTick: 42 });
    expect(batch.lines[12]).toMatchObject({ source: 'predicted-body', entityId: 'player-1', physicsTick: 45 });
  });

  it('只保留32格内最多128个实体，并保留截断信息供面板显示', () => {
    const authoritative = Array.from({ length: 130 }, (_, index) => ({
      id: `item-${index}`,
      kind: 'world-item' as const,
      state: { position: { x: index, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      grounded: false,
      contacts: [],
    }));
    const batch = createCollisionDebugBatch(
      { epoch: 'world-a', physicsTick: 3, authoritative, truncatedBodyCount: 7 },
      { x: 0, y: 0, z: 0 },
    );

    expect(batch.visibleBodyCount).toBe(33);
    expect(batch.truncatedBodyCount).toBe(104);
    expect(batch.lines.filter((line) => line.source === 'authoritative-body')).toHaveLength(33 * 12);
  });

  it('以方块注册表的实际子箱投影瞄准灯笼，而非完整方块近似箱', () => {
    const batch = createCollisionDebugBatch(
      {
        epoch: 'world-a',
        physicsTick: 7,
        authoritative: [],
        targetVoxel: { position: [8, 4, -3], voxel: 10 },
        truncatedBodyCount: 0,
      },
      { x: 8, y: 4, z: -3 },
    );

    const targetLines = batch.lines.filter((line) => line.source === 'target-voxel');
    expect(targetLines).not.toHaveLength(0);
    expect(targetLines.every((line) => line.voxel === 10)).toBe(true);
    const targetX = targetLines.flatMap((line) => [
      batch.positions[line.vertexOffset * 3],
      batch.positions[line.vertexOffset * 3 + 3],
    ]);
    const targetY = targetLines.flatMap((line) => [
      batch.positions[line.vertexOffset * 3 + 1],
      batch.positions[line.vertexOffset * 3 + 4],
    ]);
    expect(Math.min(...targetX)).toBeGreaterThan(8);
    expect(Math.max(...targetX)).toBeLessThan(9);
    expect(Math.max(...targetY)).toBeLessThan(5);
  });

  it('可选接触细节标记接触和传感器用途，默认批次不制造它们', () => {
    const snapshot = {
      epoch: 'world-a',
      physicsTick: 9,
      authoritative: [
        {
          id: 'item-1',
          kind: 'world-item' as const,
          state: { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
          grounded: false,
          contacts: [{ point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }],
          sensors: [
            {
              purpose: 'attraction' as const,
              shape: 'sphere' as const,
              center: { x: 0, y: 0, z: 0 },
              radius: 2,
            },
            {
              purpose: 'pickup' as const,
              shape: 'sphere' as const,
              center: { x: 0, y: 0, z: 0 },
              radius: 1,
            },
          ],
        },
      ],
      truncatedBodyCount: 0,
    };
    expect(
      createCollisionDebugBatch(snapshot, { x: 0, y: 0, z: 0 }).lines.some((line) => line.source === 'contact-normal'),
    ).toBe(false);
    expect(
      createCollisionDebugBatch(snapshot, { x: 0, y: 0, z: 0 }, { includeContacts: true }).lines.some(
        (line) => line.source === 'contact-normal',
      ),
    ).toBe(true);
    expect(
      createCollisionDebugBatch(snapshot, { x: 0, y: 0, z: 0 }, { includePickupSensors: true }).lines.filter(
        (line) => line.source === 'pickup-sensor' && line.sensorPurpose === 'pickup',
      ),
    ).toHaveLength(72);
    expect(
      createCollisionDebugBatch(snapshot, { x: 0, y: 0, z: 0 }, { includePickupSensors: true }).lines.filter(
        (line) => line.source === 'attraction-sensor' && line.sensorPurpose === 'attraction',
      ),
    ).toHaveLength(72);
    const detailed = createCollisionDebugBatch(snapshot, { x: 0, y: 0, z: 0 }, { includeSensors: true });
    expect(detailed.visibleSensorCount).toBe(2);
    expect(detailed.contactCount).toBe(0);
  });
});
