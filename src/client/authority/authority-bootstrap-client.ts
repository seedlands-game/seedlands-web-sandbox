import type {
  AuthorityBootstrapGeneration,
  AuthorityRequest,
  AuthorityResponse,
} from '../../worker/authority-worker-protocol';

type BootstrapRequest = Extract<AuthorityResponse, { kind: 'authority-bootstrap-needed' }>;
type GenerateBootstrap = (request: { seed: number; generatorVersion: number }) => Promise<AuthorityBootstrapGeneration>;
type PostBootstrap = (message: AuthorityRequest, transfer: Transferable[]) => void;

export async function provideAuthorityBootstrap(
  message: BootstrapRequest,
  generate: GenerateBootstrap | undefined,
  post: PostBootstrap,
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

export class AuthorityBootstrapCoordinator {
  private requestId: number | null = null;

  constructor(
    private readonly generate: GenerateBootstrap | undefined,
    private readonly post: PostBootstrap,
    private readonly fail: (error: Error) => void,
  ) {}

  receive(message: BootstrapRequest): void {
    if (message.requestId === this.requestId) return;
    if (this.requestId !== null) return this.fail(new Error('Authority requested multiple bootstrap identities.'));
    this.requestId = message.requestId;
    void provideAuthorityBootstrap(message, this.generate, this.post).catch((error) =>
      this.fail(error instanceof Error ? error : new Error(String(error))),
    );
  }
}
