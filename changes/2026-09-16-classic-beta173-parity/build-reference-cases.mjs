import { readFile, writeFile } from 'node:fs/promises';
import { buildContentCases } from './build-content-cases.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helperRecipeExpected } from './helper-recipe-expected.mjs';
import { initializeReferenceReview } from './initialize-reference-review.mjs';
import { mergeMechanismSourceReview, parseMechanismSourceReview } from './mechanism-review-merge.mjs';
import { mergeWorldMechanismCandidates } from './mechanism-world-merge.mjs';
import { createRecipeSourceParser } from './recipe-source-parser.mjs';

// One-shot documentation generator. It only extracts facts from pinned public
// reference text; it never executes or packages the reference game.
const root = dirname(fileURLToPath(import.meta.url));
const betaWikiCommit = '8bcc41aee34334c2b916e7b500abe6853b4fd704';
const reconstructedCommit = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const wikiBase = `https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/${betaWikiCommit}`;
const sourceBase = `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${reconstructedCommit}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const sourceRawBase = `https://raw.githubusercontent.com/jacobo-mc/mc_b1.7.3_release/${reconstructedCommit}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const retroPage = 'https://wiki.retromc.org/index.php?title=B1.7.3_data_values&oldid=9822';
const retroRaw = `${retroPage}&action=raw`;

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

const inventory = await readFile(join(root, 'inventory.md'), 'utf8');
const mechanisms = await readFile(join(root, 'mechanics.md'), 'utf8');
const projectExpected = JSON.parse(await readFile(join(root, 'project-contract-expected.json'), 'utf8'));
const [
  blockText,
  itemText,
  retroText,
  craftingText,
  furnaceText,
  dropsText,
  blockSource,
  itemSource,
  entityListSource,
] = await Promise.all([
  fetchText(`${wikiBase}/general/blocks.md`),
  fetchText(`${wikiBase}/general/items.md`),
  fetchText(retroRaw),
  fetchText(`${sourceRawBase}/CraftingManager.java`),
  fetchText(`${sourceRawBase}/FurnaceRecipes.java`),
  fetchText(`${wikiBase}/general/drops.md`),
  fetchText(`${sourceRawBase}/Block.java`),
  fetchText(`${sourceRawBase}/Item.java`),
  fetchText(`${sourceRawBase}/EntityList.java`),
]);

const { cases, itemLines } = buildContentCases({
  blockText,
  itemText,
  retroText,
  dropsText,
  blockSource,
  itemSource,
  entityListSource,
  inventory,
  sourceBase,
  wikiBase,
  retroPage,
});
const symbolIds = new Map(
  cases
    .filter((entry) => ['block', 'item'].includes(entry.kind) && entry.expected?.staticRegistration?.field)
    .map((entry) => [
      `${entry.kind === 'block' ? 'Block' : 'Item'}.${entry.expected.staticRegistration.field}`,
      entry.expected.id,
    ]),
);
const { resolveSymbol, parseStack, parseIngredient } = createRecipeSourceParser(symbolIds);
const directMatches = [...craftingText.matchAll(/this\.addRecipe\((.*?)\);/gs)];
const directCalls = directMatches.map((match) => match[1]);
if (directCalls.length !== 57) throw new Error(`Expected 57 direct crafting calls, got ${directCalls.length}`);
const smeltMatches = [
  ...furnaceText.matchAll(/this\.addSmelting\(((?:Item|Block)\.\w+\.\w+), (new ItemStack\([^)]*\))\);/g),
];
if (smeltMatches.length !== 10) throw new Error(`Expected 10 smelting registrations, got ${smeltMatches.length}`);
const smeltByInputId = new Map(
  smeltMatches.map((match) => [
    resolveSymbol(match[1]),
    { output: parseStack(match[2]), line: furnaceText.slice(0, match.index).split('\n').length },
  ]),
);
if (smeltByInputId.size !== 10) throw new Error('Duplicate smelting input ID');
const recipeRows = inventory.split('\n').filter((line) => /^\| (?:D|H)\d\d \|/.test(line));
for (const line of recipeRows) {
  const fields = line
    .split('|')
    .slice(1, -1)
    .map((part) => part.trim());
  const id = fields[0];
  const direct = id.startsWith('D');
  const outputMatch = direct ? directCalls[Number(id.slice(1)) - 1].match(/^new ItemStack\(([^)]*)\)/) : null;
  const call = direct ? directCalls[Number(id.slice(1)) - 1] : null;
  const grid = direct
    ? [...call.slice(outputMatch[0].length).matchAll(/"([ #A-Z]+)"/g)].map((match) => match[1])
    : null;
  const ingredients = direct
    ? [...call.matchAll(/'([^'])',\s*(new ItemStack\([^)]*\)|(?:Item|Block)\.\w+)/g)].map((match) => ({
        slot: match[1],
        ...parseIngredient(match[2]),
      }))
    : null;
  const helperIndex = Number(id.slice(1));
  const helper =
    helperIndex <= 20 || id === 'H86'
      ? 'RecipesTools.java'
      : helperIndex <= 27
        ? 'RecipesWeapons.java'
        : helperIndex <= 43 || helperIndex >= 90
          ? 'RecipesArmor.java'
          : helperIndex <= 51
            ? 'RecipesIngots.java'
            : helperIndex <= 54 || id === 'H85'
              ? 'RecipesCrafting.java'
              : helperIndex <= 56
                ? 'RecipesFood.java'
                : 'RecipesDyes.java';
  const helperExpected = direct ? null : helperRecipeExpected(helperIndex);
  const helperGrids =
    helperExpected?.alternatives?.map((alternative) => alternative.grid) ??
    (helperExpected?.grid ? [helperExpected.grid] : []);
  const fitsInventory =
    helperExpected?.type === 'shapeless'
      ? helperExpected.ingredients.length <= 4
      : helperGrids.some((pattern) => pattern.length <= 2 && Math.max(...pattern.map((row) => row.length)) <= 2);
  cases.push({
    caseId: `R-${id}`,
    kind: 'crafting',
    scope: fields[2],
    action: `按登记输入在 2×2 或 3×3 网格合成 ${fields[1]}；检查产出、消耗、镜像/平移和错误排列。`,
    expected: direct
      ? {
          type: 'shaped',
          output: parseStack(outputMatch[0]),
          grid,
          symbols: Object.fromEntries(
            ingredients.map(({ slot, id: inputId, metadata }) => [slot, { id: inputId, metadata }]),
          ),
          workstations:
            grid.length <= 2 && Math.max(...grid.map((row) => row.length)) <= 2
              ? ['inventory-2x2', 'crafting-table-3x3']
              : ['crafting-table-3x3'],
          horizontalMirror: true,
          translationWithinGrid: true,
          extraOccupiedCellsAccepted: false,
          consumePerOccupiedCell: 1,
          remainders: id === 'D22' ? [{ id: 325, count: 3, from: 'milk buckets' }] : [],
        }
      : {
          ...helperExpected,
          workstations: fitsInventory ? ['inventory-2x2', 'crafting-table-3x3'] : ['crafting-table-3x3'],
          horizontalMirror: helperExpected.type === 'shaped',
          translationWithinGrid: helperExpected.type === 'shaped',
          extraOccupiedCellsAccepted: false,
          exactInputMultisetOrShape: true,
          consumePerOccupiedCell: 1,
          remainders: [],
        },
    evidence: [
      {
        uri: direct
          ? `${sourceBase}/CraftingManager.java#L${craftingText.slice(0, directMatches[Number(id.slice(1)) - 1].index).split('\n').length}`
          : `${sourceBase}/${helper}`,
        supports: direct
          ? 'direct registration: output ID/count/metadata, grid and ingredient IDs/metadata'
          : 'helper registration: output ID/count/metadata and grid or shapeless input; mapping remains candidate pending review',
      },
      {
        uri: `${sourceBase}/${direct || helperExpected.type === 'shaped' ? 'ShapedRecipes.java#L22-L75' : 'ShapelessRecipes.java#L20-L47'}`,
        supports: 'matching, translation/mirror or exact shapeless multiset; bound to the selected registration type',
      },
      {
        uri: `${sourceBase}/SlotCrafting.java#L31-L46`,
        supports: 'claim-time input consumption and container item remainder',
      },
      {
        uri: `${sourceBase}/ContainerPlayer.java#L12-L45`,
        supports: '2x2 inventory crafting matrix and shared CraftingManager lookup; workstation claim also needs recipe-shape review',
      },
      {
        uri: `${sourceBase}/ContainerWorkbench.java#L4-L40`,
        supports: '3x3 workbench crafting matrix and shared CraftingManager lookup; workstation claim also needs recipe-shape review',
      },
    ],
    unresolved:
      '重构源码与官方 jar 的逐方法对应、逐项来源审查、固定初态/RNG/输入和正反例仍未封板；不得只凭生成结果宣称已冻结。',
    referenceStatus: 'SOURCE_CANDIDATE_REVIEW',
  });
}

const smeltRows = inventory.split('\n').filter((line) => /^\| S\d\d\s+\|/.test(line));
const smeltInputs = [15, 14, 12, 4, 337, 17, 319, 349, 81, 56];
for (const line of smeltRows) {
  const fields = line
    .split('|')
    .slice(1, -1)
    .map((part) => part.trim());
  const inputId = smeltInputs[Number(fields[0].slice(1)) - 1];
  const registered = smeltByInputId.get(inputId);
  if (!registered) throw new Error(`Missing smelting source for ${fields[0]} input ${inputId}`);
  cases.push({
    caseId: `R-${fields[0]}`,
    kind: 'smelting',
    scope: fields[2],
    action: `把 ${fields[1].split('→')[0]} 放入熔炉输入槽并供给已登记燃料；检查产出、消耗、进度与恢复。`,
    expected: {
      input: { id: inputId, metadata: -1, metadataIgnoredByLookup: true, count: 1 },
      output: registered.output,
      cookTicks: 200,
      inputConsumption: 1,
      outputRequiresMatchingIdAndAvailableStackCapacity: true,
    },
    evidence: [
      {
        uri: `${sourceBase}/FurnaceRecipes.java#L${registered.line}`,
        supports: 'input/output registration; lookup keyed by input item ID',
      },
      {
        uri: `${sourceBase}/TileEntityFurnace.java#L105-L182`,
        supports: 'cook progression, slot result and input consumption',
      },
      { uri: `${wikiBase}/general/recipes/smelting.md`, supports: 'input/output and fuel candidates' },
    ],
    unresolved: '燃料/熔岩桶余物依 M18 共用合同；本行固定初态、tick 输入、输出槽边界和正反例尚未封板。',
    referenceStatus: 'PARTIAL_REFERENCE_GAP',
  });
}

const mechanismRows = mechanisms.split('\n').filter((line) => /^\|\s*M\d\d-\d\d\s*\|/.test(line));
const mechanismCounts = new Map();
const mechanismSourceCandidates = new Map([
  ['M02', ['WorldInfo.java', 'World.java', 'WorldChunkManager.java']],
  ['M03', ['ChunkProviderGenerate.java', 'MapGenCaves.java', 'WorldGenMinable.java']],
  ['M04', ['WorldChunkManager.java', 'BiomeGenBase.java', 'WorldGenTrees.java']],
  ['M05', ['WorldGenDungeons.java', 'TileEntityMobSpawner.java']],
  ['M06', ['Chunk.java', 'ChunkProviderLoadOrGenerate.java', 'World.java']],
  ['M07', ['AxisAlignedBB.java', 'Block.java', 'Entity.java']],
  ['M08', ['PlayerControllerSP.java', 'ItemTool.java', 'Block.java']],
  ['M09', ['ItemBlock.java', 'ItemDoor.java', 'BlockBed.java']],
  ['M10', ['BlockFlowing.java', 'BlockFluid.java', 'ItemBucket.java']],
  ['M11', ['Chunk.java', 'MetadataChunkBlock.java', 'World.java']],
  ['M12', ['BlockFire.java', 'Explosion.java', 'EntityTNTPrimed.java']],
  ['M13', ['World.java', 'EntityLightningBolt.java']],
  ['M14', ['Entity.java', 'EntityPlayerSP.java', 'MovementInputFromOptions.java']],
  ['M15', ['EntityLiving.java', 'EntityPlayer.java', 'ItemFood.java']],
  ['M16', ['InventoryPlayer.java', 'Container.java', 'Slot.java']],
  ['M17', ['CraftingManager.java', 'InventoryCrafting.java', 'SlotCrafting.java']],
  ['M18', ['TileEntityFurnace.java', 'FurnaceRecipes.java']],
  ['M19', ['BlockChest.java', 'BlockBed.java', 'BlockSign.java', 'BlockJukeBox.java']],
  ['M20', ['SpawnerAnimals.java', 'EntityLiving.java']],
  ['M21', ['Pathfinder.java', 'EntityCreature.java']],
  ['M22', ['EntityMob.java', 'EntityArrow.java', 'EntityLiving.java']],
  ['M23', ['World.java', 'BlockCrops.java', 'BlockFarmland.java']],
  ['M24', ['Item.java', 'ItemStack.java', 'ItemDye.java']],
  ['M25', ['EntityFish.java', 'EntityEgg.java', 'EntitySheep.java', 'EntityWolf.java']],
  ['M26', ['BlockRail.java', 'EntityMinecart.java', 'EntityBoat.java']],
  ['M27', ['ItemMap.java', 'MapData.java', 'TextureCompassFX.java', 'TextureWatchFX.java']],
  ['M28', ['GuiMainMenu.java', 'GameSettings.java', 'StatList.java']],
  ['M29', ['GuiIngame.java', 'GuiInventory.java', 'GuiFurnace.java']],
  ['M30', ['RenderBlocks.java', 'RenderGlobal.java']],
  ['M31', ['RenderLiving.java', 'ModelBiped.java', 'EntityRenderer.java']],
  ['M32', ['SoundManager.java', 'SoundPool.java']],
  ['M33', ['WorldInfo.java', 'ChunkLoader.java', 'SaveHandler.java']],
]);
// M14–M33 rows seed only the candidate/source collection. Their output expected
// is replaced by the corrected, line-anchored mechanism source review below.
const mechanismFactRows = String.raw`M01-01	版本 ID 为 b1.7.3，客户端 SHA-1 为 43db9b498cb67058d2e12d394e6507722e71bb45。	https://piston-meta.mojang.com/v1/packages/44f6969326bd45aa00dcd3c4ca3a7c05ebb24c04/b1.7.3.json
M02-01	GuiCreateWorld uses a nonzero parsed long, a signed Java String.hashCode for nonnumeric text, or a random long for empty/zero text; WorldInfo persists the resulting long seed. The fixed text classic-b173-acceptance-v1 hashes to 1817698218.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiCreateWorld.java#L65-L90	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldInfo.java
M02-02	ChunkProviderGenerate seeds its terrain RNG from the world seed; exact noise call order and any Seedlands generatorVersion mapping remain an unresolved golden-fixture question.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkProviderGenerate.java
M02-03	世界信息持久化 RandomSeed、SpawnX/Y/Z、Time、雨/雷状态；旧档缺失字段与迁移另行验收。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldInfo.java
M03-01	世界区块为 16×128×16 方块；跨区块夹具不能按 Seedlands 自身的 32 边长代替原版地形采样。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/worlds/chunk.md
M03-02	主世界地形生成在群系表土替换之后调用 MapGenCaves；同 seed 洞穴连通结果仍需黄金样本。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkProviderGenerate.java
M03-03	矿脉和其他填充尝试次数/高度分布以 mechanism-world-candidates.json 的逐方法复核为准；青金石 Y 使用两个 nextInt(16) 求和，不是均匀取值。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkProviderGenerate.java
M03-04	表土替换由高处向下到 y=0；底层基岩依据每格随机 nextInt(5)，沙层耗尽后有砂岩续层路径。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkProviderGenerate.java
M04-01	WorldChunkManager derives biome/temperature/rainfall arrays from its seeded noise generators; boundary cells require fixed coordinate samples.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldChunkManager.java
M04-02	WorldGenTrees checks height, clear space and grass/dirt support before its first write; a precondition failure returns false without writing, but later setBlock failure has no proven rollback.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldGenTrees.java
M04-03	该版本的 ChunkProviderGenerate.populate 内联群系装饰，没有 biome.decorate 调用；各物种尝试次数见 mechanism-world-candidates.json。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkProviderGenerate.java
M04-04	World.updateBlocksAndPlayCaveSounds samples one position in sixteen for snow/ice and requires a snowy biome, light below 10 and raining conditions for snow placement.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M05-01	每区块执行 8 次地牢生成尝试；房间横向半径各为 2 或 3、竖向高度 3，入口空洞计数需 1–5 才成功。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldGenDungeons.java
M05-02	地牢笼种类、战利品表与笼激活/延迟分别属于 WorldGenDungeons 和 TileEntityMobSpawner；逐方法复核见 mechanism-world-candidates.json。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldGenDungeons.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityMobSpawner.java
M05-03	主世界新建出生搜索的候选从 (0,64,0) 开始并寻找 first-uncovered sand；显式重选规则不同，详见 mechanism-world-candidates.json。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldProvider.java
M06-01	一个原版区块含方块、4-bit 元数据、方块光、天光、高度图以及实体/方块实体状态；卸载/加载不得丢失这些观察维度。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/worlds/chunk.md
M06-02	GameSettings.renderDistance is consumed by the renderer; visual fog and chunk appearance order are client-render observations, not a deterministic world-state result.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GameSettings.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderGlobal.java
M06-03	World block/entity operations are guarded by chunk existence/loading paths; exact unloaded-boundary behavior must be fixed per operation rather than inferred from one guard.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkProviderLoadOrGenerate.java
M07-01	Block.collisionRayTrace uses the block bounds and Entity movement queries colliding AABBs; ray-start/end and face tie breaks need explicit fixtures.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Block.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java
M07-02	BlockStairs decomposes each orientation into two collision boxes; doors, beds and rails have their own metadata-dependent collision/placement classes.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockStairs.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockDoor.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockBed.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockRail.java
M07-03	Block transparency/face culling is controlled by opacity/render predicates; leaves explicitly switch opaque status with graphicsLevel, so visual mode is a fixture input.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Block.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockLeaves.java
M08-01	单次挖掘进度：硬度<0 为 0；不可采掘为 1/(硬度×100)；可采掘为玩家当前工具强度/(硬度×30)。正确工具/材质矩阵另核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Block.java
M08-02	Drop identity/count is block-specific: BlockOre and BlockLeaves override idDropped/quantityDropped, and PlayerControllerSP only calls harvestBlock when the player can harvest.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockOre.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockLeaves.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/PlayerControllerSP.java
M08-03	The reconstructed EnumToolMaterial gives WOOD/STONE/IRON/EMERALD/GOLD max uses 59/131/250/1561/32; base ItemTool uses damageItem(2) on entity hit and damageItem(1) on block destruction, and ItemStack breaks only above maxDamage. Subclasses and invalid actions remain unresolved.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EnumToolMaterial.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemTool.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemStack.java
M08-04	同目标的 sendBlockRemoving 调用累积挖掘进度；挖掘声按调用计数旧值 %4 触发，并非固定伤害增量；达到 1 后 blockHitWait=5。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/PlayerControllerSP.java
M09-01	ItemBlock placement delegates side/replaceability checks to World and block placement predicates; post-placement neighbor notification is part of the operation path.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemBlock.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M09-02	Door/Bed/Sign/Painting 先执行各自前置；画的无效表面返回 true 但不生成/扣物。Door/Bed/Sign 没有检查逐次 world set 返回值，不能宣称通用原子回滚。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemDoor.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemBed.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemPainting.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemSign.java
M09-03	PlayerController.sendPlaceBlock 先以 blockActivated 返回值裁决，false 才尝试非空手持物；空气右键另由 Minecraft.clickMouse 分支处理。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/PlayerController.java
M10-01	水流动方块的计划更新间隔候选为 5 tick；具体下坡寻路、源再生及更新顺序另核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFluid.java
M10-02	熔岩的计划更新间隔候选为 30 tick；熔岩遇水时源级元数据 0 变黑曜石、1–4 变圆石。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFluid.java
M10-03	Entity handles water/lava material checks while ItemBucket has separate source pickup/placement paths; buoyancy, drowning and fire are not one fluid rule.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemBucket.java
M10-04	BlockFlowing.updateTick attempts downward flow first; if blocked and side-flow conditions hold, it calls flowIntoBlock in x-, x+, z-, z+ order. The unloaded-chunk boundary remains unresolved.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFlowing.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M11-01	无遮挡天空光等级为 15，光等级范围为 0–15；遮挡更新后的精确传播次序仍待核。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/rendering/lighting.md
M11-02	光值按本地发光/天空源与六邻居最大旧光减实际 block opacity 裁决；opacity 为 0 时当 1，不能把所有方块写成固定衰减 1。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/MetadataChunkBlock.java
M11-03	方块光/天光变化通过保存的光值与相邻六方向的传播更新；具体队列先后、跨区块与火/液体反例未封板。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/MetadataChunkBlock.java
M11-04	WorldProvider.calculateCelestialAngle uses world time modulo 24000 and World.calculateSkylightSubtracted derives the light subtraction from that angle.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldProvider.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M11-05	WorldProvider 的 16 级 brightness table 有数值公式；原创材质最终感知等效仍需合法独立参照和人审，不能由公式代替。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldProvider.java
M12-01	BlockFire.updateTick checks rain exposure, age metadata and neighboring encouragement/flammability before spread/extinguish branches.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFire.java
M12-02	正常点燃 TNT 的实体引信初始为 80 tick，逐 tick 递减并在耗尽时爆炸；链爆随机引信和爆炸传播另核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityTNTPrimed.java
M12-03	Explosion separates ray/block collection from entity damage/knockback and a later visual/sound phase; fixed blast origin, power and RNG are necessary to assert an exact result.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Explosion.java
M13-01	World.updateWeather decrements persisted timers and toggles at zero; rain-on/off durations are nextInt(12000)+12000 / nextInt(168000)+12000, thunder-on/off are nextInt(12000)+3600 / nextInt(168000)+12000, and both strengths change by 0.01 per call, clamped to [0,1].	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M13-02	雷暴中活跃区块每次更新以 nextInt(100000)==0 作为闪电候选，再检查最高实体块和可受雨条件；雷击实体作用另核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M13-03	Rain exposure is decided by World.canBlockBeRainedOn (rain state, sky visibility and top-block relation); each fire/crop/render consequence remains a separate case.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFire.java
M14-01	EntityLiving movement applies acceleration/friction in onLivingUpdate and EntityPlayerSP supplies sampled movement input; browser frame timing cannot substitute for tick input.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayerSP.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/MovementInputFromOptions.java
M14-02	Entity.moveEntity resolves collision AABBs and has a stepHeight branch; stair/edge/entity-push outcomes need independently fixed start boxes.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java
M14-03	EntityLiving distinguishes water, lava, ladder and ground movement; Entity accumulates fallDistance but EntityLiving.fall applies living-entity damage.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java
M14-04	EntityRenderer owns view bob and mouse-driven camera transforms; sensitivity and first-person feedback are visual/input fixtures.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityRenderer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GameSettings.java
M15-01	ItemFood.onItemRightClick 每次减少手持堆叠 1，并调用玩家 heal(healAmount)；是否不存在饥饿值、全部食物恢复量与冷却仍待独立确认。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemFood.java#L14-L17
M15-02	玩家受伤先以 (25-护甲值)×原始伤害+余数 除以 25 取整，余数保留到下次；护甲同时按原始伤害耗损。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayer.java
M15-03	EntityPlayer.onDeath drops inventory, and bed/spawn state is handled through player/world spawn methods; drop ordering and respawn protection need a save/resume fixture.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/InventoryPlayer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M15-04	World.tick passes the hostile-spawn flag; existing hostile entities are removed in EntityMob.onUpdate under peaceful difficulty, while player healing has its own branch.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityMob.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayer.java
M16-01	玩家主背包 36 格、装备栏 4 格；当前快捷栏索引仅 0–8 有效，堆叠还受每物品上限和库存 64 上限约束。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/InventoryPlayer.java
M16-02	Container.slotClick is the authoritative click transaction path; button, shift modifier and carried stack must be enumerated as fixture inputs.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Container.java
M16-03	InventoryPlayer serializes 36 main slots and four armor slots to NBT; close/death/container transaction ordering needs a separate trace.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/InventoryPlayer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayer.java
M17-01	玩家背包提供 2×2 合成格，工作台提供 3×3；有形配方须按注册图样而非材料集合匹配。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/recipes/crafting.md
M17-02	每次从合成输出槽取物，对每个非空材料格消耗 1；若材料带容器余物，把余物放回该格（例如奶桶→空桶）。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SlotCrafting.java
M17-03	GuiCrafting and SlotCrafting expose the workbench/output interaction, but each recipe golden case remains registered separately in CraftingManager/helper recipe classes.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiCrafting.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SlotCrafting.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/CraftingManager.java
M18-01	熔炉合格输入且有燃料时连续烹饪 200 tick 产出一件；木质材料/木棍/煤/熔岩桶/树苗燃烧时长候选为 300/100/1600/20000/100 tick。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java
M18-02	熔炉有输入/燃料/输出 3 槽；输出若与结果物品不一致或超过容量，不得继续熔炼。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java
M18-03	TileEntityFurnace.updateEntity toggles the furnace block state while retaining its inventory; a lava bucket is fuel here and does not automatically yield an empty bucket in this path.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TileEntityFurnace.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFurnace.java
M19-01	BlockChest checks adjacent chest blocks and obstruction before opening its inventory path; double-chest merge/split needs orientation and blocker fixtures.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockChest.java
M19-02	白天睡觉返回 NOT_POSSIBLE_NOW；玩家到床的各轴距离上限为水平 3、竖直 2，超出返回 TOO_FAR_AWAY。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayer.java
M19-03	Sign, painting and record behaviour are separate item/block/tile paths; text encoding, support-loss and record playback must not be collapsed into one expected result.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemSign.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemPainting.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockJukeBox.java
M20-01	敌对生物自然生成先以天空光与 nextInt(32) 比较，再以局部亮度与 nextInt(8) 比较，并执行基础可生成位置条件。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityMob.java
M20-02	自然刷怪按群系对应物种列表的 spawnRarityRate 权重抽取，并在选中区块内尝试成组位置；各类上限仍待核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SpawnerAnimals.java
M20-03	EntityLiving.despawnEntity uses nearest-player distance, age and RNG; EntityWolf overrides canDespawn so tamed status is an exception.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityWolf.java
M21-01	寻路对实体 AABB、固体、水、熔岩及门开启状态判通行；直路与门/水/熔岩反例需分开。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/entities/pathfinding.md
M21-02	寻路候选为三维 A*；启发式为三维欧氏距离，按累计代价加启发值选节点。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/entities/pathfinding.md
M21-03	EntityCreature obtains targets through findPlayerToAttack and updates path state; species subclasses supply neutral/hostile target logic, so no universal aggro threshold is asserted.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityCreature.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityMob.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityWolf.java
M21-04	已形成的路线按三维路点顺序前进，抵近当前点再切下一点；高处路点触发跳跃。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/entities/pathfinding.md
M21-05	驯服狼在距离大于 5 时寻路跟随；只有路径为 null 且距离大于 12 时尝试传送回退。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/entities/pathfinding.md	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityWolf.java
M22-01	EntityPlayer attack and EntityLiving damage paths determine melee hit/knockback; weapon cooldown/aim need exact actor and tick fixtures.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPlayer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java
M22-02	EntityArrow performs block/entity ray hit and update motion; recovery, skeleton firing and obstruction are separate branches.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityArrow.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntitySkeleton.java
M22-03	Item/ItemTool/armor and entity drop methods distribute equipment and drop rules; the full table belongs to item/entity cases, not one generic mechanic constant.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Item.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemTool.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java
M22-04	Entity and EntityLiving contain distinct drowning, fire, fall and environmental damage branches; each source has its own preconditions and resistance timer interaction.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockCactus.java
M23-01	活跃区块每轮抽取 80 个方块位置执行可随机更新的方块；计划 tick 队列每轮处理上限候选为 1000。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java
M23-02	耕地/小麦元数据均为 0–7 阶段；耕地随机更新有 1/5 门槛，水平四格内水或上方受雨使湿度为 7，否则逐次减 1；小麦生长要求上方光等级至少 9。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockFarmland.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockCrops.java
M23-03	仙人掌和甘蔗的生长进度使用 0–15 元数据；完整 random tick 次序仍待核。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/blocks.md
M24-01	非方块物品 ID 集合为 256–359 及唱片 2256、2257；具体使用规则逐物品核。	https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/items.md
M24-02	Item.getIconFromDamage and item subclasses select atlas indices from item metadata; visual hand-model parity still needs an original-reference review.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Item.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemStack.java
M24-03	ItemDye, ItemMap, ItemFishingRod and ItemRecord implement distinct use/metadata paths; all-item availability cannot be inferred from numeric IDs alone.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemDye.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemMap.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemFishingRod.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemRecord.java
M25-01	EntityFish has randomized bite timing but successful catch produces a fixed raw fish rather than randomized loot; water, weather and RNG fixtures remain required.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityFish.java
M25-02	鸡蛋命中后以 1/8 门槛孵鸡，成功时再以 1/32 门槛从 1 只变为 4 只；桶余物另核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityEgg.java
M25-03	持剪刀剪未剪羊掉同色羊毛 2–4、剪刀损耗 1；狼用骨头驯服成功门槛为 1/3。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntitySheep.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityWolf.java
M26-01	BlockRail delegates shape refresh to RailLogic; fixtures must include four horizontal directions at current y and upper/lower levels, not a fixed six-neighbor set.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/BlockRail.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RailLogic.java
M26-02	EntityMinecart owns rail acceleration, friction, collision and rider branches; exact speed is state/metadata dependent.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityMinecart.java
M26-03	EntityBoat owns water collision/buoyancy and breaking, while EntityPig has the saddle/rider behaviour; neither generalizes to the other vehicle.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityBoat.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityPig.java
M26-04	Entity.mountEntity maintains runtime rider/vehicle links, but base Entity NBT does not serialize these links; save/resume preservation must not be asserted without another source.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java
M27-01	TextureCompassFX derives the compass target from the world spawn coordinates; animation/rotation sampling still needs a fixed render-time fixture.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TextureCompassFX.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldInfo.java
M27-02	TextureWatchFX derives its animation from World.getCelestialAngle, whose overworld period is 24000 ticks.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/TextureWatchFX.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldProvider.java
M27-03	ItemMap and MapData own map recording/persistence; color raster and exploration sampling must be fixed at a chosen player position/tick.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemMap.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/MapData.java
M28-01	GuiMainMenu supplies the beta menu choices and GuiSelectWorld/GuiCreateWorld own local world selection/creation; multiplayer is explicitly outside this contract.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiMainMenu.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiSelectWorld.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiCreateWorld.java
M28-02	GameSettings owns option values/default bindings and GUI option screens apply them; each setting requires an immediate-effect UI fixture.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GameSettings.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiOptions.java
M28-03	GuiIngame and GUI screen handling distinguish in-game overlays/menus; focus-loss and reconnect feedback are client-observation cases, not world-oracle facts.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiIngame.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/MinecraftAppletImpl.java
M28-04	GameSettings contains the beta key defaults; hand-feel/sensitivity needs a fixed input-device and visual review, not only a key table.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GameSettings.java
M28-05	从合成输出槽取得工作台、木/石镐、熔炉、木锄、面包、蛋糕或木剑时分别触发对应成就登记；完整依赖图另核。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SlotCrafting.java
M28-06	StatList declares statistic identities and player stat storage persists them; display formatting and all triggers require per-stat cases.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/StatList.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/StatFileWriter.java
M29-01	GuiIngame renders health, armor, air, hotbar and crosshair from player state; exact pixels require a fixed viewport/UI-scale fixture.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiIngame.java
M29-02	GuiInventory, GuiCrafting, GuiFurnace and GuiChest own distinct container screens; inventory transaction truth remains in Container/Slot code.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiInventory.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiFurnace.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiChest.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Container.java
M29-03	FontRenderer and GUI code define beta text/grid rendering paths, but multi-resolution perceptual equivalence needs a review rubric.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/FontRenderer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiScreen.java
M30-02	RenderBlocks/RenderGlobal branch by block render type and texture/particle effects; every block variant still needs a separately licensed visual reference.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderBlocks.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderGlobal.java
M30-03	World/RenderGlobal/EntityRenderer connect celestial light, sky/fog and destruction effects; perceptual calibration is not proven by these code paths alone.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderGlobal.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityRenderer.java
M31-01	RenderLiving and ModelBiped provide model/pose paths, but an independently authored rig/animation needs visual state-by-state review.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderLiving.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ModelBiped.java
M31-02	RenderManager dispatches entity renderers, RenderLiving draws living models and ModelBiped handles biped poses; full equipment rendering remains unproven.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderManager.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/RenderLiving.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ModelBiped.java
M31-03	EntityRenderer renders first-person item/hand feedback while entity state supplies hit/death inputs; exact composition is visual evidence.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityRenderer.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/EntityLiving.java
M32-01	SoundManager chooses/plays named sounds and SoundPool stores candidates; spatial mix is a client/audio observation, not a gameplay-state constant.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SoundManager.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SoundPool.java
M32-03	Entity, weather and GUI paths submit distinct sound event names; mapping and original audio similarity need separate human/audio review.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/Entity.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/World.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/GuiScreen.java
M33-01	WorldInfo NBT 保存世界随机种子、出生坐标、世界时间、雨/雷状态及玩家标签；实体/方块/物品同 frontier 一致性是 Seedlands 额外合同。	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldInfo.java
M33-02	SaveHandler uses temporary/old level files but save methods do not call checkSessionLock or verify delete/rename results; ChunkLoader deletes old chunks before rename, so atomic recovery is not proven.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SaveHandler.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ChunkLoader.java
M33-03	WorldInfo persists a save version while SaveHandler loads level.dat/level.dat_old; resource digest and user-facing load errors are Seedlands contract additions.	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/WorldInfo.java	https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/SaveHandler.java`;
const mechanismFacts = new Map(
  mechanismFactRows
    .trim()
    .split('\n')
    .map((row) => {
      const [caseId, partialExpected, ...evidenceUris] = row.split('\t');
      return [caseId, [partialExpected, ...evidenceUris]];
    }),
);

const nonOracleMechanismCases = new Set([
  'M01-02',
  'M01-03',
  'M01-04',
  'M24-04',
  'M30-01',
  'M30-04',
  'M32-02',
  'M32-04',
  'M34-01',
  'M34-02',
  'M34-03',
  'M34-04',
  'M35-01',
  'M35-02',
  'M35-03',
  'M36-01',
  'M36-02',
  'M36-03',
  'M36-04',
]);
for (const line of mechanismRows) {
  const fields = line
    .split('|')
    .slice(1, -1)
    .map((part) => part.trim());
  const caseId = fields[0];
  const group = caseId.slice(0, 3);
  const ordinal = (mechanismCounts.get(group) ?? 0) + 1;
  mechanismCounts.set(group, ordinal);
  if (caseId !== `${group}-${String(ordinal).padStart(2, '0')}`)
    throw new Error(`Out-of-order or missing mechanism ID ${caseId}`);
  const fact = mechanismFacts.get(caseId);
  const isNonOracle = nonOracleMechanismCases.has(caseId);
  const project = projectExpected[caseId];
  if (isNonOracle !== Boolean(project)) throw new Error(`Project expected coverage mismatch ${caseId}`);
  cases.push({
    caseId,
    kind: 'mechanism',
    scope: '做',
    action: `以固定 seed/初态/输入验证：${fields[1]}；记录正例、失败例、tick 和 owner 状态。`,
    expected: isNonOracle
      ? { projectContractExpected: project.expected, negativeControl: project.negative }
      : fact
        ? { sourcedPartialExpected: fact[0] }
        : null,
    evidence: isNonOracle
      ? [{ uri: project.source, supports: 'first-party project contract, not original game oracle' }]
      : fact
        ? fact.slice(1).map((uri) => ({
            uri,
            supports: 'stated partial behavior or constant; source-specific audit still required',
          }))
        : [],
    sourceCandidates: (mechanismSourceCandidates.get(group) ?? []).map((file) => `${sourceBase}/${file}`),
    evidenceLayer: fields[3],
    unresolved: isNonOracle
      ? '项目合同预期已有候选，但 owner/用户审核、逐案固定夹具和实际设备/资源证据未完成；不能计为原版玩法 oracle。'
      : fact
        ? '仅此事实有来源；同一子项的完整输入、逐 tick 轨迹、边界和分布仍未封板。'
        : '尚无可直接绑定此子项的原版 expected 数值/事件序列；不能由标题或 Seedlands 实测反推。',
    referenceStatus: isNonOracle
      ? 'PROJECT_CONTRACT_CANDIDATE_REVIEW'
      : fact
        ? 'PARTIAL_REFERENCE_GAP'
        : 'REFERENCE_GAP',
  });
}

const kinds = Object.fromEntries(
  [...new Set(cases.map((entry) => entry.kind))].map((kind) => [
    kind,
    cases.filter((entry) => entry.kind === kind).length,
  ]),
);
if (
  kinds.block !== 97 ||
  kinds.item !== 106 ||
  kinds.entity !== 30 ||
  kinds.crafting !== 150 ||
  kinds.smelting !== 10 ||
  kinds.mechanism !== 129
) {
  throw new Error(`Unexpected case cardinality: ${JSON.stringify(kinds)}`);
}
const playCandidateCatalog = JSON.parse(await readFile(join(root, 'mechanism-play-candidates.json'), 'utf8'));
const worldCandidateCatalog = JSON.parse(await readFile(join(root, 'mechanism-world-candidates.json'), 'utf8'));
mergeWorldMechanismCandidates(cases, worldCandidateCatalog);
const mechanismReview = parseMechanismSourceReview(
  await readFile(join(root, 'mechanism-play-source-review.md'), 'utf8'),
);
mergeMechanismSourceReview(cases, playCandidateCatalog, mechanismReview);
initializeReferenceReview(cases, { betaWikiCommit, reconstructedCommit });
await writeFile(
  join(root, 'reference-cases.json'),
  `${JSON.stringify({ schemaVersion: 3, referenceCaseSetVersion: 16, status: 'PARTIAL_REFERENCE_GAP', sourceCommits: { technicalBetaWiki: betaWikiCommit, reconstructedSource: reconstructedCommit, retroMcRevision: 9822 }, counts: kinds, cases }, null, 2)}\n`,
);
await writeFile(join(root, 'items.md'), `${itemLines.join('\n')}\n`);
console.log(JSON.stringify({ total: cases.length, counts: kinds }));
