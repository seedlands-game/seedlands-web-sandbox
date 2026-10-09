import { describe, expect, it } from 'vitest';
import { FakeAuthorityWorker } from './fixtures/browser-authority';
import { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';

describe('BrowserAuthorityClient receive observation', () => {
  it('measures the actual Worker receive entry, preserves callback errors and stops after disposal', () => {
    const worker = new FakeAuthorityWorker();
    let clock = 10;
    const failure = new Error('consumer failure');
    const client = new BrowserAuthorityClient(worker, 'world:receive', {
      observationNow: () => clock,
      onInputDecision: () => {
        clock += 7;
        throw failure;
      },
    });
    expect(() =>
      worker.emit({
        kind: 'input-decision',
        protocolVersion: 1,
        epoch: 'world:receive',
        sequence: 1,
        decision: 'accepted',
        requiresResync: false,
      }),
    ).toThrow(failure);
    expect(client.receiveWallSnapshot).toMatchObject({ runtimeEpoch: 'world:receive', count: 1, totalWallMs: 7 });
    worker.emit({
      kind: 'input-decision',
      protocolVersion: 1,
      epoch: 'old',
      sequence: 2,
      decision: 'late',
      requiresResync: true,
    });
    expect(client.receiveWallSnapshot).toMatchObject({ count: 2, totalWallMs: 7 });
    expect(Object.isFrozen(client.receiveWallSnapshot)).toBe(true);
    client.dispose();
    expect(client.receiveWallSnapshot).toBeNull();
    expect(worker.onmessage).toBeNull();
  });
});
