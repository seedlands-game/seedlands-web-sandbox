import type { WorkspaceBinding } from './types.js';

const MAX_COMPONENT_BYTES = 512;

function validateComponent(name: keyof WorkspaceBinding, value: string): string {
  if (!value || new TextEncoder().encode(value).byteLength > MAX_COMPONENT_BYTES) {
    throw new Error(`invalid workspace binding component: ${name}`);
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) throw new Error(`invalid workspace binding component: ${name}`);
  }
  return value;
}

function hexComponent(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `${bytes.byteLength.toString(16)}-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function normalizeWorkspaceBinding(binding: WorkspaceBinding): WorkspaceBinding {
  return {
    worldId: validateComponent('worldId', binding.worldId),
    timelineId: validateComponent('timelineId', binding.timelineId),
    actorId: validateComponent('actorId', binding.actorId),
    incarnation: validateComponent('incarnation', binding.incarnation),
  };
}

export function createWorkspaceNamespace(binding: WorkspaceBinding): string {
  const trusted = normalizeWorkspaceBinding(binding);
  return `npc-${[trusted.worldId, trusted.timelineId, trusted.actorId, trusted.incarnation].map(hexComponent).join('-')}`;
}

export function createWorkspaceStoreNamespace(binding: WorkspaceBinding): string[] {
  return ['seedlands', 'npc', createWorkspaceNamespace(binding).slice('npc-'.length), 'workspace'];
}

export function createWorkspaceThreadId(binding: WorkspaceBinding): string {
  return createWorkspaceNamespace(binding);
}
