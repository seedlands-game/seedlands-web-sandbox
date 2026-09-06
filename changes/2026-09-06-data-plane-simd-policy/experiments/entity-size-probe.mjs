// 从任意目录运行：
// node changes/2026-09-06-data-plane-simd-policy/experiments/entity-size-probe.mjs
// v8.serialize 结果仅是 Node V8 对象图尺寸代理。
import { serialize } from 'node:v8';

const player = {
  id: 'player-1',
  type: 'player',
  kind: 'player',
  lifecycle: 'active',
  position: [15.5, 6, 15.5],
};
const actor = {
  id: 'actor-1',
  type: 'creature',
  kind: 'creature',
  lifecycle: 'active',
  position: [12.5, 6, 12.5],
  physicsVelocity: [0, 0, 0],
  health: 12,
  maxHealth: 12,
  archetype: 'grazer',
  persistent: true,
};
const item = {
  id: 'item-1',
  type: 'world-item',
  kind: 'world-item',
  lifecycle: 'active',
  position: [10.5, 6, 10.5],
  physicsVelocity: [0, 0, 0],
  stack: { itemId: 'berry', count: 1 },
};

console.log(
  JSON.stringify({
    player: serialize(player).byteLength,
    actor: serialize(actor).byteLength,
    item: serialize(item).byteLength,
  }),
);
