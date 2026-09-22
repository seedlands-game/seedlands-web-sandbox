export const LEGACY_ACTOR_ARCHETYPES = [
  'grazer',
  'night-stalker',
  'settler',
  'chicken',
  'cow',
  'pig',
  'pig-zombie',
  'sheep',
  'squid',
  'wolf',
  'zombie',
  'skeleton',
  'spider',
  'creeper',
  'slime',
] as const;

export type EcsActorArchetype = string;
const ACTOR_ARCHETYPE_MAX_LENGTH = 96;
const NAMESPACED_ACTOR_ARCHETYPE = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const LEGACY_ACTOR_ARCHETYPE_SET = new Set<string>(LEGACY_ACTOR_ARCHETYPES);

/** Syntax admission only; a composed ActorProfileRegistry authorizes world membership. */
export const isActorArchetype = (value: unknown): value is EcsActorArchetype =>
  typeof value === 'string' &&
  value.length <= ACTOR_ARCHETYPE_MAX_LENGTH &&
  (LEGACY_ACTOR_ARCHETYPE_SET.has(value) || NAMESPACED_ACTOR_ARCHETYPE.test(value));
