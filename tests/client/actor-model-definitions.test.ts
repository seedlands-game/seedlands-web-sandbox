import { describe, expect, it } from 'vitest';
import {
  actorModelDefinitions,
  playerArmModelDefinition,
  playerModelDefinition,
} from '../../src/client/presentation/actor-model-definitions';
import {
  builtinModelTextures,
  modelMaterialDefinitions,
} from '../../src/client/presentation/model-material-definitions';

describe('内置角色模型定义', () => {
  it('将现有生物、完整人物和第一人称手臂声明为可复用构件', () => {
    expect(Object.keys(actorModelDefinitions).sort()).toEqual(['grazer', 'player', 'settler', 'stalker']);
    expect(playerModelDefinition.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'player-arm-right-sleeve' })]),
    );
    expect(playerArmModelDefinition.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'sleeve' }), expect.objectContaining({ id: 'hand' })]),
    );
  });

  it('遵守 1/16 的方块人物比例，且第一人称手臂直接复用人物手臂构件', () => {
    const rightArm = playerModelDefinition.parts.find((part) => part.id === 'player-arm-right-sleeve')!;
    const sleeve = playerArmModelDefinition.parts.find((part) => part.id === 'sleeve')!;
    const hand = playerArmModelDefinition.parts.find((part) => part.id === 'hand')!;
    const head = playerModelDefinition.parts.find((part) => part.id === 'player-head')!;
    const torso = playerModelDefinition.parts.find((part) => part.id === 'player-torso')!;
    const leftLeg = playerModelDefinition.parts.find((part) => part.id === 'player-leg-left')!;
    const settlerHead = actorModelDefinitions.settler.parts.find((part) => part.id === 'settler-head')!;
    const settlerTorso = actorModelDefinitions.settler.parts.find((part) => part.id === 'settler-tunic')!;
    const settlerArm = actorModelDefinitions.settler.parts.find((part) => part.id === 'arm-right-sleeve')!;
    expect(rightArm.scale).toEqual(sleeve.scale);
    expect(sleeve.position).toEqual([0, 0.1875, 0]);
    expect(hand.position).toEqual([0, -0.1875, 0]);
    expect(sleeve.scale).toEqual([0.25, 0.375, 0.25]);
    expect(hand.scale).toEqual([0.25, 0.375, 0.25]);
    expect(head).toMatchObject({ position: [0, 1.75, 0], scale: [0.5, 0.5, 0.5] });
    expect(torso).toMatchObject({ position: [0, 1.125, 0], scale: [0.5, 0.75, 0.25] });
    expect(leftLeg).toMatchObject({ position: [-0.125, 0.375, 0], scale: [0.25, 0.75, 0.25] });
    expect(settlerHead).toMatchObject({ position: [0, 1.75, 0], scale: [0.5, 0.5, 0.5] });
    expect(settlerTorso).toMatchObject({ position: [0, 1.125, 0], scale: [0.5, 0.75, 0.25] });
    expect(settlerArm).toMatchObject({ position: [0.375, 1.3125, 0], scale: [0.25, 0.375, 0.25] });
  });
});

describe('模型材质源', () => {
  it('全部从稳定的 16×16 PixelTexture 源生成材质', () => {
    expect(builtinModelTextures.length).toBe(modelMaterialDefinitions.length);
    expect(builtinModelTextures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'seedlands:texture/model/skin',
          payload: expect.objectContaining({ width: 16, height: 16 }),
        }),
        expect.objectContaining({
          id: 'seedlands:texture/model/cloth',
          payload: expect.objectContaining({ width: 16, height: 16 }),
        }),
      ]),
    );
    expect(modelMaterialDefinitions.map((material) => material.textureId).sort()).toEqual(
      builtinModelTextures.map((texture) => texture.id).sort(),
    );
    expect(builtinModelTextures.every((texture) => texture.id.startsWith('seedlands:texture/model/'))).toBe(true);
  });

  it('为人物面部和服装生成低频、有组织的像素纹理', () => {
    const texture = (id: string) => builtinModelTextures.find((entry) => entry.id === `seedlands:texture/model/${id}`)!;
    const uniqueColors = (id: string) => new Set(texture(id).payload.pixels);
    const patternedPixels = (id: string) => texture(id).payload.pixels.filter((color) => color !== 1).length;

    expect([...uniqueColors('skin')]).toEqual([1]);
    expect([...uniqueColors('eye')]).toEqual([1]);
    expect([...uniqueColors('glow-eye')]).toEqual([1]);
    expect(patternedPixels('cloth')).toBeLessThanOrEqual(40);
    expect(patternedPixels('boot')).toBeLessThanOrEqual(32);
    expect(patternedPixels('charcoal')).toBeLessThanOrEqual(32);
  });
});
