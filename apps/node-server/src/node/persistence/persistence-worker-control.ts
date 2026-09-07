import type { MessagePort } from 'node:worker_threads';
import type { NodeRpcDiagnostics, NodeRpcLimits } from '../runtime/node-rpc-contract';
import type { FileGamePersistenceOptions } from './file-game-persistence';
import type { PersistenceLaneIdentity } from './persistence-lane-protocol';

export type NodePersistenceStoreOptions = Omit<FileGamePersistenceOptions, 'faultInjector'>;

export type PersistenceWorkerBootstrap = Readonly<{
  type: 'persistence-worker-bootstrap';
  epoch: string;
  generation: number;
  port: MessagePort;
  store: NodePersistenceStoreOptions;
  rpcLimits: NodeRpcLimits;
}>;

export type PersistenceWorkerControlRequest = Readonly<{
  type: 'persistence-worker-close';
  epoch: string;
  generation: number;
}>;

export type PersistenceWorkerControlEvent =
  | Readonly<{
      type: 'persistence-worker-ready';
      epoch: string;
      generation: number;
      threadId: number;
      identity: PersistenceLaneIdentity;
      rpc: NodeRpcDiagnostics;
    }>
  | Readonly<{
      type: 'persistence-worker-store-closed';
      epoch: string;
      generation: number;
      rpc: NodeRpcDiagnostics;
    }>
  | Readonly<{
      type: 'persistence-worker-fatal';
      epoch: string;
      generation: number;
      error: string;
    }>;

export function isPersistenceWorkerControlEvent(value: unknown): value is PersistenceWorkerControlEvent {
  const event = value as Partial<PersistenceWorkerControlEvent>;
  return (
    event?.type === 'persistence-worker-ready' ||
    event?.type === 'persistence-worker-store-closed' ||
    event?.type === 'persistence-worker-fatal'
  );
}
