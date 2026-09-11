import {
  DIRECT_LOGIC_PROTOCOL_VERSION,
  type DirectLogicAttachRequest,
  type DirectLogicDiagnostics,
} from '../../worker/authority-worker-direct-logic-protocol';

export type { DirectLogicDiagnostics } from '../../worker/authority-worker-direct-logic-protocol';

export const clientFailure = (error: Error) => new Error(`Authority client failed: ${error.message}`, { cause: error });

type WorkerPort = Readonly<{
  postMessage(message: unknown, transfer?: Transferable[]): void;
}>;

export class BrowserAuthorityDirectLogic {
  private attached = false;
  private diagnostics: ((value: DirectLogicDiagnostics) => void) | null = null;

  constructor(
    private readonly worker: WorkerPort,
    private readonly transportEpoch: string,
  ) {}

  attach(port: MessagePort, diagnostics: (value: DirectLogicDiagnostics) => void, unavailable: boolean): void {
    if (unavailable) throw new Error('Direct Logic port must attach before Authority start.');
    if (this.attached) throw new Error('Direct Logic port is already attached.');
    this.attached = true;
    this.diagnostics = diagnostics;
    this.worker.postMessage(
      {
        kind: 'attach-direct-logic',
        protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
        epoch: this.transportEpoch,
        port,
      } satisfies DirectLogicAttachRequest,
      [port],
    );
  }

  receive(message: unknown, runtimeEpoch: string, disposed: boolean): boolean {
    if (!message || (message as { kind?: unknown }).kind !== 'direct-logic-diagnostics') return false;
    const value = message as DirectLogicDiagnostics;
    if (!disposed && value.protocolVersion === DIRECT_LOGIC_PROTOCOL_VERSION && value.epoch === runtimeEpoch)
      this.diagnostics?.(value);
    return true;
  }

  close(): void {
    this.diagnostics = null;
  }
}
