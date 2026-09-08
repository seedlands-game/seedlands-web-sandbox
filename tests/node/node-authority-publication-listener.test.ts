import { describe, expect, it, vi } from 'vitest';
import { notifyAuthorityPublicationListeners } from '../../apps/node-server/src/node/runtime/node-authority-publication-listeners';

describe('Node authority publication listeners', () => {
  it('isolates a failing network listener from the authority lane', () => {
    const healthy = vi.fn();
    const failure = new Error('socket send failed');
    const onFailure = vi.fn();
    expect(() =>
      notifyAuthorityPublicationListeners(
        new Set([
          Object.assign(
            () => {
              throw failure;
            },
            { onFailure },
          ),
          healthy,
        ]),
        { snapshot: {}, commits: [] } as never,
      ),
    ).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
