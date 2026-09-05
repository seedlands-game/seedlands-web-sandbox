import type {
  AuthorityBootstrapGeneration,
  AuthorityRequest,
  AuthorityResponse,
} from '../worker/authority-worker-protocol';

type BootstrapRequest = Extract<AuthorityResponse, { kind: 'authority-bootstrap-needed' }>;

export async function provideAuthorityBootstrap(
  message: BootstrapRequest,
  generate:
    ((request: { seed: number; generatorVersion: number }) => Promise<AuthorityBootstrapGeneration>) | undefined,
  post: (message: AuthorityRequest, transfer: Transferable[]) => void,
): Promise<void> {
  if (!generate) throw new Error('Authority requested safe spawn generation without a compute provider.');
  const bootstrap = await generate({ seed: message.seed, generatorVersion: message.generatorVersion });
  post(
    {
      kind: 'authority-bootstrap-result',
      protocolVersion: message.protocolVersion,
      epoch: message.epoch,
      requestId: message.requestId,
      playerBodyPosition: bootstrap.playerBodyPosition,
      starterChunks: bootstrap.starterChunks,
    },
    bootstrap.starterChunks.map((chunk) => chunk.canonical),
  );
}
