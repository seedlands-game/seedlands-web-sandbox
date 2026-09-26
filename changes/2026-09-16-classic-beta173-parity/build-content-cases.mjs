import {
  metadataSubcases,
  itemMetadataSubcases,
  blockBehaviorCandidates,
  entityNames,
  runtimeEntities,
  entityBehaviorAnchors,
  entityObservations,
} from './content-subcases.mjs';

function tableRows(text, heading, nextHeading) {
  const start = text.indexOf(heading);
  const end = nextHeading ? text.indexOf(nextHeading, start + heading.length) : text.length;
  if (start < 0 || end < 0) throw new Error(`Missing heading: ${heading}`);
  return text
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('|'));
}

function plain(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim();
}

function sourceLine(text, index) {
  if (index < 0) return null;
  return text.slice(0, index).split('\n').length;
}

function sourceLocation(file, line, anchor) {
  return { file, ...(line === null ? {} : { line }), anchor };
}

export function buildContentCases({
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
}) {
  function parseWikiRegistry(text, ending) {
    const map = new Map();
    const section = text.slice(text.indexOf('## Listing'), text.indexOf(ending, text.indexOf('## Listing')));
    for (const line of section.split('\n')) {
      const fields = line
        .split('|')
        .slice(1, -1)
        .map((part) => part.trim());
      if (!/^\d+$/.test(fields[0] ?? '')) continue;
      const id = Number(fields[0]);
      if (map.has(id)) throw new Error(`Duplicate wiki ID ${id}`);
      map.set(id, { name: plain(fields[1] ?? ''), metadataUse: plain(fields.at(-1) ?? '') });
    }
    return map;
  }

  const blocks = parseWikiRegistry(blockText, '# Metadata');
  const items = parseWikiRegistry(itemText, '# Metadata');
  const registeredBlocks = new Map();
  for (const [index, line] of blockSource.split('\n').entries()) {
    const match = line.match(/^\s*(\w+)\s*=.*?new (Block\w*)\((\d+)(?:,|\))/);
    if (!match) continue;
    const id = Number(match[3]);
    if (id < 1 || id > 96) continue;
    const parameter = (name) => line.match(new RegExp(`\\.${name}\\((-?[\\d.]+)F?\\)`))?.[1];
    const lightParameter = parameter('setLightValue');
    registeredBlocks.set(id, {
      field: match[1],
      className: match[2],
      explicitHardness: parameter('setHardness') === undefined ? null : Number(parameter('setHardness')),
      explicitLightLevel: lightParameter === undefined ? null : Math.trunc(15 * Number(lightParameter)),
      explicitLightOpacity: parameter('setLightOpacity') === undefined ? null : Number(parameter('setLightOpacity')),
      explicitResistanceArgument: parameter('setResistance') === undefined ? null : Number(parameter('setResistance')),
      explicitStepSound: line.match(/\.setStepSound\((\w+)\)/)?.[1] ?? null,
      explicitlyUnbreakable: line.includes('.setBlockUnbreakable()'),
      sourceLocation: sourceLocation('Block.java', index + 1, 'static registration'),
    });
  }
  registeredBlocks.set(35, {
    field: 'cloth',
    className: 'BlockCloth',
    explicitHardness: 0.8,
    explicitLightLevel: null,
    explicitLightOpacity: null,
    explicitResistanceArgument: null,
    explicitStepSound: 'soundClothFootstep',
    explicitlyUnbreakable: false,
    sourceLocation: sourceLocation(
      'Block.java',
      sourceLine(blockSource, blockSource.indexOf('cloth =')),
      'static registration',
    ),
  });
  if (registeredBlocks.size !== 96)
    throw new Error(`Expected 96 non-air block registrations, got ${registeredBlocks.size}`);

  const toolMaterials = new Map([
    ['WOOD', { maxUses: 59, harvestLevel: 0, efficiency: 2, bonusDamage: 0 }],
    ['STONE', { maxUses: 131, harvestLevel: 1, efficiency: 4, bonusDamage: 1 }],
    ['IRON', { maxUses: 250, harvestLevel: 2, efficiency: 6, bonusDamage: 2 }],
    ['EMERALD', { maxUses: 1561, harvestLevel: 3, efficiency: 8, bonusDamage: 3 }],
    ['GOLD', { maxUses: 32, harvestLevel: 0, efficiency: 12, bonusDamage: 0 }],
  ]);
  // These are source navigation hints, not a claim that an interaction has been
  // fixture-verified.  They keep every registered item tied to the method that
  // must be read before its use semantics become contractual.
  const itemBehaviorAnchors = new Map([
    ['Item', 'base constructor and default Item hooks'],
    ['ItemTool', 'getStrVsBlock, hitEntity, onBlockDestroyed'],
    ['ItemSpade', 'constructor / effective-block list'],
    ['ItemPickaxe', 'canHarvestBlock / effective-block list'],
    ['ItemAxe', 'constructor / effective-block list'],
    ['ItemSword', 'getDamageVsEntity, hitEntity, onBlockDestroyed'],
    ['ItemHoe', 'onItemUse'],
    ['ItemFood', 'onItemRightClick'],
    ['ItemSoup', 'onItemRightClick'],
    ['ItemCookie', 'constructor'],
    ['ItemBow', 'onItemRightClick'],
    ['ItemBucket', 'onItemRightClick'],
    ['ItemDoor', 'onItemUse / placeDoorBlock'],
    ['ItemSign', 'onItemUse'],
    ['ItemMinecart', 'onItemUse'],
    ['ItemSaddle', 'itemInteractionForEntity / hitEntity'],
    ['ItemBoat', 'onItemRightClick'],
    ['ItemFishingRod', 'onItemRightClick'],
    ['ItemFlintAndSteel', 'onItemUse'],
    ['ItemMap', 'constructor / map update path'],
    ['ItemShears', 'onBlockDestroyed'],
    ['ItemRecord', 'onItemUse'],
    ['ItemSnowball', 'onItemRightClick'],
    ['ItemEgg', 'onItemRightClick'],
    ['ItemSeeds', 'onItemUse'],
    ['ItemPainting', 'onItemUse'],
    ['ItemBed', 'onItemUse'],
    ['ItemReed', 'onItemUse'],
    ['ItemBlock', 'onItemUse'],
    ['ItemSlab', 'getItemNameIS'],
    ['ItemSapling', 'getItemNameIS'],
    ['ItemLeaves', 'getItemNameIS'],
    ['ItemLog', 'getItemNameIS'],
    ['ItemPiston', 'constructor'],
    ['ItemDye', 'onItemUse / saddleEntity'],
    ['ItemCoal', 'getItemNameIS'],
  ]);
  const registeredItems = new Map();
  for (const [index, line] of itemSource.split('\n').entries()) {
    const match = line.match(/^\s*(\w+)\s*=.*?new (Item\w*)\((\d+)(?:,|\))/);
    if (!match) continue;
    const id = Number(match[3]) + 256;
    if (!(id >= 256 && id <= 359) && id !== 2256 && id !== 2257) continue;
    const className = match[2];
    const materialName = line.match(/EnumToolMaterial\.(\w+)/)?.[1];
    const material = materialName ? toolMaterials.get(materialName) : null;
    const ctorArgs =
      line
        .match(new RegExp(`new ${className}\\(([^)]*)\\)`))?.[1]
        .split(',')
        .map((part) => part.trim()) ?? [];
    const singleStackClasses = new Set([
      'ItemTool',
      'ItemSpade',
      'ItemPickaxe',
      'ItemAxe',
      'ItemSword',
      'ItemHoe',
      'ItemArmor',
      'ItemBow',
      'ItemFood',
      'ItemSoup',
      'ItemBucket',
      'ItemDoor',
      'ItemSign',
      'ItemMinecart',
      'ItemSaddle',
      'ItemBoat',
      'ItemFishingRod',
      'ItemFlintAndSteel',
      'ItemMap',
      'ItemShears',
      'ItemRecord',
    ]);
    const explicitStack = line.match(/\.setMaxStackSize\((\d+)\)/)?.[1];
    const stackLimit = explicitStack
      ? Number(explicitStack)
      : className === 'ItemCookie'
        ? Number(ctorArgs[3])
        : className === 'ItemSnowball' || className === 'ItemEgg'
          ? 16
          : singleStackClasses.has(className)
            ? 1
            : 64;
    const fixedDurability = {
      ItemShears: 238,
      ItemFishingRod: 64,
      ItemFlintAndSteel: 64,
    }[className];
    const armorSlot = className === 'ItemArmor' ? Number(ctorArgs[3]) : null;
    const armorLevel = className === 'ItemArmor' ? Number(ctorArgs[1]) : null;
    registeredItems.set(id, {
      field: match[1],
      className,
      ctorArguments: ctorArgs,
      sourceLocation: sourceLocation('Item.java', index + 1, 'static registration'),
      stackLimit,
      maxUses:
        material?.maxUses ??
        fixedDurability ??
        (armorSlot === null ? null : ([11, 16, 15, 13][armorSlot] * 3) << armorLevel),
      ...(materialName ? { toolMaterial: materialName, toolMaterialStats: material } : {}),
      ...(armorSlot === null ? {} : { armorSlot, armorLevel, armorReduction: [3, 8, 6, 3][armorSlot] }),
      ...(className === 'ItemFood' || className === 'ItemSoup' || className === 'ItemCookie'
        ? { instantHeal: Number(ctorArgs[1]) }
        : {}),
      containerItem: line.match(/\.setContainerItem\((\w+)\)/)?.[1] ?? (className === 'ItemSoup' ? 'bowlEmpty' : null),
    });
  }
  if (registeredItems.size !== 106) throw new Error(`Expected 106 item registrations, got ${registeredItems.size}`);

  const registeredEntities = new Map();
  for (const match of entityListSource.matchAll(/addMapping\((Entity\w+)\.class, "(\w+)", (\d+)\)/g)) {
    const [, className, name, id] = match;
    registeredEntities.set(name, {
      className,
      numericId: Number(id),
      sourceLocation: sourceLocation('EntityList.java', sourceLine(entityListSource, match.index), 'static addMapping'),
    });
  }
  const dropSections = [
    ['self', '### Blocks that drop themselves', '### Blocks that drop something unique'],
    ['unique', '### Blocks that drop something unique', "### Blocks that can't be broken"],
    ['unbreakable', "### Blocks that can't be broken", '### Blocks that drop nothing'],
    ['none', '### Blocks that drop nothing', '## Mobs'],
  ];
  const blockDrops = new Map();
  for (const [kind, heading, nextHeading] of dropSections) {
    for (const line of tableRows(dropsText, heading, nextHeading)) {
      const fields = line
        .split('|')
        .slice(1, -1)
        .map((part) => plain(part));
      if (!/^\d+$/.test(fields[0] ?? '')) continue;
      const id = Number(fields[0]);
      const observation =
        kind === 'unique'
          ? {
              kind,
              result: id === 74 ? 'Redstone Dust (ditto ID 73 in source table)' : fields[2],
              note:
                id === 74
                  ? 'Same as ID 73: 4 to 6 items, requires iron or diamond pickaxe; source table uses ditto marks'
                  : fields[3] || null,
            }
          : { kind, note: fields[2] || null };
      blockDrops.set(id, [...(blockDrops.get(id) ?? []), observation]);
    }
  }
  const retroItems = new Map();
  const retroSection = retroText.slice(retroText.indexOf('=== Items ==='));
  for (const line of retroSection.split('\n')) {
    if (!line.startsWith('| ') || !line.includes('||')) continue;
    const match = line.match(/^\|\s*(?:\{\{MCColor\|(&[42])\|)?(\d+)(?:l|\/0)?(?:\}\})?\s*\|\|\s*(.*)$/);
    if (!match) continue;
    const name = match[3].replace(/^https?:\/\/\S+\s*/, '').trim();
    retroItems.set(Number(match[2]), { name, available: match[1] ? false : true });
  }

  const cases = [];
  for (const line of tableRows(inventory, '## 方块：', '## 实体：')) {
    const fields = line
      .split('|')
      .slice(1, -1)
      .map((part) => part.trim());
    if (!/^\d+$/.test(fields[0] ?? '')) continue;
    const id = Number(fields[0]);
    const wiki = blocks.get(id);
    if (!wiki) throw new Error(`Missing block reference ID ${id}`);
    const registration = id === 0 ? { field: 'air', className: null } : registeredBlocks.get(id);
    if (!registration) throw new Error(`Missing block source registration ID ${id}`);
    cases.push({
      caseId: `B-${String(id).padStart(3, '0')}`,
      kind: 'block',
      scope: fields[2],
      action: `在固定夹具中读取 ID ${id} 的注册身份、元数据；按范围验证自然生存取得或隔离，并尝试其正常交互。`,
      expected: {
        id,
        name: wiki.name,
        metadataPurpose: wiki.metadataUse || null,
        staticRegistration: registration,
        ...(metadataSubcases.has(id) ? { metadataSubcases: metadataSubcases.get(id) } : {}),
        dropObservations: blockDrops.get(id) ?? [],
        ...(blockBehaviorCandidates.has(id) ? { sourcedBehaviorCandidate: blockBehaviorCandidates.get(id).text } : {}),
        ...(id === 25 ? { manualUse: 'left click plays; right click changes pitch and plays' } : {}),
      },
      evidence: [
        { uri: `${wikiBase}/general/blocks.md`, supports: 'ID/name/metadata purpose' },
        {
          uri: `${sourceBase}/Block.java${registration.sourceLocation ? `#L${registration.sourceLocation.line}` : ''}`,
          supports: 'static registration class, explicit hardness/light/step sound parameters',
        },
        { uri: retroPage, supports: 'ID/name and historical obtainability list' },
        ...(blockDrops.has(id)
          ? [
              {
                uri: `${wikiBase}/general/drops.md`,
                supports: 'candidate block drop observations; source declares gaps and unchecked claims',
              },
            ]
          : []),
        ...(id === 25 ? [{ uri: `${sourceBase}/BlockNote.java`, supports: 'manual left/right click behavior' }] : []),
        ...(blockBehaviorCandidates.has(id)
          ? [{ uri: `${sourceBase}/${blockBehaviorCandidates.get(id).file}`, supports: 'specific behavior candidate' }]
          : []),
        ...(metadataSubcases.has(id)
          ? [
              {
                uri: `${sourceBase}/${metadataSubcases.get(id).file}`,
                supports: 'metadata variants and state-bit candidate',
              },
            ]
          : []),
      ],
      unresolved:
        '逐方块碰撞、放置、挖掘时间、掉落反例/工具/概率、音画和保存细节仍须原版源码核对；掉落表自称未完全复核。',
      referenceStatus: 'PARTIAL_REFERENCE_GAP',
    });
  }

  const scopeOverrides = new Map([
    [330, '排'],
    [348, '排'],
    [356, '排'],
  ]);
  const itemLines = [
    '# Beta 1.7.3 非方块物品逐 ID 登记（候选）',
    '',
    '登记 ID、名称、历史可获得性、范围，以及源码候选的堆叠/耐久/瞬时回血；细使用、掉落、图标和持物仍需逐项来源化。来源是 [Technical Beta Wiki 固定提交](' +
      `${wikiBase}/general/items.md` +
      ') 与 [RetroMC 固定修订](' +
      retroPage +
      ')。`排` 是本项目红石/多维度边界，不等于原版不存在。',
    '',
    '| ID | 名称 | 范围 | 有来源的 expected | 未定项 |',
    '| --: | --- | :--: | --- | --- |',
  ];
  for (const [id, wiki] of [...items].sort(([a], [b]) => a - b)) {
    const retro = retroItems.get(id);
    if (!retro) throw new Error(`Missing RetroMC item ID ${id}`);
    const registration = registeredItems.get(id);
    if (!registration) throw new Error(`Missing item source registration ID ${id}`);
    const scope = scopeOverrides.get(id) ?? (retro.available ? '做' : '存');
    const available = retro.available ? '原版合法取得' : '原版普通流程不可取得';
    const metadata = wiki.metadataUse ? `；元数据：${wiki.metadataUse}` : '';
    const registerFacts = `；堆叠上限候选 ${registration.stackLimit}${registration.maxUses === null ? '' : `、耐久候选 ${registration.maxUses}`}${registration.instantHeal === undefined ? '' : `、瞬时回血 ${registration.instantHeal}`}`;
    const scopeConstraint =
      id === 331
        ? '；只作音符盒/时钟/指南针配方材料，右键放置红石线排除'
        : id === 259
          ? '；正常点火保留，黑曜石框架不生成传送门（维度排除例外）'
          : '';
    itemLines.push(
      `| ${id} | ${wiki.name} | ${scope} | ID=${id}；${available}${metadata}${registerFacts}${scopeConstraint} | 使用/视觉与例外取得途径；源码值待复核 |`,
    );
    cases.push({
      caseId: `I-${id}`,
      kind: 'item',
      scope,
      action: `在物品注册表读取 ID ${id}；用固定夹具检查取得或禁止取得、背包流转、使用和恢复。`,
      expected: {
        id,
        name: wiki.name,
        metadataPurpose: wiki.metadataUse || null,
        historicalObtainability: retro.available ? 'obtainable' : 'not-ordinary-obtainable',
        ...(scopeConstraint ? { scopeConstraint: scopeConstraint.slice(1) } : {}),
        staticRegistration: registration,
        sourceBehaviorCandidate: {
          file: `${registration.className}.java`,
          anchor: itemBehaviorAnchors.get(registration.className) ?? 'constructor and Item overrides',
          status: 'navigation only; no fixture expectation asserted',
        },
        ...(itemMetadataSubcases.has(id) ? { metadataSubcases: itemMetadataSubcases.get(id) } : {}),
      },
      evidence: [
        { uri: `${wikiBase}/general/items.md`, supports: 'ID/name/metadata purpose' },
        { uri: retroPage, supports: 'ID/name and historical obtainability mark' },
        {
          uri: `${sourceBase}/Item.java#L${registration.sourceLocation.line}`,
          supports: 'registered class, constructor arguments and explicit stack overrides',
        },
        ...(registration.toolMaterial
          ? [
              {
                uri: `${sourceBase}/EnumToolMaterial.java`,
                supports: 'max uses, harvest level, efficiency and damage bonus',
              },
            ]
          : []),
        ...(registration.className === 'ItemArmor'
          ? [{ uri: `${sourceBase}/ItemArmor.java`, supports: 'armor durability and reduction' }]
          : []),
        ...(registration.className === 'ItemFood' ||
        registration.className === 'ItemSoup' ||
        registration.className === 'ItemCookie'
          ? [{ uri: `${sourceBase}/ItemFood.java`, supports: 'instant healing and single-stack food base' }]
          : []),
        {
          uri: `${sourceBase}/${registration.className}.java`,
          supports: 'subclass stack and durability candidate where applicable',
        },
      ],
      unresolved: '逐物品数量、堆叠、耐久、取得来源、使用/交互、资源与恢复尚未逐项考证。',
      referenceStatus: 'PARTIAL_REFERENCE_GAP',
    });
  }

  const entityRows = tableRows(inventory, '## 实体：', '## 配方：').filter((line) =>
    /^\| [^|]+ \|\s*[做排存核]\s*\|/.test(line),
  );
  if (entityRows.length !== entityNames.length) throw new Error('Entity names/rows mismatch');
  for (const [index, line] of entityRows.entries()) {
    const fields = line
      .split('|')
      .slice(1, -1)
      .map((part) => part.trim());
    const name = entityNames[index];
    const registered = registeredEntities.get(name);
    const runtime = runtimeEntities.get(name);
    if (!registered && !runtime) throw new Error(`Unmapped entity row ${name}`);
    const className = registered?.className ?? runtime.className;
    cases.push({
      caseId: `E-${name}`,
      kind: 'entity',
      scope: fields[1],
      action: `建立 ${fields[0]} 的合法生成/派生夹具，观察移动、交互、伤害、掉落和恢复。`,
      expected: {
        inventoryLabel: fields[0],
        registeredName: registered ? name : null,
        numericId: registered?.numericId ?? null,
        sourceLocation: registered?.sourceLocation ?? null,
        className,
        sourceBehaviorCandidate: {
          file: `${className}.java`,
          anchor: entityBehaviorAnchors.get(name) ?? 'constructor, update and persistence methods',
          status: 'navigation only; no fixture expectation asserted',
        },
        ...(runtime?.variant ? { variant: runtime.variant } : {}),
        ...(entityObservations.has(name) ? { sourcedBehaviorCandidate: entityObservations.get(name) } : {}),
        candidateBehaviorFromInventoryNotReference: fields[3],
        ...(fields[0].includes('PigZombie')
          ? { overworldConversion: 'pig struck by lightning becomes PigZombie' }
          : {}),
      },
      evidence: [
        {
          uri: `${sourceBase}/EntityList.java${registered ? `#L${registered.sourceLocation.line}` : ''}`,
          supports: registered
            ? 'registered name, numeric ID and implementation class'
            : 'absence from named registration is not proof of absence from runtime',
        },
        {
          uri: `${sourceBase}/${className}.java`,
          supports: 'runtime implementation class and derived variant candidate',
        },
        ...(fields[0].includes('PigZombie')
          ? [{ uri: `${sourceBase}/EntityPig.java`, supports: 'lightning conversion' }]
          : []),
      ],
      unresolved:
        '已定位注册/运行时身份；生成、AI、AABB、数值、掉落、声音、保存与反例仍需逐方法原版核对。清单备注不能当来源断言。',
      referenceStatus: 'PARTIAL_REFERENCE_GAP',
    });
  }

  return { cases, itemLines };
}
