import type { AuthoritySnapshot } from '@seedlands/stdlib/server/authority/authority-session';

type Point = readonly [number, number, number];
type Vector = Readonly<{ x: number; y: number; z: number }>;
const point = (value: Vector): Point => Object.freeze([value.x, value.y, value.z] as const);
const distanceSquared = (left: Vector, right: Vector) =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2;

export type HarnessPhysicsDiagnostics = Readonly<{
  schemaVersion: 1;
  diagnosticOnly: true;
  epoch: string;
  physicsTick: number;
  acknowledgedInputSequence: number;
  player: Readonly<{
    id: string;
    position: Point;
    velocity: Point;
    grounded: boolean;
    contacts: Readonly<{
      count: number;
      truncated: boolean;
      entries: readonly Readonly<{ colliderId: string | null; normal: Point; point: Point }>[];
    }>;
  }>;
  bodies: Readonly<{
    sourceCount: number;
    scannedCount: number;
    scanTruncated: boolean;
    nearbyCount: number;
    truncated: boolean;
    entries: readonly Readonly<{ id: string; type: string; archetype?: string; position: Point; velocity: Point }>[];
  }>;
}>;

/** Copies one accepted publication; nearby body positions do not establish contact. */
export function projectHarnessPhysicsDiagnostics(snapshot: AuthoritySnapshot): HarnessPhysicsDiagnostics {
  const player = snapshot.player;
  const position = player.body.position;
  const scanned = snapshot.entities.slice(0, 128);
  const nearby = scanned
    .filter((entry) => entry.id !== player.id && distanceSquared(entry.body.position, position) <= 64)
    .sort((left, right) => {
      const delta = distanceSquared(left.body.position, position) - distanceSquared(right.body.position, position);
      return delta || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    });
  const scanTruncated = scanned.length < snapshot.entities.length;
  return Object.freeze({
    schemaVersion: 1,
    diagnosticOnly: true,
    epoch: snapshot.epoch,
    physicsTick: snapshot.physicsTick,
    acknowledgedInputSequence: snapshot.acknowledgedInputSequence,
    player: Object.freeze({
      id: player.id,
      position: point(position),
      velocity: point(player.body.velocity),
      grounded: player.grounded,
      contacts: Object.freeze({
        count: player.contacts.length,
        truncated: player.contacts.length > 16,
        entries: Object.freeze(
          player.contacts.slice(0, 16).map((contact) =>
            Object.freeze({
              colliderId: contact.colliderId ?? null,
              normal: point(contact.normal),
              point: point(contact.point),
            }),
          ),
        ),
      }),
    }),
    bodies: Object.freeze({
      sourceCount: snapshot.entities.length,
      scannedCount: scanned.length,
      scanTruncated,
      nearbyCount: nearby.length,
      truncated: scanTruncated || nearby.length > 8,
      entries: Object.freeze(
        nearby.slice(0, 8).map((entry) =>
          Object.freeze({
            id: entry.id,
            type: entry.type,
            ...(entry.archetype ? { archetype: entry.archetype } : {}),
            position: point(entry.body.position),
            velocity: point(entry.body.velocity),
          }),
        ),
      ),
    }),
  });
}
