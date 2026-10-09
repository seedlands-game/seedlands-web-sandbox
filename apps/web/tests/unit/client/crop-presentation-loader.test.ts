import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBrowserPackPresentationCatalog } from '../../../src/client/presentation/pack-presentation-loader';

const origin = 'http://localhost';
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const resourceLock = async (path: string, content: string) => ({
  path,
  sha256: await sha256(content),
  size: new TextEncoder().encode(content).byteLength,
  contentType: path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
});
const cropStages = (packRoot: string, texture = (stage: number) => `crops/wheat-${stage}.svg`) =>
  Array.from({ length: 8 }, (_, stage) => ({
    texture: `${packRoot}${texture(stage)}`,
    height: 0.2 + stage * 0.05,
    width: 0.4,
  }));
const presentation = (crops?: readonly unknown[]) => ({
  schemaVersion: 1,
  voxels: [],
  items: [],
  actors: [],
  materials: [],
  ...(crops === undefined ? {} : { crops }),
});

type PackInput = Readonly<{ id: string; presentation: unknown; textures?: Readonly<Record<string, string>> }>;

async function installPackFetch(packs: readonly PackInput[]) {
  const files = new Map<string, string>();
  const lockPacks = [];
  for (let index = 0; index < packs.length; index++) {
    const pack = packs[index]!;
    const packRoot = `pack${index}/`;
    const presentationPath = `${packRoot}presentation.json`;
    const manifestPath = `${packRoot}manifest.json`;
    const entryPath = `${packRoot}entry.mjs`;
    const serializedPresentation = JSON.stringify(pack.presentation);
    const resources = [
      await resourceLock(presentationPath, serializedPresentation),
      ...(await Promise.all(Object.entries(pack.textures ?? {}).map(([path, content]) => resourceLock(path, content)))),
    ];
    const manifest = JSON.stringify({
      schemaVersion: 1,
      id: pack.id,
      version: '1.0.0',
      kind: 'playbook',
      entry: entryPath,
      modules: [],
      resources: resources.map(({ path }) => path),
      presentation: { path: presentationPath },
    });
    const entry = 'export const pack = { modules: [] };';
    files.set(`/packs/${manifestPath}`, manifest);
    files.set(`/packs/${presentationPath}`, serializedPresentation);
    files.set(`/packs/${entryPath}`, entry);
    for (const [path, content] of Object.entries(pack.textures ?? {})) files.set(`/packs/${path}`, content);
    lockPacks.push({
      id: pack.id,
      version: '1.0.0',
      manifest: { path: manifestPath, sha256: await sha256(manifest) },
      entry: { path: entryPath, sha256: await sha256(entry) },
      resources,
    });
  }
  files.set('/packs/packs.lock.json', JSON.stringify({ schemaVersion: 1, packs: lockPacks }));
  vi.stubGlobal('location', { origin });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | RequestInfo) => {
      const body = files.get(new URL(String(input)).pathname);
      return new Response(body ?? 'missing', {
        status: body === undefined ? 404 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Pack crop presentation loader', () => {
  it('keeps the pre-crop presentation schema valid and exposes an empty crop map', async () => {
    await installPackFetch([{ id: 'sample:legacy', presentation: presentation() }]);

    const catalog = await loadBrowserPackPresentationCatalog(new URL('/packs/', origin));

    expect(catalog.crops).toEqual({});
    catalog.dispose();
  });

  it('loads eight locked stage textures and releases their object URLs once', async () => {
    const stages = cropStages('pack0/');
    const textures = Object.fromEntries(stages.map(({ texture }, stage) => [texture, `<svg>${stage}</svg>`]));
    await installPackFetch([
      { id: 'sample:wheat', presentation: presentation([{ id: 'sample:wheat-crop', stages }]), textures },
    ]);
    const created: string[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const value = `blob:crop-stage-${created.length}`;
      created.push(value);
      return value;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((value) => revoked.push(value));

    const catalog = await loadBrowserPackPresentationCatalog(new URL('/packs/', origin));

    const crops = catalog.crops!;
    expect(crops['sample:wheat-crop']?.stages).toHaveLength(8);
    expect(crops['sample:wheat-crop']?.stages.map(({ height, width }) => ({ height, width }))).toEqual(
      cropStages('pack0/').map(({ height, width }) => ({ height, width })),
    );
    expect(
      crops['sample:wheat-crop']?.stages.every(({ texture }) =>
        catalog.assetUrls[texture]?.startsWith('blob:crop-stage-'),
      ),
    ).toBe(true);
    expect(created).toHaveLength(8);
    catalog.dispose();
    catalog.dispose();
    expect(revoked).toEqual(created);
  });

  it.each([
    [
      'duplicate crop id',
      (stages: ReturnType<typeof cropStages>) => [
        { id: 'sample:crop', stages },
        { id: 'sample:crop', stages },
      ],
    ],
    ['invalid crop id', (stages: ReturnType<typeof cropStages>) => [{ id: 'invalid crop id', stages }]],
    [
      'wrong stage count',
      (stages: ReturnType<typeof cropStages>) => [{ id: 'sample:crop', stages: stages.slice(0, 7) }],
    ],
    [
      'invalid dimensions',
      (stages: ReturnType<typeof cropStages>) => [
        { id: 'sample:crop', stages: [{ ...stages[0]!, width: 0 }, ...stages.slice(1)] },
      ],
    ],
    [
      'oversized dimensions',
      (stages: ReturnType<typeof cropStages>) => [
        { id: 'sample:crop', stages: [{ ...stages[0]!, height: 2.01 }, ...stages.slice(1)] },
      ],
    ],
    [
      'builtin texture',
      (stages: ReturnType<typeof cropStages>) => [
        { id: 'sample:crop', stages: [{ ...stages[0]!, texture: 'builtin:crops/wheat.svg' }, ...stages.slice(1)] },
      ],
    ],
    [
      'unlocked texture',
      (stages: ReturnType<typeof cropStages>) => [
        { id: 'sample:crop', stages: [{ ...stages[0]!, texture: 'unlocked.svg' }, ...stages.slice(1)] },
      ],
    ],
  ] as const)('rejects %s and revokes URLs created by earlier valid packs', async (_case, makeCrops) => {
    const leafPresentation = {
      schemaVersion: 1,
      voxels: [{ id: 'sample:leaf', texture: 'pack0/textures/leaf.svg', material: 'sample:leaf' }],
      items: [],
      actors: [],
      materials: [{ id: 'sample:leaf', faceMaterial: 21, texture: 'pack0/textures/leaf.svg', renderMode: 'opaque' }],
    };
    const stages = cropStages('pack1/');
    const malformed = { ...presentation(makeCrops(stages)), crops: makeCrops(stages) };
    await installPackFetch([
      { id: 'sample:valid-first', presentation: leafPresentation, textures: { 'pack0/textures/leaf.svg': '<svg/>' } },
      {
        id: 'sample:invalid-crop',
        presentation: malformed,
        textures: Object.fromEntries(stages.map(({ texture }, index) => [texture, `<svg>${index}</svg>`])),
      },
    ]);
    const revoked = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:earlier-pack');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoked);

    await expect(loadBrowserPackPresentationCatalog(new URL('/packs/', origin))).rejects.toThrow();

    expect(revoked.mock.calls.map(([url]) => url)).toEqual(['blob:earlier-pack']);
  });
});
