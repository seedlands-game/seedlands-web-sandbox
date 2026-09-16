import { describe, expect, it } from 'vitest';
import { EntityStore } from '../../../fixtures/classic/content';
import { PoiRegistry } from '../../../../../../packages/stdlib/src/server/simulation/poi-registry';
import { PerceptionRuntime } from '../../../../../../packages/stdlib/src/server/simulation/perception-runtime';

function setup() {
  const entities = new EntityStore();
  entities.spawn({ id: 'alice', type: 'player', position: [0, 0, 0] });
  return new PerceptionRuntime({ entities, pois: new PoiRegistry(), getVoxel: () => 0, isPlayerAlive: () => true });
}
describe('prepared perception records', () => {
  it('does not emit abandoned events and detaches caller records before apply', () => {
    const perception = setup();
    const event = { type: 'attacked' as const, subjectId: 'wolf' };
    const plan = perception.prepareRecords([{ observerId: 'alice', event }]);
    expect(perception.observe('alice', 1).observations).toEqual([]);
    event.subjectId = 'forged';
    plan.validate();
    plan.apply();
    expect(perception.observe('alice', 1).observations).toEqual([{ type: 'attacked', subjectId: 'wolf' }]);
    expect(() => plan.apply()).toThrow();
  });
  it('rejects changed observer events before installing the prepared batch', () => {
    const perception = setup();
    const plan = perception.prepareRecords([{ observerId: 'alice', event: { type: 'attacked', subjectId: 'wolf' } }]);
    perception.record('alice', { type: 'action-completed', subjectId: 'action-1' });
    expect(() => plan.validate()).toThrow(/stale/);
    expect(perception.observe('alice', 1).observations).toEqual([{ type: 'action-completed', subjectId: 'action-1' }]);
  });
  it('preserves the existing sixteen-event bound', () => {
    const perception = setup();
    const plan = perception.prepareRecords(
      Array.from({ length: 20 }, (_, index) => ({
        observerId: 'alice',
        event: { type: 'attacked' as const, subjectId: String(index) },
      })),
    );
    plan.validate();
    plan.apply();
    expect(perception.observe('alice', 1).observations.map((event) => event.subjectId)).toEqual(
      Array.from({ length: 16 }, (_, index) => String(index + 4)),
    );
  });
});
