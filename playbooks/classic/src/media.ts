type MediaPlaybackModelInputV1 = Readonly<{
  version: 1;
  tracks: readonly Readonly<{ id: string; resource: Readonly<{ packId: string; path: string }> }>[];
  devices: readonly Readonly<{
    id: string;
    target: Readonly<{ kind: 'voxel'; voxelId: string }>;
    tracks: readonly Readonly<{ itemId: string; trackId: string }>[];
    playOnInsert?: true;
  }>[];
}>;

export const classicMedia = {
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
} as const satisfies MediaPlaybackModelInputV1;
