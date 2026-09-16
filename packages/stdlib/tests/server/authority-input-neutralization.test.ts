import { expect, it, vi } from 'vitest';
import { clearAuthorityHorizontalVelocity } from '../../src/server/authority/authority-input-neutralization';

it('清输入只消除水平速度，不改变垂直速度，已静止时不制造重复写入', () => {
  const updateEntity = vi.fn();
  const entity = {
    id: 'player',
    type: 'player' as const,
    position: [1, 2, 3] as [number, number, number],
    physicsVelocity: [2, -1, 3] as [number, number, number],
  };
  const port = { getEntity: () => entity, updateEntity };
  expect(clearAuthorityHorizontalVelocity(port, entity.id)).toBe(true);
  expect(updateEntity).toHaveBeenCalledWith('player', { position: [1, 2, 3], physicsVelocity: [0, -1, 0] });
  entity.physicsVelocity = [0, -1, 0];
  expect(clearAuthorityHorizontalVelocity(port, entity.id)).toBe(false);
  expect(updateEntity).toHaveBeenCalledTimes(1);
});
