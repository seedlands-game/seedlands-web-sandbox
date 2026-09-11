import { describe, expect, it } from 'vitest';
import { decodeC0Envelope, encodeC0Envelope } from '../../src/server/protocol/network-c0-codec';
import { isPublicInboundMessage } from '../../src/server/protocol/network-message-semantics';

const utf8 = {
  encode: (value: string) => new TextEncoder().encode(value),
  decodeFatal: (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value),
};

describe('playable public network protocol', () => {
  it('accepts only a bounded credential hello before a session exists', () => {
    const hello = {
      kind: 'session-hello',
      protocolVersion: 1,
      transport: 'experimental-local-c0-v1',
      accessKey: 'synthetic-test-key',
    } as const;
    const bytes = encodeC0Envelope({ messageClass: 'session-hello', message: hello, blocks: [] }, utf8);
    expect(decodeC0Envelope(bytes, utf8).message).toEqual(hello);
    expect(isPublicInboundMessage({ ...hello, accessKey: 'x'.repeat(257) })).toBe(false);
  });

  it('rejects internal authority methods and arbitrary capabilities', () => {
    const ref = {
      protocolVersion: 1,
      sessionEpoch: 'client-1',
      worldId: 'world-1',
      playerId: 'player-1',
    } as const;
    expect(isPublicInboundMessage({ kind: 'authority-request', ref, method: 'editWorld' })).toBe(false);
    expect(
      isPublicInboundMessage({ kind: 'heartbeat', ref: { ...ref, capabilities: ['administrative'] }, nonce: 1 }),
    ).toBe(false);
  });

  it('limits playable interest to one canonical main chunk per request', () => {
    const ref = {
      protocolVersion: 1,
      sessionEpoch: 'client-1',
      worldId: 'world-1',
      playerId: 'player-1',
    } as const;
    expect(isPublicInboundMessage({ kind: 'interest-update', ref, requestId: 1, keys: ['0,1,0'] })).toBe(true);
    expect(isPublicInboundMessage({ kind: 'interest-update', ref, requestId: 2, keys: ['0,1,0', '1,1,0'] })).toBe(
      false,
    );
    expect(isPublicInboundMessage({ kind: 'interest-update', ref, requestId: 3, keys: ['not-a-chunk'] })).toBe(false);
  });
});
