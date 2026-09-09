import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';

// Isolated admission only: no production file imports this experiment.
const candidate = process.argv[2];
const runtime = process.argv[3];
if (!['bitecs', 'koota'].includes(candidate) || !runtime)
  throw new Error('Usage: node ecs-admission.mjs <bitecs|koota> <isolated-pnpm-project>');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.resolve(runtime, 'package.json'));
const packageDir = path.resolve(path.dirname(require.resolve(candidate)), candidate === 'bitecs' ? '../..' : '..');
const metadata = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
const digestFile = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
assert.equal(pnpmVersion.status, 0);
const rootRequire = createRequire(path.join(root, 'package.json'));
const tsVersion = JSON.parse(await readFile(rootRequire.resolve('typescript/package.json'), 'utf8')).version;
assert.equal(metadata.version, candidate === 'bitecs' ? '0.4.0' : '0.6.6');
const prototypeBefore = new Set(Object.getOwnPropertyNames(Number.prototype));
const symbolsBefore = new Set(Object.getOwnPropertySymbols(globalThis));
const library = await import(pathToFileURL(path.join(packageDir, metadata.exports['.'].import)));
const prototypeAdded = Object.getOwnPropertyNames(Number.prototype).filter((name) => !prototypeBefore.has(name));
const globalSymbolsAdded = Object.getOwnPropertySymbols(globalThis)
  .filter((symbol) => !symbolsBefore.has(symbol))
  .map((symbol) => symbol.description);
const temp = await mkdtemp(path.join(tmpdir(), 'seedlands-ecs-control-'));

function createAdapter() {
  const ids = new Map();
  const retired = new Set();
  const buckets = new Map();
  const bucket = (position) => position.map((value) => Math.floor(value / 8)).join(',');
  const indexAdd = (id, position) => {
    const key = bucket(position);
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key).add(id);
  };
  const indexRemove = (id, position) => {
    const key = bucket(position);
    const ids = buckets.get(key);
    ids?.delete(id);
    if (ids?.size === 0) buckets.delete(key);
  };
  let epoch = 1;
  let sequence = 0;
  let disposed = false;
  const Position = candidate === 'bitecs' ? [] : library.trait(() => ({ value: [0, 0, 0] }));
  const Velocity = candidate === 'bitecs' ? [] : library.trait(() => ({ value: [0, 0, 0] }));
  const Health = candidate === 'bitecs' ? [] : library.trait({ value: 12 });
  const Inventory = candidate === 'bitecs' ? [] : library.trait(() => ({ value: [] }));
  const world = library.createWorld();
  const alive = (eid) => (candidate === 'bitecs' ? library.entityExists(world, eid) : world.has(eid));
  const resolve = (id) => {
    const eid = ids.get(id);
    if (disposed || eid === undefined || !alive(eid)) throw new Error('Unknown entity');
    return eid;
  };
  const read = (component, eid) => (candidate === 'bitecs' ? component[eid] : eid.get(component).value);
  const write = (component, eid, value) => {
    if (candidate === 'bitecs') component[eid] = structuredClone(value);
    else eid.set(component, { value: structuredClone(value) });
  };
  const api = {
    spawn(input = {}) {
      if (disposed) throw new Error('Disposed world');
      const id = input.id ?? `entity-${++sequence}`;
      if (ids.has(id) || retired.has(id)) throw new Error('Duplicate or retired stable id');
      // Selected production policy: flush deferred query removals before any ID reuse.
      if (candidate === 'bitecs') library.commitRemovals(world);
      const eid =
        candidate === 'bitecs' ? library.addEntity(world) : world.spawn(Position, Velocity, Health, Inventory);
      if (candidate === 'bitecs')
        for (const component of [Position, Velocity, Health, Inventory]) library.addComponent(world, eid, component);
      ids.set(id, eid);
      write(Position, eid, input.position ?? [0, 8, 0]);
      write(Velocity, eid, input.physicsVelocity ?? [0, 0, 0]);
      write(Health, eid, input.health ?? 12);
      write(Inventory, eid, input.inventory ?? []);
      indexAdd(id, read(Position, eid));
      return id;
    },
    get(id) {
      const eid = resolve(id);
      return structuredClone({
        id,
        position: read(Position, eid),
        physicsVelocity: read(Velocity, eid),
        health: read(Health, eid),
        inventory: read(Inventory, eid),
      });
    },
    move(id, position, velocity = [0, 0, 0]) {
      const eid = resolve(id);
      indexRemove(id, read(Position, eid));
      write(Position, eid, position);
      write(Velocity, eid, velocity);
      indexAdd(id, position);
    },
    setInventory(id, value) {
      write(Inventory, resolve(id), value);
    },
    despawn(id) {
      const eid = resolve(id);
      indexRemove(id, read(Position, eid));
      if (candidate === 'bitecs') {
        library.removeEntity(world, eid);
        for (const component of [Position, Velocity, Health, Inventory]) delete component[eid];
      } else eid.destroy();
      ids.delete(id);
      retired.add(id);
    },
    action(id) {
      resolve(id);
      return Object.freeze({ entityId: id, epoch });
    },
    execute(action) {
      if (action.epoch !== epoch) throw new Error('Stale epoch');
      return api.get(action.entityId);
    },
    internalId(id) {
      return resolve(id);
    },
    query() {
      const matches =
        candidate === 'bitecs'
          ? library.query(world, [Position, Health, Inventory])
          : world.query(Position, Health, Inventory);
      const actual = Array.from(matches).sort((a, b) => a - b);
      assert.deepEqual(
        actual,
        [...ids.values()].sort((a, b) => a - b),
      );
      return actual
        .map((eid) => {
          assert.ok(alive(eid));
          for (const component of [Position, Health, Inventory])
            assert.ok(candidate === 'bitecs' ? library.hasComponent(world, eid, component) : eid.has(component));
          const id = [...ids].find(([, value]) => value === eid)[0];
          return api.get(id);
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    withoutInventory(id) {
      const eid = resolve(id);
      if (candidate === 'bitecs') library.removeComponent(world, eid, Inventory);
      else eid.remove(Inventory);
      const actual = Array.from(
        candidate === 'bitecs'
          ? library.query(world, [Position, Health, Inventory])
          : world.query(Position, Health, Inventory),
      );
      assert.deepEqual(
        actual.sort((a, b) => a - b),
        [...ids.values()].filter((value) => value !== eid).sort((a, b) => a - b),
      );
      if (candidate === 'bitecs') library.addComponent(world, eid, Inventory);
      else eid.add(Inventory);
      write(Inventory, eid, []);
    },
    nearby(position, radius) {
      const found = [];
      const min = position.map((v) => Math.floor((v - radius) / 8));
      const max = position.map((v) => Math.floor((v + radius) / 8));
      for (let x = min[0]; x <= max[0]; x++)
        for (let y = min[1]; y <= max[1]; y++)
          for (let z = min[2]; z <= max[2]; z++)
            for (const id of buckets.get([x, y, z].join(',')) ?? []) {
              const entity = api.get(id);
              if (entity.position.reduce((sum, v, i) => sum + (v - position[i]) ** 2, 0) <= radius ** 2) found.push(id);
            }
      return found.sort();
    },
    snapshot() {
      return { schema: 1, sequence, retired: [...retired], entities: api.query() };
    },
    restore(snapshot) {
      epoch += 1;
      for (const id of [...ids.keys()]) api.despawn(id);
      retired.clear();
      for (const input of snapshot.entities) api.spawn(input);
      snapshot.retired.forEach((id) => retired.add(id));
      sequence = snapshot.sequence;
    },
    dispose() {
      if (disposed) return;
      for (const id of [...ids.keys()]) api.despawn(id);
      if (candidate === 'bitecs') library.deleteWorld(world);
      else world.destroy();
      disposed = true;
      epoch += 1;
    },
  };
  return api;
}

try {
  const typeProbe =
    candidate === 'bitecs'
      ? `import { createWorld, addEntity, addComponent, query } from 'bitecs';
         const position: { x: number[]; y: number[] } = { x: [], y: [] };
         const world = createWorld(); const id = addEntity(world);
         addComponent(world, id, position); position.x[id] = 1;
         export const entities: readonly number[] = Array.from(query(world, [position]));`
      : `import { createWorld, trait } from 'koota';
         const Position = trait({ x: 0, y: 0 }); const world = createWorld();
         const entity = world.spawn(Position); entity.set(Position, { x: 1 });
         export const value: number | undefined = entity.get(Position)?.x;`;
  await writeFile(path.join(temp, 'probe.ts'), typeProbe);
  await writeFile(
    path.join(temp, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ['ES2022'],
        types: [],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        paths: { [candidate]: [path.join(packageDir, metadata.types)] },
      },
      files: ['probe.ts'],
    }),
  );
  const typecheck = spawnSync('pnpm', ['exec', 'tsc', '-p', path.join(temp, 'tsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(typecheck.status, 0, typecheck.stderr + typecheck.stdout);
  const controlBuild = await build({
    metafile: true,
    absWorkingDir: root,
    stdin: {
      contents:
        "export { EntityStore } from './packages/game-core/src/server/gameplay/entity-store'; export { stepBody, bodyConfigFor } from './packages/game-core/src/physics';",
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: path.join(temp, 'control.mjs'),
    logLevel: 'silent',
  });
  const { EntityStore, stepBody, bodyConfigFor } = await import(pathToFileURL(path.join(temp, 'control.mjs')));
  const worlds = [createAdapter(), createAdapter()];
  const [a, b] = worlds;
  a.spawn({ id: 'actor', position: [0, 8, 0] });
  b.spawn({ id: 'actor', position: [0, 80, 0] });
  const initialIds = [a.internalId('actor'), b.internalId('actor')];
  a.setInventory('actor', [{ itemId: 'food:berry', count: 1 }]);
  assert.deepEqual(b.get('actor').inventory, []);
  const projection = a.get('actor');
  projection.position[1] = 999;
  projection.inventory[0].count = 999;
  assert.equal(a.get('actor').position[1], 8);
  assert.equal(a.get('actor').inventory[0].count, 1);
  assert.deepEqual(
    a.query().map((entity) => entity.id),
    ['actor'],
  );
  assert.deepEqual(a.nearby([0, 8, 0], 1), ['actor']);
  const pending = a.action('actor');
  const oldId = a.internalId('actor');
  a.despawn('actor');
  a.spawn({ id: 'replacement' });
  const replacementId = a.internalId('replacement');
  assert.throws(() => a.execute(pending), /Unknown/);
  assert.throws(() => a.spawn({ id: 'actor' }), /retired/);
  assert.deepEqual(a.get('replacement').inventory, []);
  assert.deepEqual(
    a.query().map((entity) => entity.id),
    ['replacement'],
  );
  a.withoutInventory('replacement');
  assert.deepEqual(
    a.query().map((entity) => entity.id),
    ['replacement'],
  );
  assert.deepEqual(a.nearby([0, 8, 0], 1), ['replacement']);
  a.move('replacement', [40, 8, 0]);
  assert.deepEqual(a.nearby([0, 8, 0], 1), []);
  assert.deepEqual(a.nearby([40, 8, 0], 1), ['replacement']);
  a.move('replacement', [0, 8, 0]);
  const control = new EntityStore();
  control.spawn({ id: 'replacement', type: 'npc', archetype: 'settler', position: [0, 8, 0] });
  const floor = {
    querySolids: () => [
      { id: 'floor', collisionLayer: 1, aabb: { min: { x: -10, y: -1, z: -10 }, max: { x: 10, y: 0, z: 10 } } },
    ],
  };
  const vector = (p) => ({ x: p[0], y: p[1], z: p[2] });
  for (let i = 0; i < 180; i += 1) {
    const state = a.get('replacement');
    const controlState = control.get('replacement');
    const result = stepBody({
      state: { position: vector(state.position), velocity: vector(state.physicsVelocity) },
      config: bodyConfigFor('settler'),
      input: { wish: { x: 0, z: 0 }, jumpPressed: false, verticalIntent: 0 },
      world: floor,
      dt: 1 / 60,
    });
    const position = [result.state.position.x, result.state.position.y, result.state.position.z];
    const velocity = [result.state.velocity.x, result.state.velocity.y, result.state.velocity.z];
    const controlResult = stepBody({
      state: { position: vector(controlState.position), velocity: vector(controlState.physicsVelocity) },
      config: bodyConfigFor('settler'),
      input: { wish: { x: 0, z: 0 }, jumpPressed: false, verticalIntent: 0 },
      world: floor,
      dt: 1 / 60,
    });
    a.move('replacement', position, velocity);
    control.update('replacement', {
      position: [controlResult.state.position.x, controlResult.state.position.y, controlResult.state.position.z],
      physicsVelocity: [controlResult.state.velocity.x, controlResult.state.velocity.y, controlResult.state.velocity.z],
    });
    assert.deepEqual(a.get('replacement').position, control.get('replacement').position);
    assert.deepEqual(a.get('replacement').physicsVelocity, control.get('replacement').physicsVelocity);
  }
  assert.equal(a.get('replacement').position[1], control.get('replacement').position[1]);
  assert.ok(Math.abs(a.get('replacement').position[1]) < 1e-4);
  assert.equal(control.queryNearby(a.get('replacement').position, 1).length, 1);
  assert.equal(control.queryNearby([0, 8, 0], 1).length, 0);
  assert.deepEqual(a.nearby([0, 0, 0], 1), ['replacement']);
  assert.deepEqual(a.nearby([0, 8, 0], 1), []);
  const snapshot = a.snapshot();
  assert.ok(!JSON.stringify(snapshot).includes('eid'));
  const staleEpoch = a.action('replacement');
  a.restore(snapshot);
  assert.deepEqual(a.snapshot(), snapshot);
  assert.throws(() => a.execute(staleEpoch), /Stale epoch/);
  assert.equal(b.get('actor').position[1], 80);
  const fresh = createAdapter();
  fresh.restore(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(fresh.snapshot(), snapshot);
  assert.deepEqual(fresh.nearby([0, 0, 0], 1), ['replacement']);
  fresh.despawn('replacement');
  assert.deepEqual(fresh.nearby([0, 0, 0], 1), []);
  assert.deepEqual(fresh.query(), []);
  fresh.dispose();
  a.dispose();
  a.dispose();
  assert.throws(() => a.get('replacement'), /Unknown/);
  assert.equal(b.get('actor').position[1], 80);
  b.dispose();
  // Resolve the exact published entry and prove its runtime closure builds without a Node platform.
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: [path.join(packageDir, metadata.exports['.'].import)],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assert.equal(bundled.errors.length, 0);
  const inputs = async (metafile, base) =>
    Promise.all(
      Object.keys(metafile.inputs)
        .filter((file) => file !== '<stdin>')
        .sort()
        .map(async (file) => ({
          path: path.relative(base, path.resolve(root, file)),
          sha256: await digestFile(path.resolve(root, file)),
        })),
    );
  const runReceipt = {
    schemaVersion: 1,
    command: `node changes/2026-09-09-composable-overworld-playbook/experiments/ecs-admission.mjs ${candidate} <isolated-pnpm-project>`,
    exitCode: 0,
    node: process.versions.node,
    pnpm: pnpmVersion.stdout.trim(),
    typescript: tsVersion,
    esbuild: esbuildVersion,
    experimentSha256: await digestFile(fileURLToPath(import.meta.url)),
    isolatedManifestSha256: await digestFile(path.resolve(runtime, 'package.json')),
    isolatedLockSha256: await digestFile(path.resolve(runtime, 'pnpm-lock.yaml')),
    runtimeInputs: await inputs(bundled.metafile, packageDir),
    controlInputs: await inputs(controlBuild.metafile, root),
  };
  console.log(
    JSON.stringify(
      {
        candidate,
        runReceipt,
        version: metadata.version,
        result: 'PASS',
        checks: [
          'two-world-isolation',
          'projection-copy',
          'component-owner',
          'stable-id-tombstone',
          'stale-action',
          'fresh-recycled-components',
          'existing-physics-180-steps',
          'ecs-driven-derived-spatial-index',
          'prewarmed-query-recycle-exact-membership',
          'component-remove-readd-query-membership',
          'checkpoint-roundtrip',
          'epoch-invalidation',
          'dispose-isolation',
          'browser-bundle',
          'types-without-platform-ambient',
        ],
        entityReusePolicy:
          candidate === 'bitecs'
            ? 'commitRemovals-before-addEntity; stable-id + epoch'
            : 'library generation + stable-id + epoch',
        initialIds,
        oldId,
        replacementId,
        prototypeAdded,
        globalSymbolsAdded,
        runtimeInputCount: Object.keys(bundled.metafile.inputs).length,
        runtimeBytes: bundled.outputFiles[0].contents.byteLength,
        limits: [
          'isolated-adapter-only',
          'no-product-migration',
          'no-performance-claim',
          'no-browser-product-acceptance',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
