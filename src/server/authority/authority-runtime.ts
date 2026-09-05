import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import type { InputCommand, SequenceDecision } from '../../runtime/session-protocol';
import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityMeshPayload,
  AuthorityReady,
} from '../../worker/authority-worker-protocol';
import { CHUNK_SIZE, floorDiv } from '../../world/voxel';
import { GameServer } from '../game-server';
import type { WorldCommitResult } from '../game-server-types';
import type { ChunkPersistence } from '../persistence/chunk-persistence';
import type { GameplayPersistence } from '../persistence/gameplay-persistence';
import { findSafePlayerSpawn } from '../gameplay/safe-spawn';
import type { FluidAuthoritySnapshot, FluidCandidate } from '../fluid/fluid-transaction';
import type { VoxelEdit } from '../world-mutation';
import { AuthoritySession, type AuthoritySnapshot, type LogicIntent } from './authority-session';

const LEGACY_PLAYER_EYE_HEIGHT = 1.6;

type AuthorityPersistence = ChunkPersistence & Partial<GameplayPersistence>;

export type AuthorityRuntimeOptions = Readonly<{
  epoch: string;
  seedText: string;
  persistence?: AuthorityPersistence;
  generatorVersion?: number;
  initialWorldTime: number;
  startTimeMs: number;
  frequencies?: Readonly<{ physicsHz: 30 | 60 | 120; gameplayHz: 10 | 20; fluidHz: 20 | 30 }>;
  onFluidWork?: (snapshot: FluidAuthoritySnapshot) => void;
  onLogicObservation?: (sequence: number, snapshot: AuthoritySnapshot) => void;
  onUnknownChunk?: (key: string) => void;
}>;

export class AuthorityRuntime {
  readonly server: GameServer;
  readonly playerId: string;
  private readonly session: AuthoritySession;
  private readonly newPlayer: boolean;
  private readonly initialBodyPosition: [number, number, number];
  private pendingCommits: WorldCommitResult[] = [];
  private logicObservationSequence = 0;

  private constructor(
    private readonly options: AuthorityRuntimeOptions,
    server: GameServer,
    playerId: string,
    isNew: boolean,
  ) {
    this.server = server;
    this.playerId = playerId;
    this.newPlayer = isNew;
    const player = server.getEntity(playerId);
    if (!player) throw new Error(`Authority player is missing: ${playerId}`);
    this.initialBodyPosition = [...player.position];
    const serverPort = {
      get worldRevision() {
        return server.worldRevision;
      },
      get worldTime() {
        return server.worldTime;
      },
      getEntity: (id: string) => server.getEntity(id),
      queryEntities: () => server.queryEntities(),
      updateEntity: (id: string, update: Parameters<GameServer['updateEntity']>[1]) => server.updateEntity(id, update),
      advanceGameplayRules: (seconds: number) => {
        const result = server.advanceGameplayRules(seconds);
        this.pendingCommits.push(...result.commits);
        return result;
      },
    };
    this.session = new AuthoritySession({
      epoch: options.epoch,
      playerId,
      server: serverPort,
      bodyConfigFor: (entity) => bodyConfigFor(bodyKindForEntity(entity)),
      voxelSource: { getLoadedVoxel: (x, y, z) => server.peekLoadedVoxel(x, y, z) },
      frequencies: options.frequencies ?? { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: options.startTimeMs,
      requestUnknownChunk: (key) => this.requestUnknownChunk(key),
      requestFluidWork: () => this.requestFluidWork(),
      publishLogicObservation: (snapshot) => options.onLogicObservation?.(++this.logicObservationSequence, snapshot),
    });
  }

  static async create(options: AuthorityRuntimeOptions): Promise<AuthorityRuntime> {
    const server = new GameServer({
      seedText: options.seedText,
      ...(options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion }),
      ...(options.persistence ? { persistence: options.persistence } : {}),
    });
    server.setWorldTime(options.initialWorldTime);
    await server.restore();
    let player = server.queryEntities({ type: 'player' })[0];
    const isNew = !player;
    if (!player) {
      const legacyCameraPosition = findSafePlayerSpawn((x, y, z) => server.getVoxel(x, y, z));
      if (!legacyCameraPosition) throw new Error('附近没有安全的干燥出生点，请尝试另一个 Seed。');
      const bodyPosition: [number, number, number] = [
        legacyCameraPosition[0],
        legacyCameraPosition[1] - LEGACY_PLAYER_EYE_HEIGHT,
        legacyCameraPosition[2],
      ];
      player = server.spawnPlayer({ position: bodyPosition });
    }
    await server.ensureChunkNeighborhood(
      floorDiv(player.position[0], CHUNK_SIZE),
      floorDiv(player.position[1], CHUNK_SIZE),
      floorDiv(player.position[2], CHUNK_SIZE),
    );
    server.getChunk(
      floorDiv(player.position[0], CHUNK_SIZE),
      floorDiv(player.position[1], CHUNK_SIZE),
      floorDiv(player.position[2], CHUNK_SIZE),
    );
    server.initializeStarterEcology(player.position);
    return new AuthorityRuntime(options, server, player.id, isNew);
  }

  ready(): AuthorityReady {
    const camp = this.server.queryPois(this.initialBodyPosition, 40, 'camp')[0];
    return {
      playerId: this.playerId,
      playerBodyPosition: [...this.initialBodyPosition],
      isNew: this.newPlayer,
      seed: this.server.seed,
      seedText: this.options.seedText,
      generatorVersion: this.server.generatorVersion,
      worldTime: this.server.worldTime,
      snapshot: this.session.wake(this.options.startTimeMs),
      gameplay: this.view(),
      ...(camp ? { campPosition: [...camp.position] as [number, number, number] } : {}),
    };
  }

  wake(nowMs: number): AuthoritySnapshot {
    return this.session.wake(nowMs);
  }

  receiveInput(command: InputCommand): SequenceDecision {
    return this.session.receiveInput(command);
  }

  receiveLogicIntents(epoch: string, intents: readonly LogicIntent[]): boolean {
    return this.session.receiveLogicIntents(epoch, intents);
  }

  pause(nowMs: number): void {
    this.session.pause(nowMs);
  }

  resume(nowMs: number): void {
    this.session.resume(nowMs);
  }

  async prepareMesh(cx: number, cy: number, cz: number): Promise<AuthorityMeshPayload> {
    await this.server.ensureChunkNeighborhood(cx, cy, cz);
    const snapshot = this.server.createDerivedMeshSnapshot(cx, cy, cz);
    return {
      key: snapshot.key,
      cx,
      cy,
      cz,
      chunkRevision: snapshot.chunkRevision,
      generatorVersion: this.server.generatorVersion,
      canonical: snapshot.canonical.slice().buffer,
      halo: snapshot.halo.slice().buffer,
      fluid: snapshot.fluid.slice().buffer,
      fluidHalo: snapshot.fluidHalo.slice().buffer,
      haloRevision: snapshot.haloRevision,
    };
  }

  releaseMesh(cx: number, cy: number, cz: number): void {
    this.server.releaseChunkNeighborhood(cx, cy, cz);
  }

  setFluidActiveChunks(keys: readonly string[]): void {
    this.server.setFluidActiveChunks(keys);
  }

  editWorld(actorId: string, edits: readonly VoxelEdit[]) {
    const result = this.server.editBatch({ actorId, edits });
    if (result.committed) this.pendingCommits.push(result);
    return result;
  }

  setPlayerPosition(position: [number, number, number]): void {
    this.server.updateEntity(this.playerId, { position, physicsVelocity: [0, 0, 0] });
    this.session.synchronizeExternalState();
  }

  performAction(action: AuthorityAction): AuthorityActionResult {
    let result: unknown;
    switch (action.type) {
      case 'select-hotbar':
        result = this.server.selectHotbarSlot(this.playerId, action.slot);
        break;
      case 'craft':
        result = this.server.craft(this.playerId, action.recipeId);
        break;
      case 'attack':
        result = this.server.attackEntity(this.playerId, action.targetId);
        break;
      case 'begin-break':
        result = this.server.beginBreak(this.playerId, action.position);
        break;
      case 'cancel-break':
        result = this.server.cancelBreak(this.playerId);
        break;
      case 'place': {
        result = this.server.placeVoxel(this.playerId, action.position);
        const commit = (result as { success?: boolean; commit?: WorldCommitResult }).commit;
        if (commit) this.pendingCommits.push(commit);
        break;
      }
      case 'respawn':
        result = this.server.respawnPlayer(this.playerId);
        this.session.synchronizeExternalState();
        break;
      case 'move-inventory':
        result = this.server.moveInventorySlot(this.playerId, action.source, action.target);
        break;
      case 'use-inventory':
        result = this.server.useInventoryItem(this.playerId, action.slot);
        break;
    }
    return { result, gameplay: this.view(), commits: this.takeCommits() };
  }

  commitFluidCandidate(candidate: FluidCandidate) {
    const result = this.server.commitFluidCandidate(candidate);
    if (result.accepted && result.commit?.committed) this.pendingCommits.push(result.commit);
    return result;
  }

  abortFluidWork(workId: string, reason: string): boolean {
    return this.server.abortFluidWork(workId, reason);
  }

  async save() {
    return this.server.save();
  }

  view(): AuthorityGameplayView {
    return {
      gameplayRevision: this.server.gameplayRevision,
      gameplayTime: this.server.gameplayTime,
      player: this.server.getPlayerState(this.playerId),
      entities: this.server.queryEntities(),
      actors: this.server.simulationSnapshot().actors,
      craftableRecipeIds: this.server.listCraftableRecipes(this.playerId).map((recipe) => recipe.id),
      metrics: this.server.gameplayMetrics(),
    };
  }

  takeCommits(): WorldCommitResult[] {
    return this.pendingCommits.splice(0);
  }

  private requestFluidWork(): void {
    const snapshot = this.server.requestFluidWork();
    if (snapshot) this.options.onFluidWork?.(snapshot);
  }

  private requestUnknownChunk(key: string): void {
    this.options.onUnknownChunk?.(key);
    const [cx, cy, cz] = key.split(',').map(Number);
    void this.server.ensureChunkNeighborhood(cx, cy, cz).then(() => {
      this.server.getChunk(cx, cy, cz);
    });
  }
}
