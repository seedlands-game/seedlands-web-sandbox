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

  it('also isolates a broken per-listener cleanup callback', () => {
    const healthy = vi.fn();
    const broken = Object.assign(
      () => {
        throw new Error('encode failed');
      },
      {
        onFailure: () => {
          throw new Error('socket close failed');
        },
      },
    );
    expect(() => notifyAuthorityPublicationListeners(new Set([broken, healthy]), {} as never)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});
