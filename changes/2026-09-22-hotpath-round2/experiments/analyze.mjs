import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(),
  out = resolve(process.env.HOTPATH_OUT),
  raw = resolve(out, 'profiles');
const lib = readdirSync(resolve(root, 'node_modules/.pnpm')).find((n) => n.startsWith('@jridgewell+trace-mapping@'));
const { TraceMap, originalPositionFor } = await import(
  pathToFileURL(
    resolve(root, 'node_modules/.pnpm', lib, 'node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs'),
  )
);
const maps = new Map(),
  symbols = new Map();
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const events = readFileSync(resolve(out, 'profile-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const captures = new Map(events.filter((e) => e.kind === 'CAPTURE').map((e) => [e.prefix, e]));
const attached = events.filter((e) => e.kind === 'ATTACHED');
function symbol(f) {
  const key = JSON.stringify(f);
  if (symbols.has(key)) return symbols.get(key);
  let source = f.url || '(native)',
    line = f.lineNumber + 1,
    name = f.functionName || '(anonymous)',
    column = f.columnNumber;
  if (f.url?.startsWith('http://127.0.0.1:4273/')) {
    const asset = basename(new URL(f.url).pathname),
      mapPath = resolve(out, 'source-maps', asset + '.map');
    // V8 may emit synthetic frames with lineNumber -1. They have no usable
    // generated source position and must not be passed to trace-mapping.
    if (existsSync(mapPath) && f.lineNumber >= 0) {
      if (!maps.has(mapPath)) maps.set(mapPath, new TraceMap(read(mapPath)));
      const original = originalPositionFor(maps.get(mapPath), {
        line: f.lineNumber + 1,
        column: Math.max(0, f.columnNumber),
      });
      if (original.source) {
        source = original.source.replace(/^(\.\.\/)+/, '');
        if (source.startsWith('src/')) source = 'apps/web/' + source;
        line = original.line;
        column = original.column;
        name = original.name || name;
      }
    }
  }
  const value = { source, line, column, name, generatedName: f.functionName };
  symbols.set(key, value);
  return value;
}
const groups = {
  craftableEnumeration: (s) =>
    s.source.endsWith('registered-inventory-runtime.ts') && s.generatedName === 'listCraftable',
  uiDeepEquality: (s) => s.source.endsWith('gameplay-ui-projector.ts') && s.line === 103,
  platformClone: (s) => s.source === 'apps/web/src/platform/core-platform.ts' && s.generatedName === 'clone',
  prepareWorkerInput: (s) =>
    s.source.endsWith('browser-authority-chunk-client.ts') && s.generatedName === 'prepareWorkerInput',

  collisionQuery: (s) => s.source.endsWith('voxel-collision-world.ts') && s.generatedName === 'querySolids',
  inventoryActionModel: (s) => s.source.endsWith('inventory-action-model.ts'),
  observerVisitNode: (s) => s.source === '(native)' && s.generatedName === 'visitNode',
  snapshotMetrics: (s) => s.source.endsWith('gameplay-runtime-metrics.ts'),
  snapshotCheckpoint: (s) => s.source.endsWith('gameplay-runtime-checkpoint.ts'),
  fullGameplayView: (s) => s.source.endsWith('authority-gameplay-view.ts'),
  authorityCapacity: (s) => s.source.endsWith('authority-advance-capacity.ts'),
  schedulerPreview: (s) => s.source.endsWith('multi-rate-scheduler.ts') && s.generatedName === 'previewAdvanceTo',
  gameplayUI: (s) => s.source.endsWith('gameplay-ui-projector.ts'),
  preparedEntityMutation: (s) => s.source.endsWith('prepared-entity-mutation.ts'),
  moduleStatePorts: (s) =>
    /\/(?:block-state-port|combat-state-port|needs-state-port|registered-inventory-runtime|registered-station-runtime)\.ts$/.test(
      s.source,
    ),
  moduleBoundary: (s) =>
    /\/(?:registered-operations|behavior-capability-validation|operation-context)\.ts$/.test(s.source),
  chunkClient: (s) => s.source.endsWith('browser-authority-chunk-client.ts'),
  providerHalo: (s) => s.source.endsWith('provider-mesh-input.ts'),
  worldgenCache: (s) => s.source === 'playbooks/classic/src/worldgen.ts',
};
const add = (map, k, n, detail) => {
  const v = map.get(k) ?? { ...detail, value: 0 };
  v.value += n;
  map.set(k, v);
};
const summaries = [];
for (const target of attached) {
  const files = readdirSync(raw).filter((n) => n.startsWith(`target-${target.index}-`) && n.endsWith('.cpuprofile'));
  const result = { targetIndex: target.index, type: target.type, url: target.url, all: {}, gameplay: {} };
  for (const scope of ['all', 'gameplay']) {
    let totalMs = 0,
      idleMs = 0,
      programMs = 0,
      gcMs = 0,
      samples = 0;
    const self = new Map(),
      inclusive = new Map(),
      byGroup = new Map(),
      filesUsed = [];
    for (const file of files) {
      const cap = captures.get(file.replace('.cpuprofile', ''));
      if (!cap) continue;
      if (
        scope === 'gameplay' &&
        (!['C1', 'C2', 'C3'].includes(cap.previousCompletedStage) || !['C1', 'C2', 'C3'].includes(cap.completedStage))
      )
        continue;
      filesUsed.push(file);
      const p = read(resolve(raw, file)),
        nodes = new Map(p.nodes.map((n) => [n.id, n])),
        parents = new Map();
      for (const n of p.nodes) for (const id of n.children ?? []) parents.set(id, n.id);
      const stacks = new Map();
      function stack(id) {
        if (stacks.has(id)) return stacks.get(id);
        const list = [];
        let n = id;
        while (n !== undefined) {
          const node = nodes.get(n);
          if (!node) break;
          list.push(symbol(node.callFrame));
          n = parents.get(n);
        }
        stacks.set(id, list);
        return list;
      }
      for (let i = 0; i < (p.samples?.length ?? 0); i++) {
        const ms = (p.timeDeltas?.[i] ?? 2000) / 1000,
          st = stack(p.samples[i]),
          leaf = st[0];
        if (!leaf) continue;
        totalMs += ms;
        samples++;
        if (leaf.name === '(idle)') {
          idleMs += ms;
          continue;
        }
        if (leaf.name === '(program)') {
          programMs += ms;
          continue;
        }
        if (leaf.name === '(garbage collector)') gcMs += ms;
        add(self, JSON.stringify(leaf), ms, leaf);
        const seen = new Set();
        for (const s of st) {
          if (seen.has(s.source)) continue;
          seen.add(s.source);
          add(inclusive, s.source, ms, { source: s.source });
        }
        for (const [name, predicate] of Object.entries(groups))
          if (st.some(predicate)) add(byGroup, name, ms, { name });
      }
    }
    result[scope] = {
      segments: filesUsed.length,
      files: filesUsed,
      samples,
      totalProfiledMs: totalMs,
      idleMs,
      programMs,
      activeSampledMs: totalMs - idleMs - programMs,
      gcMs,
      groups: [...byGroup.values()].sort((a, b) => b.value - a.value),
      topSelf: [...self.values()].sort((a, b) => b.value - a.value).slice(0, 35),
      topInclusiveFiles: [...inclusive.values()].sort((a, b) => b.value - a.value).slice(0, 25),
    };
  }
  // Heap snapshots are cumulative: retain only the last successful one per target, never sum snapshots.
  const heaps = readdirSync(raw)
    .filter((n) => n.startsWith(`target-${target.index}-`) && n.endsWith('.heapprofile'))
    .sort((a, b) => Number(a.match(/segment-(\d+)/)[1]) - Number(b.match(/segment-(\d+)/)[1]));
  if (heaps.length) {
    const file = heaps.at(-1),
      p = read(resolve(raw, file)),
      self = new Map(),
      byGroup = new Map();
    let bytes = 0;
    function visit(n, ancestors = []) {
      const s = symbol(n.callFrame),
        stack = [s, ...ancestors],
        size = n.selfSize ?? 0;
      bytes += size;
      add(self, JSON.stringify(s), size, s);
      for (const [name, predicate] of Object.entries(groups))
        if (stack.some(predicate)) add(byGroup, name, size, { name });
      for (const child of n.children ?? []) visit(child, stack);
    }
    visit(p.head);
    result.heap = {
      file,
      estimatedCumulativeAllocatedBytes: bytes,
      sampleCount: p.samples?.length,
      groups: [...byGroup.values()].sort((a, b) => b.value - a.value),
      topSelf: [...self.values()].sort((a, b) => b.value - a.value).slice(0, 30),
      scope:
        'Target lifetime from profiler attach to last snapshot; includes fixture and reclaimed objects; sampled estimate, not live heap/RSS or exact allocation total.',
    };
  }
  const gameplayCaps = [...captures.values()]
    .filter(
      (c) =>
        c.targetId === target.targetId &&
        ['C1', 'C2', 'C3'].includes(c.completedStage) &&
        existsSync(resolve(raw, c.prefix + '.heapprofile')),
    )
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  if (gameplayCaps.length >= 2) {
    const first = gameplayCaps[0],
      last = gameplayCaps.at(-1);
    function heapTotals(cap) {
      const p = read(resolve(raw, cap.prefix + '.heapprofile')),
        self = new Map(),
        g = new Map();
      let bytes = 0;
      function walk(n, anc = []) {
        const sy = symbol(n.callFrame),
          st = [sy, ...anc],
          size = n.selfSize ?? 0;
        bytes += size;
        add(self, JSON.stringify(sy), size, sy);
        for (const [name, pred] of Object.entries(groups)) if (st.some(pred)) add(g, name, size, { name });
        for (const c of n.children ?? []) walk(c, st);
      }
      walk(p.head);
      return { bytes, self, g };
    }
    const a = heapTotals(first),
      b = heapTotals(last);
    result.gameplayHeapDelta = {
      from: first.prefix,
      to: last.prefix,
      seconds: (Date.parse(last.capturedAt) - Date.parse(first.capturedAt)) / 1000,
      estimatedAllocatedBytes: b.bytes - a.bytes,
      groups: [...new Set([...a.g.keys(), ...b.g.keys()])]
        .map((name) => ({ name, value: (b.g.get(name)?.value ?? 0) - (a.g.get(name)?.value ?? 0) }))
        .sort((a, b) => b.value - a.value),
      topSelf: [...new Set([...a.self.keys(), ...b.self.keys()])]
        .map((key) => ({
          ...(b.self.get(key) ?? a.self.get(key)),
          value: (b.self.get(key)?.value ?? 0) - (a.self.get(key)?.value ?? 0),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 30),
    };
  }
  summaries.push(result);
}
writeFileSync(
  resolve(out, 'profile-summary.json'),
  JSON.stringify(
    {
      cpuUnits: 'estimated ms weighted by sample timeDelta; inclusive groups overlap',
      gameplayScope:
        'Only complete profile segments with both endpoints after C1 completion and before C4 completion; no setup/C5; not exact per-function call counts or p95.',
      heapUnits:
        'V8 statistical allocation estimate in bytes; latest cumulative snapshot only per target; no ArrayBuffer copy-byte claim',
      targets: summaries,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    summaries.map((t) => ({
      target: t.targetIndex,
      url: t.url,
      segments: t.gameplay.segments,
      activeMs: t.gameplay.activeSampledMs,
      gcMs: t.gameplay.gcMs,
      groups: t.gameplay.groups,
      allocationMiB: t.heap?.estimatedCumulativeAllocatedBytes / 1048576,
      allocationGroups: t.heap?.groups,
      gameplayAllocation: t.gameplayHeapDelta,
    })),
    null,
    2,
  ),
);
