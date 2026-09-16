import { describe, expect, it } from 'vitest';
import {
  actorModelDefinition,
  itemVisualKind,
  viewmodelPose,
} from '../../../src/client/presentation/gameplay-model-definition';

describe('gameplay model definition', () => {
  it('一次性动作在起止回到握姿，途中有可见动作且非法时间安全', () => {
    for (const action of ['attack', 'place', 'eat'] as const) {
      for (const time of [0, -1, 0.42, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(viewmodelPose(action, time)).toEqual({ shoulder: 0, elbow: 0, wrist: 0 });
      }
      expect(Object.values(viewmodelPose(action, 0.17)).some((value) => Math.abs(value) > 10)).toBe(true);
    }
  });
  it('gives every carryable item one shared physical visual definition', () => {
    expect(itemVisualKind('dirt-block')).toEqual({ kind: 'voxel-block', faces: 6 });
    expect(itemVisualKind('lantern').kind).toBe('lantern');
    expect(itemVisualKind('wood-axe').kind).toBe('wood-axe');
    expect(itemVisualKind('stone-pickaxe').kind).toBe('stone-pickaxe');
    expect(itemVisualKind('berry').kind).toBe('berry-cluster');
  });

  it('defines distinct textured low-poly silhouettes with faces and joints', () => {
    for (const archetype of ['grazer', 'night-stalker', 'settler'] as const) {
      const actor = actorModelDefinition(archetype);
      expect(actor.silhouette.length).toBeGreaterThan(2);
      expect(actor.face.length).toBeGreaterThan(0);
      expect(actor.joints.length).toBeGreaterThan(0);
    }
    expect(actorModelDefinition('night-stalker').primaryColor).not.toMatch(/purple|violet/i);
  });

  it('drives a real arm chain for mining and returns to rest', () => {
    expect(viewmodelPose('idle', 0)).toEqual({ shoulder: 0, elbow: 0, wrist: 0 });
    const mining = viewmodelPose('mine', 0.24);
    expect(Math.abs(mining.shoulder) + Math.abs(mining.elbow) + Math.abs(mining.wrist)).toBeGreaterThan(8);
  });
});
