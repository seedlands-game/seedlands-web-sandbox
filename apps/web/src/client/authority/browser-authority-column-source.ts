import type { WorldInspectResult } from '@seedlands/stdlib/server/harness/world-harness-contract';
import { requestBrowserSkyChunk } from './browser-authority-sky-chunk';
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

export const createBrowserSkySourcePort = (
  request: (payload: Record<string, unknown>) => Promise<unknown>,
  epoch: () => string,
) => ({
  inspectColumnSource: (cx: number, cz: number) => requestBrowserColumnSource(request, epoch, cx, cz),
  readSkyColumnChunk: (cx: number, cy: number, cz: number, revision: number) =>
    requestBrowserSkyChunk(request, epoch, cx, cy, cz, revision),
});
