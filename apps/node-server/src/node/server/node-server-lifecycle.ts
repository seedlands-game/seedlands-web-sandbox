type StopResult = Readonly<{ durableCommitSequence: number }>;
type LifecycleRuntime = Readonly<{
  epoch: string;
  authorityThreadId: number;
  persistenceThreadId: number;
  authority: { readDiagnostics(): Promise<{ host: { durableCommitSequence: number } }> };
  stop(): Promise<StopResult>;
  whenStopped(): Promise<StopResult>;
  whenFailed(): Promise<Error>;
}>;
type Signal = 'SIGINT' | 'SIGTERM';
type LifecycleOutput = Readonly<{
  computeMode: string;
  signals: {
    on(signal: Signal, listener: () => void): unknown;
    off(signal: Signal, listener: () => void): unknown;
  };
  emit(event: Readonly<Record<string, unknown>>): unknown;
  stopFailure(error: unknown): void;
}>;

/** 信号监听覆盖异步创建与诊断窗口；关停意图优先于 ready 发布。 */
export async function runNodeServerLifecycle(
  create: () => Promise<LifecycleRuntime>,
  output: LifecycleOutput,
): Promise<void> {
  let runtime: LifecycleRuntime | undefined;
  let requested = false;
  let stopping: Promise<StopResult> | undefined;
  const stop = () => {
    requested = true;
    if (!runtime || stopping) return;
    stopping = runtime.stop();
    void stopping.catch(output.stopFailure);
  };
  output.signals.on('SIGINT', stop);
  output.signals.on('SIGTERM', stop);
  try {
    runtime = await create();
    // 逻辑失败先触发关停期限；物理清理仍由 whenStopped 持续跟踪。
    void runtime.whenFailed().then(stop);
    if (requested) stop();
    else {
      try {
        const diagnostics = await runtime.authority.readDiagnostics();
        if (!requested)
          output.emit({
            kind: 'ready',
            epoch: runtime.epoch,
            computeMode: output.computeMode,
            authorityThreadId: runtime.authorityThreadId,
            persistenceThreadId: runtime.persistenceThreadId,
            durableCommitSequence: diagnostics.host.durableCommitSequence,
          });
      } catch (error) {
        // 关停使诊断通道关闭时，仍以真实关停结果决定成功或失败。
        if (!requested) throw error;
      }
    }
    const result = await runtime.whenStopped();
    output.emit({ kind: 'stopped', durableCommitSequence: result.durableCommitSequence });
  } catch (error) {
    if (runtime) {
      stop();
      await stopping?.catch(() => undefined);
    }
    throw error;
  } finally {
    output.signals.off('SIGINT', stop);
    output.signals.off('SIGTERM', stop);
  }
}
