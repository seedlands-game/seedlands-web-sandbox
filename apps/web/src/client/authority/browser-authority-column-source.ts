import type { WorldInspectResult } from '@seedlands/stdlib/server/harness/world-harness-contract';
type Source = Extract<WorldInspectResult, { kind: 'column-source' }>['source'];

export async function requestBrowserColumnSource(
  request: (payload: Record<string, unknown>) => Promise<unknown>,
  epoch: () => string,
  cx: number,
  cz: number,
): Promise<Source> {
  const submittedEpoch = epoch();
  const source = (await request({ kind: 'request-column-source', cx, cz })) as Source;
  return epoch() === submittedEpoch ? source : { status: 'unknown', reason: 'superseded' };
}
