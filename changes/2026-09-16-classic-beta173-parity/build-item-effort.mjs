import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'reference-cases.json'), 'utf8'));
const items = catalog.cases.filter((entry) => entry.kind === 'item');
if (items.length !== 106 || items.filter((entry) => entry.scope === '做').length !== 99) {
  throw new Error('Item effort denominator drift');
}

// M24 has 32/52 PD: 4/6 common atlas/pipeline and 28/46 individual item
// registration, art and special-state QA. These weights distribute the latter;
// they do not claim measured productivity or add new PD to the project total.
const weights = {
  Item: 1,
  ItemSpade: 1.4,
  ItemPickaxe: 1.4,
  ItemAxe: 1.4,
  ItemSword: 1.4,
  ItemHoe: 1.4,
  ItemArmor: 1.5,
  ItemFood: 1.3,
  ItemBucket: 2.2,
  ItemMap: 3,
  ItemDye: 3,
  ItemRecord: 2,
  ItemCoal: 1.7,
  ItemMinecart: 2,
  ItemFishingRod: 2.2,
  ItemShears: 2,
  ItemFlintAndSteel: 2,
  ItemBow: 2,
  ItemPainting: 2,
  ItemSign: 1.8,
  ItemDoor: 1.8,
  ItemSnowball: 1.7,
  ItemBoat: 1.8,
  ItemEgg: 1.7,
  ItemBed: 1.8,
  ItemCookie: 1.3,
  ItemSoup: 1.7,
  ItemSeeds: 1.3,
  ItemSaddle: 1.7,
  ItemRedstone: 1.4,
  ItemReed: 1.4,
};
const rows = items.map((entry) => {
  const className = entry.expected.staticRegistration.className;
  const weight = entry.scope === '做' ? weights[className] : 0;
  if (weight === undefined) throw new Error('Unknown item class ' + className);
  return { id: entry.caseId, name: entry.expected.name, scope: entry.scope, className, weight };
});

function allocate(totalHundredths) {
  const sum = rows.reduce((value, row) => value + row.weight, 0);
  const exact = rows.map((row) => (row.weight / sum) * totalHundredths);
  const values = exact.map(Math.floor);
  let remainder = totalHundredths - values.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - values[index] }))
    .filter(({ index }) => rows[index].weight > 0)
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index++) values[order[index].index]++;
  return values.map((value) => value / 100);
}
const normal = allocate(2800);
const conservative = allocate(4600);
const lines = [
  '# 非方块物品逐 ID 工作量分摊（M24 内部，不加总两次）',
  '',
  '本表把 [M24](mechanics.md) 的逐物品登记、原创图标/手持表现和特殊状态 QA 共 **28/46 PD** 分配给 99 个纳入物品；另有 **4/6 PD** 为全体共用图集、动画/透明/高 DPI 管线和 QA，仍留在 M24。106 个 ID 均登记，4 个 `存`、3 个 `排`只作清单与负例，实施费用记 0。权重按注册类和特殊状态复杂度分配，纯规划口径；世界/战斗/背包/合成/交通等共享机制分别在对应 M 行，不能把本表当成完整单品交付价格。',
  '',
  '| Case | 物品 | 范围 | 源码候选类 | 权重 | 正常 PD | 保守 PD | 单品验收工作 |',
  '| --- | --- | :---: | --- | ---: | ---: | ---: | --- |',
];
for (const [index, row] of rows.entries()) {
  const task =
    row.scope === '做'
      ? 'ID/取得、堆叠/元数据、使用/余物、原创图标/持物、存档及正反例'
      : '注册/可获得性与排除路径负例；不实现可玩交互';
  lines.push(
    `| ${row.id} | ${row.name} | ${row.scope} | ${row.className} | ${row.weight} | ${normal[index].toFixed(2)} | ${conservative[index].toFixed(2)} | ${task} |`,
  );
}
lines.push(
  '',
  '合计：逐物品 **28.00/46.00 PD**；M24 共用管线 **4.00/6.00 PD**；M24 总额仍为 **32.00/52.00 PD**，整个项目 [总预算](estimates.md)不因此增加。',
  '',
);
await writeFile(join(root, 'item-effort.md'), lines.join('\n'));
console.log(
  JSON.stringify({
    items: rows.length,
    included: rows.filter((row) => row.scope === '做').length,
    normalPd: normal.reduce((a, b) => a + b, 0),
    conservativePd: conservative.reduce((a, b) => a + b, 0),
  }),
);
