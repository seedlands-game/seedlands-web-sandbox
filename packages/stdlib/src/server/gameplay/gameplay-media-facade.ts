import type { VoxelSemanticsResolver } from '../../world/voxel-semantics';
import type { MediaTargetPortV1 } from './gameplay-media-target-runtime';
import type { RegisteredMediaPlaybackRuntime } from './modules/registered-media-playback-runtime';

export class GameplayMediaFacade {
  constructor(
    readonly owner: RegisteredMediaPlaybackRuntime | null,
    readonly targets: MediaTargetPortV1 | null,
    private readonly semantics: VoxelSemanticsResolver,
  ) {}

  projections = () => this.owner?.projections() ?? Object.freeze([]);
  takeCommittedFacts = () => this.owner?.takeCommittedFacts() ?? Object.freeze([]);
  checkpointPositions = () => this.owner?.positions() ?? [];
  validateCheckpoint = (readVoxel: (position: readonly [number, number, number]) => number | undefined) =>
    this.owner?.validateInstalledDevices((position) => {
      const voxel = readVoxel(position);
      return voxel === undefined ? undefined : this.semantics.get(voxel)?.id;
    });
}
