import type { VerifiedPackArtifact } from './contracts';
import type { OperationRegistrations } from './operation-contracts';

export function snapshotPackLock(artifacts: readonly VerifiedPackArtifact[]) {
  return Object.freeze(
    artifacts.map(({ manifest, integrity }) =>
      Object.freeze({
        id: manifest.id,
        version: manifest.version,
        integrity: Object.freeze({
          algorithm: integrity.algorithm,
          manifestDigest: integrity.manifestDigest,
          entryDigest: integrity.entryDigest,
          resources: Object.freeze(
            [...integrity.resources]
              .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
              .map((value) => Object.freeze({ path: value.path, digest: value.digest })),
          ),
        }),
      }),
    ),
  );
}

export function snapshotOperationIdentity(registrations: OperationRegistrations) {
  return Object.freeze({
    stateCodecs: Object.freeze(
      registrations.states.map(({ moduleId, definition }) =>
        Object.freeze({ id: definition.id, version: definition.version, resource: definition.resource, moduleId }),
      ),
    ),
    operations: Object.freeze(
      registrations.operations.map(({ moduleId, definition }) =>
        Object.freeze({
          id: definition.id,
          resource: definition.resource,
          moduleId,
          executionKind: definition.executionKind ?? 'actor',
        }),
      ),
    ),
    rules: Object.freeze(
      registrations.rules.map(({ moduleId, definition }) =>
        Object.freeze({
          id: definition.id,
          operationId: definition.operationId,
          moduleId,
          stage: definition.stage ?? 'after',
        }),
      ),
    ),
  });
}
