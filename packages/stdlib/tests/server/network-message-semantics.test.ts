import { describe, expect, it } from 'vitest';
import {
  NETWORK_MESSAGE_CLASSES,
  type PublicInboundMessage,
  isPublicInboundMessage,
  isPublicOutboundMessage,
} from '../../src/server/protocol/network-message-semantics';

const ref = { protocolVersion: 1 as const, sessionEpoch: 'session:2', worldId: 'world-a', playerId: 'player-a' };

describe('public network message semantics', () => {
  it('keeps continuous input and reliable jump edges in separate message classes', () => {
    expect(NETWORK_MESSAGE_CLASSES['input-state']).toMatchObject({ reliability: 'latest', stream: 'input' });
    expect(NETWORK_MESSAGE_CLASSES['input-edge']).toMatchObject({ reliability: 'reliable', stream: 'control' });
  });

  it('allows only the authenticated player request surface without client capabilities or authority controls', () => {
    const action: PublicInboundMessage = {
      kind: 'player-action',
      ref,
      requestId: 9,
      action: { type: 'place', position: [1, 2, 3] },
    };
    expect(isPublicInboundMessage(action)).toBe(true);
    expect(
      isPublicInboundMessage({
        kind: 'start-authority',
        ref,
        seedText: 'malicious',
        capabilities: ['administrative'],
      }),
    ).toBe(false);
    expect(isPublicInboundMessage({ ...action, capabilities: ['mutation'] })).toBe(false);
    expect(isPublicInboundMessage({ ...action, action: { type: 'set-block', position: [0, 0, 0], voxel: 1 } })).toBe(
      false,
    );
  });

  it('接纳完整玩家校正，拒绝非有限坐标、非法初始确认序列和嵌套多余权限', () => {
    const correction = {
      kind: 'player-correction',
      ref,
      poseSequence: 0,
      physicsTick: 0,
      acknowledgedInputSequence: -1,
      acknowledgedEdgeId: -1,
      inputResyncRequired: false,
      body: { position: [1, 2, 3], velocity: [0, 0, 0] },
      grounded: false,
      collisionRevisionVector: [{ key: '0,0,0', revision: 0 }],
    };
    expect(isPublicOutboundMessage(correction)).toBe(true);
    expect(isPublicOutboundMessage({ ...correction, acknowledgedInputSequence: -2 })).toBe(false);
    expect(isPublicOutboundMessage({ ...correction, body: { ...correction.body, position: [NaN, 0, 0] } })).toBe(false);
    expect(isPublicInboundMessage({ kind: 'heartbeat', ref: { ...ref, capabilities: ['admin'] }, nonce: 0 })).toBe(
      false,
    );
    expect(
      isPublicInboundMessage({
        kind: 'player-action',
        ref,
        requestId: 1,
        action: { type: 'respawn', issuer: 'admin' },
      }),
    ).toBe(false);
  });

  it('accepts projected outbound payloads but rejects a copied authority snapshot with diagnostics', () => {
    expect(
      isPublicOutboundMessage({
        kind: 'entity-pose',
        ref,
        poseSequence: 4,
        physicsTick: 20,
        entities: [{ id: 'grazer-1', type: 'creature', archetype: 'grazer', position: [1, 2, 3], velocity: [0, 0, 0] }],
      }),
    ).toBe(true);
    expect(
      isPublicOutboundMessage({
        kind: 'snapshot',
        ref,
        player: { contacts: [] },
        diagnostics: { physicsDebtMs: 123 },
      }),
    ).toBe(false);
  });
});
