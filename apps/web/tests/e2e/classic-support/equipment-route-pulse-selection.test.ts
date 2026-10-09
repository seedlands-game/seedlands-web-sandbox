import { describe, expect, it } from 'vitest';
import { equipmentRoutePulseMs, type EquipmentRouteSnapshot } from './equipment-resource-route';

const target = [78.5, -0.5] as const;
const settled: EquipmentRouteSnapshot = {
  player: [98.5, 32.6, -0.5],
  serverPlayerPosition: [98.5, 32.6, -0.5],
  serverPlayerVelocity: [0, 0, 0],
  viewAngles: [270, 0],
  onGround: true,
  colliding: false,
  authority: { physicsTick: 100, acknowledgedInputSequence: 200 },
};

describe('bounded equipment route pulse planning', () => {
  it.each(['KeyW', 'KeyS'] as const)('uses the ordinary far pulse while %s approaches diagonally', (direction) => {
    const player = [direction === 'KeyW' ? 58.5 : 98.5, 32.6, 0.5] as const;
    const sign = direction === 'KeyW' ? -1 : 1;
    const yaw = (Math.atan2(sign * (target[0] - player[0]), sign * (target[1] - player[2])) * 180) / Math.PI;
    expect(
      equipmentRoutePulseMs(
        { ...settled, player, serverPlayerPosition: player, viewAngles: [yaw, 0] },
        target,
        direction,
      ),
    ).toBe(300);
  });

  it('keeps a diagonally aligned near approach on the original short pulse', () => {
    const player = [80.5, 32.6, 0.5] as const;
    const yaw = (Math.atan2(target[0] - player[0], target[1] - player[2]) * 180) / Math.PI;
    expect(
      equipmentRoutePulseMs({ ...settled, player, serverPlayerPosition: player, viewAngles: [yaw, 0] }, target, 'KeyS'),
    ).toBe(80);
  });

  it('uses an existing 300ms ordinary walking pulse only for an aligned settled far route', () => {
    expect(equipmentRoutePulseMs(settled, target, 'KeyS')).toBe(300);
    expect(
      equipmentRoutePulseMs(
        { ...settled, player: [58.5, 32.6, -0.5], serverPlayerPosition: [58.5, 32.6, -0.5] },
        target,
        'KeyW',
      ),
    ).toBe(300);
  });

  it.each<[string, Partial<EquipmentRouteSnapshot>]>([
    ['near player', { player: [81.5, 32.6, -0.5], serverPlayerPosition: [81.5, 32.6, -0.5] }],
    ['near authority', { player: [81.51, 32.6, -0.5], serverPlayerPosition: [81.5, 32.6, -0.5] }],
    ['moving', { serverPlayerVelocity: [-0.01, 0, 0] }],
    ['presentation lag', { player: [98.56, 32.6, -0.5] }],
    ['player outside corridor', { player: [98.5, 32.6, -0.4] }],
    ['authority outside corridor', { serverPlayerPosition: [98.5, 32.6, -0.4] }],
    ['airborne', { onGround: false }],
    ['collision', { colliding: true }],
    ['unaligned heading', { viewAngles: [270.26, 0] }],
    ['invalid heading', { viewAngles: [NaN, 0] }],
    ['invalid player', { player: [Infinity, 32.6, -0.5] }],
    ['invalid authority', { serverPlayerPosition: [NaN, 32.6, -0.5] }],
    ['invalid velocity', { serverPlayerVelocity: [0, NaN, 0] }],
  ])('retains 80ms for %s', (_name, patch) => {
    expect(equipmentRoutePulseMs({ ...settled, ...patch }, target, 'KeyS')).toBe(80);
  });

  it('retains the original pulse for missing observations, invalid targets or opposite direction', () => {
    const withoutVelocity: EquipmentRouteSnapshot = {
      player: settled.player,
      serverPlayerPosition: settled.serverPlayerPosition,
      onGround: settled.onGround,
      colliding: settled.colliding,
      authority: settled.authority,
      viewAngles: [270, 0],
    };
    const withoutView = { ...settled };
    Reflect.deleteProperty(withoutView, 'viewAngles');
    expect(equipmentRoutePulseMs(withoutVelocity, target, 'KeyS')).toBe(80);
    expect(equipmentRoutePulseMs(withoutView, target, 'KeyS')).toBe(80);
    expect(equipmentRoutePulseMs(settled, [NaN, -0.5], 'KeyS')).toBe(80);
    expect(equipmentRoutePulseMs(settled, target, 'KeyW')).toBe(80);
  });
});
