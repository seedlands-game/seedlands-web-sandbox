import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ModStateAddress } from '../../composition/operation-contracts';
import {
  buildMediaPlaybackCandidateV1,
  defineMediaPlaybackModelV1,
  restoreMediaPlaybackStateV1,
  type MediaDeviceDefinitionV1,
  type MediaPlaybackActionV1,
  type MediaPlaybackModelV1,
  type MediaTrackDefinitionV1,
} from './media-playback-model';

export const MEDIA_PLAYBACK_MODULE_ID = 'seedlands:media-playback-module';
export const MEDIA_PLAYBACK_CAPABILITY = 'seedlands:media-playback';
export const MEDIA_PLAYBACK_COMPONENT = 'seedlands:media-playback-device';
export const MEDIA_PLAYBACK_RESOURCE = 'seedlands.media-playback';
export const MEDIA_INSERT_OPERATION = 'seedlands:media-insert';
export const MEDIA_INSERT_AND_ACTIVATE_OPERATION = 'seedlands:media-insert-and-activate';
export const MEDIA_EJECT_OPERATION = 'seedlands:media-eject';
export const MEDIA_ACTIVATE_OPERATION = 'seedlands:media-activate';
export const MEDIA_STOP_OPERATION = 'seedlands:media-stop';
export const MEDIA_SWITCH_OPERATION = 'seedlands:media-switch';

export type MediaPlaybackModuleDefinitionV1 = Readonly<{
  version: 1;
  tracks: readonly MediaTrackDefinitionV1[];
  devices: readonly MediaDeviceDefinitionV1[];
}>;

export type MediaPlaybackCapabilityV1 = Readonly<{
  resolve(): MediaPlaybackModelV1;
}>;

export const mediaPlaybackAddress = (target: ModStateAddress['target']): ModStateAddress =>
  Object.freeze({ componentId: MEDIA_PLAYBACK_COMPONENT, target });

type InvocationRecord = Readonly<Record<string, ModuleInvocationValue>>;

const isInvocationRecord = (value: ModuleInvocationValue | undefined): value is InvocationRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const inputRecord = (value: ModuleInvocationValue | undefined): InvocationRecord => {
  if (!isInvocationRecord(value)) throw new TypeError('Media playback operation input is invalid.');
  return value;
};

const operationInput = (
  value: ModuleInvocationValue | undefined,
  kind: MediaPlaybackActionV1['kind'],
): Readonly<{ expectedRevision: number; action: MediaPlaybackActionV1 }> => {
  const input = inputRecord(value);
  const withItem = kind === 'insert' || kind === 'insert-and-activate' || kind === 'switch';
  const allowed = new Set(withItem ? ['expectedRevision', 'itemId'] : ['expectedRevision']);
  if (
    Object.keys(input).some((key) => !allowed.has(key)) ||
    !Object.hasOwn(input, 'expectedRevision') ||
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) < 0
  )
    throw new TypeError('Media playback operation input is invalid.');
  if (withItem) {
    if (!Object.hasOwn(input, 'itemId') || typeof input.itemId !== 'string')
      throw new TypeError('Media playback item input is invalid.');
    return Object.freeze({
      expectedRevision: input.expectedRevision as number,
      action: Object.freeze({ kind, itemId: input.itemId }),
    });
  }
  return Object.freeze({ expectedRevision: input.expectedRevision as number, action: Object.freeze({ kind }) });
};

const mediaTarget = (target: ModStateAddress['target']): Extract<ModStateAddress['target'], { kind: 'voxel' }> => {
  if (target.kind !== 'voxel') throw new TypeError('Media playback requires a voxel device target.');
  return target;
};

export function defineMediaPlaybackModuleV1(
  input: Readonly<{
    moduleId?: string;
    definition: MediaPlaybackModuleDefinitionV1;
  }>,
): ModModule {
  const moduleId = input.moduleId ?? MEDIA_PLAYBACK_MODULE_ID;
  let model: MediaPlaybackModelV1 | undefined;
  const resolve = () => (model ??= defineMediaPlaybackModelV1(input.definition));
  return Object.freeze({
    descriptor: {
      id: moduleId,
      version: '1.0.0',
      provides: [{ id: MEDIA_PLAYBACK_CAPABILITY, version: '1.0.0' }],
      resources: [{ id: MEDIA_PLAYBACK_RESOURCE, operations: ['read', 'write', 'execute'] }],
      permissions: [{ resource: MEDIA_PLAYBACK_RESOURCE, operations: ['read', 'write', 'execute'] }],
    },
    register(api) {
      api.provideCapability<MediaPlaybackCapabilityV1>(MEDIA_PLAYBACK_CAPABILITY, Object.freeze({ resolve }));
      api.onDefinitionsReady(() => {
        const defined = resolve();
        const content = api.readContentDefinitions();
        const items = new Map(content.items.map((item) => [item.id, item]));
        const voxelIds = new Set(content.voxels.map((voxel) => voxel.id));
        for (const device of defined.devices) {
          if (!voxelIds.has(device.target.voxelId))
            throw new TypeError(`Media device ${device.id} references unknown voxel: ${device.target.voxelId}`);
          for (const binding of device.tracks) {
            const item = items.get(binding.itemId);
            if (!item) throw new TypeError(`Media device ${device.id} references unknown item: ${binding.itemId}`);
            if (item.durability !== undefined)
              throw new TypeError(
                `Media device ${device.id} cannot bind an item with instance state: ${binding.itemId}`,
              );
          }
        }
      });
      api.registerState({
        id: MEDIA_PLAYBACK_COMPONENT,
        version: '1.0.0',
        resource: MEDIA_PLAYBACK_RESOURCE,
        validate(value) {
          try {
            if (!value || typeof value !== 'object' || Array.isArray(value) || !('deviceId' in value)) return false;
            const keys = new Set(['version', 'deviceId', 'revision', 'slot', 'playing', 'resumePending']);
            if (Object.keys(value).length !== keys.size || Object.keys(value).some((key) => !keys.has(key)))
              return false;
            if (value.version !== 1 || typeof value.deviceId !== 'string') return false;
            restoreMediaPlaybackStateV1(resolve(), String(value.deviceId), {
              version: 1,
              deviceId: value.deviceId,
              revision: value.revision,
              slot: value.slot,
              playingIntent: Boolean(value.playing || value.resumePending),
            });
            return (
              (value.playing === true || value.playing === false) &&
              (value.resumePending === true || value.resumePending === false) &&
              !(value.playing && value.resumePending)
            );
          } catch {
            return false;
          }
        },
      });

      const register = (id: string, kind: MediaPlaybackActionV1['kind']) =>
        api.registerOperation({
          id,
          resource: MEDIA_PLAYBACK_RESOURCE,
          run(context, value, state) {
            const target = mediaTarget(context.target);
            const parsed = operationInput(value, kind);
            const address = mediaPlaybackAddress(target);
            const current = state.read(address);
            const device = resolve().devices.find((entry) => entry.id === (current as { deviceId?: string }).deviceId);
            if (!device) throw new TypeError('Media playback device definition is unavailable.');
            const candidate = buildMediaPlaybackCandidateV1({
              model: resolve(),
              device: { kind: 'voxel', position: target.position, definitionId: device.id },
              state: current as Parameters<typeof buildMediaPlaybackCandidateV1>[0]['state'],
              expectedRevision: parsed.expectedRevision,
              action: parsed.action,
            });
            state.write(address, candidate.state);
            return candidate.fact;
          },
        });

      register(MEDIA_INSERT_OPERATION, 'insert');
      register(MEDIA_INSERT_AND_ACTIVATE_OPERATION, 'insert-and-activate');
      register(MEDIA_EJECT_OPERATION, 'eject');
      register(MEDIA_ACTIVATE_OPERATION, 'activate');
      register(MEDIA_STOP_OPERATION, 'stop');
      register(MEDIA_SWITCH_OPERATION, 'switch');
    },
  } satisfies ModModule);
}
