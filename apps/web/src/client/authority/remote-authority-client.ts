export class RemoteAuthorityClient {
  private unsupported(): Promise<never> {
    return Promise.reject(new Error('远端模式不开放本地管理操作。'));
  }

  editWorld(_actorId: string, _edits: readonly unknown[]): Promise<never> {
    return this.unsupported();
  }

  setPlayerPosition(_position: [number, number, number]): Promise<never> {
    return this.unsupported();
  }

  setWorldTime(_hours: number): Promise<never> {
    return this.unsupported();
  }
}
