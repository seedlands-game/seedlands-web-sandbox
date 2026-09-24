import { describe, expect, it } from 'vitest';
import { classicMedia } from '../src/media';
import { portableItems } from '../src/portable-items';

describe('Classic media declarations', () => {
  it('maps record-13 to the portable Pack audio resource through the jukebox', () => {
    expect(classicMedia).toEqual({
      version: 1,
      tracks: [
        {
          id: 'seedlands:to-far-shores',
          resource: {
            packId: 'seedlands:overworld',
            path: 'playbooks/classic/assets/audio/to-far-shores.mp3',
          },
        },
      ],
      devices: [
        {
          id: 'seedlands:jukebox',
          target: { kind: 'voxel', voxelId: 'seedlands:classic/jukebox' },
          tracks: [{ itemId: 'seedlands:record-13', trackId: 'seedlands:to-far-shores' }],
          playOnInsert: true,
        },
      ],
    });
  });

  it('uses a repository-relative resource without local paths or upload data', () => {
    const resource = classicMedia.tracks[0].resource;
    expect(resource.packId).toBe('seedlands:overworld');
    expect(resource.path).not.toMatch(/^(?:[/\\]|[a-zA-Z]:)/);
    expect(resource.path.split('/')).not.toContain('..');
    expect(resource.path).not.toContain('Downloads');
    expect(JSON.stringify(classicMedia)).not.toMatch(/blob:|data:|File|AudioBuffer/i);
  });

  it('keeps record-cat outside the only declared track mapping', () => {
    const bindings = classicMedia.devices.flatMap((device) => device.tracks);
    expect(portableItems.find(({ id }) => id === 'record-cat')).toMatchObject({ stackLimit: 1 });
    expect(bindings).toHaveLength(1);
    expect(bindings.some(({ itemId }) => itemId === 'seedlands:record-cat')).toBe(false);
    expect(new Set(bindings.map(({ itemId }) => itemId)).size).toBe(bindings.length);
  });
});
