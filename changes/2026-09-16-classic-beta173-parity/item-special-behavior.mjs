export function specialFor(c, source) {
  const baseBehavior = source(
    'Item.java',
    '155-L205',
    'base use/right-click/hit/destroy defaults and damageability predicate',
  );
  const e = c.expected;
  const klass = e.staticRegistration.className;
  const id = e.id;
  const heal = e.staticRegistration.instantHeal ?? null;
  const wolfFavorite = e.staticRegistration.ctorArguments?.[2] === 'true';
  const standard = {
    Item: {
      source: [baseBehavior],
      positive: {
        action: 'rightClick',
        setup: 'exact stack present',
        expect: 'same stack object/no count change candidate',
      },
      negative: { action: 'onItemUse', setup: 'any target', expect: 'false candidate' },
      special: { kind: 'BASE_NO_CUSTOM_USE_CANDIDATE' },
      av: { kind: 'NO_ITEM_CLASS_AUDIO_VISUAL_EVENT_CANDIDATE' },
    },
    ItemFood: {
      source: [source('ItemFood.java', '7-L18', 'right-click consumes one and heals constructor amount')],
      positive: {
        action: 'rightClick',
        setup: 'count=1, living player, not full hunger model not audited',
        expect: `count decreases by one; health delta candidate=${heal}`,
      },
      negative: {
        action: 'rightClick',
        setup: 'count=0',
        expect: 'no valid consumable stack; runtime behavior unexecuted',
      },
      special: { kind: 'FOOD_HEAL_CANDIDATE', healAmount: heal, wolfFavorite },
      av: { kind: 'FOOD_AUDIO_VISUAL_GAP' },
    },
    ItemCookie: {
      source: [
        source('ItemCookie.java', '3-L7', 'inherits food use and overrides stack limit'),
        source('ItemFood.java', '7-L18', 'right-click food candidate'),
      ],
      positive: {
        action: 'rightClick',
        setup: 'count=1',
        expect: `count decreases by one; health delta candidate=${heal}`,
      },
      negative: {
        action: 'rightClick',
        setup: 'count=0',
        expect: 'no valid consumable stack; runtime behavior unexecuted',
      },
      special: { kind: 'FOOD_HEAL_CANDIDATE', healAmount: heal, stackOverride: 8 },
      av: { kind: 'FOOD_AUDIO_VISUAL_GAP' },
    },
    ItemSoup: {
      source: [source('ItemSoup.java', '8-L11', 'food result is replaced by empty bowl')],
      positive: { action: 'rightClick', setup: 'count=1', expect: 'returns item 281 empty bowl candidate' },
      negative: {
        action: 'rightClick',
        setup: 'count=0',
        expect: 'no valid consumable stack; runtime behavior unexecuted',
      },
      special: { kind: 'FOOD_WITH_REMAINDER_CANDIDATE', healAmount: heal, remainderItemId: 281 },
      av: { kind: 'FOOD_AUDIO_VISUAL_GAP' },
    },
    ItemBucket: {
      source: [
        source(
          'ItemBucket.java',
          '12-L99',
          'source/lava collection, cow milk, placement and Nether water effect candidates',
        ),
      ],
      positive: {
        action: 'rightClick',
        setup:
          id === 325
            ? 'empty bucket + source water/lava (metadata 0)'
            : 'filled bucket + legal destination/cow for milk',
        expect: id === 325 ? 'returns water/lava bucket candidate' : 'returns empty bucket candidate',
      },
      negative: {
        action: 'rightClick',
        setup: 'non-source fluid, illegal target, or unsupported entity',
        expect: 'unchanged stack candidate',
      },
      special: { kind: 'BUCKET_FLUID_OR_MILK_CANDIDATE', itemId: id, sourceMetadataMustBeZero: id === 325 },
      av: {
        kind: 'BUCKET_NETHER_WATER_CANDIDATE',
        sound: 'random.fizz',
        particles: 'largesmoke x8',
        onlyForWaterInHell: true,
      },
    },
    ItemBow: {
      source: [
        source(
          'ItemBow.java',
          '9-L18',
          'requires arrow inventory, plays bow sound and spawns arrow outside multiplayer world',
        ),
      ],
      positive: {
        action: 'rightClick',
        setup: 'inventory contains item 262 arrow',
        expect: 'arrow inventory decreases; bow stack unchanged; arrow entity candidate',
      },
      negative: { action: 'rightClick', setup: 'inventory lacks item 262', expect: 'unchanged bow/no spawn candidate' },
      special: { kind: 'RANGED_PROJECTILE_CANDIDATE', projectile: 'EntityArrow', consumedInventoryItem: 262 },
      av: { kind: 'SOUND_AND_ENTITY_CANDIDATE', sound: 'random.bow' },
    },
    ItemEgg: {
      source: [
        source('ItemEgg.java', '9-L17', 'consumes stack, plays bow sound and spawns egg outside multiplayer world'),
      ],
      positive: { action: 'rightClick', setup: 'count=1', expect: 'count decreases; EntityEgg candidate' },
      negative: { action: 'rightClick', setup: 'count=0', expect: 'no valid stack' },
      special: { kind: 'THROWN_ENTITY_CANDIDATE', entity: 'EntityEgg' },
      av: { kind: 'SOUND_AND_ENTITY_CANDIDATE', sound: 'random.bow' },
    },
    ItemSnowball: {
      source: [
        source(
          'ItemSnowball.java',
          '9-L17',
          'consumes stack, plays bow sound and spawns snowball outside multiplayer world',
        ),
      ],
      positive: { action: 'rightClick', setup: 'count=1', expect: 'count decreases; EntitySnowball candidate' },
      negative: { action: 'rightClick', setup: 'count=0', expect: 'no valid stack' },
      special: { kind: 'THROWN_ENTITY_CANDIDATE', entity: 'EntitySnowball' },
      av: { kind: 'SOUND_AND_ENTITY_CANDIDATE', sound: 'random.bow' },
    },
    ItemFishingRod: {
      source: [source('ItemFishingRod.java', '18-L33', 'cast/retrieve branching and retrieved-item damage candidate')],
      positive: { action: 'rightClick', setup: 'no active bobber', expect: 'EntityFish candidate, stack unchanged' },
      negative: {
        action: 'rightClick',
        setup: 'active bobber with deterministic catch value absent',
        expect: 'catch/durability exact value GAP',
      },
      special: { kind: 'FISHING_STATE_CANDIDATE', maxDamage: 64 },
      av: { kind: 'SOUND_AND_ENTITY_CANDIDATE', sound: 'random.bow' },
    },
    ItemFlintAndSteel: {
      source: [
        source(
          'ItemFlintAndSteel.java',
          '10-L43',
          'target shift, air-only fire placement, ignition sound and durability candidate',
        ),
      ],
      positive: {
        action: 'onItemUse',
        setup: 'adjacent target is air',
        expect: 'fire placement plus durability +1 candidate',
      },
      negative: {
        action: 'onItemUse',
        setup: 'adjacent target non-air',
        expect: 'no fire; source still damages item and returns true candidate',
      },
      special: { kind: 'IGNITE_CANDIDATE', maxDamage: 64 },
      av: { kind: 'SOUND_CANDIDATE', sound: 'fire.ignite' },
    },
    ItemHoe: {
      source: [source('ItemHoe.java', '10-L25', 'grass/dirt till candidate, placement sound and durability candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'eligible grass/dirt target with air above',
        expect: 'farmland candidate and durability +1',
      },
      negative: {
        action: 'onItemUse',
        setup: 'ineligible block or occupied above',
        expect: 'false/no damage candidate',
      },
      special: { kind: 'TILL_CANDIDATE', maxDamage: e.staticRegistration.maxUses },
      av: { kind: 'TILL_SOUND_GAP' },
    },
    ItemDoor: {
      source: [
        source('ItemDoor.java', '12-L72', 'upper-face placement, two-block state and count decrement candidate'),
      ],
      positive: {
        action: 'onItemUse',
        setup: 'upper face + placeable two-block space',
        expect: 'door lower/upper states; count decreases',
      },
      negative: {
        action: 'onItemUse',
        setup: 'non-upper face or blocked space',
        expect: 'false/no decrement candidate',
      },
      special: { kind: 'TWO_BLOCK_DOOR_CANDIDATE' },
      av: { kind: 'PLACEMENT_AUDIO_GAP' },
    },
    ItemBed: {
      source: [source('ItemBed.java', '8-L42', 'upper-face placement with two supports/air cells candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'upper face; both support cubes normal and two destination cells air',
        expect: 'two bed states and count decreases candidate',
      },
      negative: {
        action: 'onItemUse',
        setup: 'bad face/support/occupied destination',
        expect: 'false/no decrement candidate',
      },
      special: { kind: 'TWO_BLOCK_BED_CANDIDATE' },
      av: { kind: 'PLACEMENT_AUDIO_GAP' },
    },
    ItemBoat: {
      source: [source('ItemBoat.java', '9-L46', 'ray trace and block-hit boat spawn candidate')],
      positive: {
        action: 'rightClick',
        setup: 'ray trace hits a block',
        expect: 'EntityBoat candidate and count decreases',
      },
      negative: { action: 'rightClick', setup: 'ray trace misses', expect: 'same stack candidate' },
      special: { kind: 'BOAT_ENTITY_CANDIDATE' },
      av: { kind: 'ENTITY_SPAWN_AUDIO_GAP' },
    },
    ItemMinecart: {
      source: [source('ItemMinecart.java', '12-L24', 'rail-only spawn, type and decrement candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'target is rail',
        expect: 'matching minecart entity candidate and count decreases',
      },
      negative: { action: 'onItemUse', setup: 'target is not rail', expect: 'false/no decrement candidate' },
      special: { kind: 'MINECART_ENTITY_CANDIDATE', minecartType: e.staticRegistration.ctorArguments?.[1] ?? 'GAP' },
      av: { kind: 'ENTITY_SPAWN_AUDIO_GAP' },
    },
    ItemPainting: {
      source: [source('ItemPainting.java', '8-L38', 'side-only placement and valid-surface branching candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'horizontal face + valid painting surface',
        expect: 'EntityPainting candidate and count decreases',
      },
      negative: { action: 'onItemUse', setup: 'top/bottom face', expect: 'false candidate' },
      special: { kind: 'PAINTING_SURFACE_CANDIDATE' },
      av: { kind: 'ENTITY_SPAWN_AUDIO_GAP' },
    },
    ItemSign: {
      source: [source('ItemSign.java', '9-L53', 'support/face placement, orientation and sign editor candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'solid support and placeable target',
        expect: 'post/wall sign state, count decreases and editor candidate',
      },
      negative: {
        action: 'onItemUse',
        setup: 'bottom face or non-solid support',
        expect: 'false/no decrement candidate',
      },
      special: { kind: 'SIGN_TILE_ENTITY_AND_EDITOR_CANDIDATE' },
      av: { kind: 'SIGN_GUI_CANDIDATE' },
    },
    ItemRecord: {
      source: [source('ItemRecord.java', '12-L25', 'empty jukebox only; record event and decrement candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'jukebox metadata 0',
        expect: 'aux event 1005 and count decreases candidate',
      },
      negative: { action: 'onItemUse', setup: 'not an empty jukebox', expect: 'false/no decrement candidate' },
      special: { kind: 'JUKEBOX_RECORD_CANDIDATE', recordName: e.staticRegistration.ctorArguments?.[1] ?? 'GAP' },
      av: { kind: 'AUX_SOUND_EVENT_CANDIDATE', eventId: 1005 },
    },
    ItemMap: {
      source: [
        source('ItemMap.java', '22-L37', 'lazy map data creation/initialization candidate'),
        source('ItemMap.java', '213-L238', 'held update and creation state candidate'),
      ],
      positive: {
        action: 'onCreated/onUpdate',
        setup: 'world unique map ID and player context',
        expect: 'damage becomes map ID; MapData center/scale/dimension candidate',
      },
      negative: {
        action: 'onUpdate',
        setup: 'non-player or non-held state',
        expect: 'visible-player/update branch not taken candidate',
      },
      special: { kind: 'MAP_AUXILIARY_WORLD_STATE_CANDIDATE', scale: 3 },
      av: { kind: 'MAP_RENDER_AND_SAMPLING_GAP' },
    },
    ItemDye: {
      source: [
        source('ItemDye.java', '4-L11', '16 metadata variants candidate'),
        source('ItemDye.java', '21-L90', 'bone-meal and sheep dye candidates'),
      ],
      positive: {
        action: 'onItemUse/saddleEntity',
        setup: 'metadata 15 + eligible plant, or unshorn sheep with different color',
        expect: 'candidate effect and count decreases',
      },
      negative: {
        action: 'onItemUse',
        setup: 'metadata not 15 or ineligible target',
        expect: 'no bone-meal placement candidate',
      },
      special: {
        kind: 'DYE_METADATA_CANDIDATE',
        values: e.metadataSubcases?.values ?? 'GAP',
        sheepColorConversion: true,
      },
      av: { kind: 'DYE_GRASS_RANDOM_SPREAD_GAP' },
    },
    ItemSaddle: {
      source: [source('ItemSaddle.java', '9-L23', 'unsaddled pig only and decrement candidate')],
      positive: {
        action: 'saddleEntity',
        setup: 'unsaddled EntityPig',
        expect: 'pig saddled and count decreases candidate',
      },
      negative: {
        action: 'saddleEntity',
        setup: 'already saddled pig or non-pig',
        expect: 'no state/count change candidate',
      },
      special: { kind: 'PIG_SADDLE_CANDIDATE' },
      av: { kind: 'NO_ITEM_CLASS_AUDIO_VISUAL_EVENT_CANDIDATE' },
    },
    ItemSeeds: {
      source: [source('ItemSeeds.java', '11-L24', 'upper face + tilled field + air placement candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'upper face, tilled field and air above',
        expect: 'crop placement and count decreases candidate',
      },
      negative: {
        action: 'onItemUse',
        setup: 'wrong face, non-tilled field, or occupied above',
        expect: 'false/no decrement candidate',
      },
      special: { kind: 'CROP_PLACEMENT_CANDIDATE' },
      av: { kind: 'PLACEMENT_AUDIO_GAP' },
    },
    ItemReed: {
      source: [source('ItemReed.java', '11-L55', 'generic block placement and snow special case candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'nonzero count + canBlockBePlacedAt',
        expect: 'registered block placement and count decreases candidate',
      },
      negative: { action: 'onItemUse', setup: 'count=0', expect: 'false candidate' },
      special: { kind: 'BLOCK_ITEM_PLACEMENT_CANDIDATE' },
      av: { kind: 'PLACEMENT_SOUND_GAP' },
    },
    ItemRedstone: {
      source: [source('ItemRedstone.java', '8-L45', 'wire placement candidate')],
      positive: {
        action: 'onItemUse',
        setup: 'placeable wire target',
        expect: 'redstone wire and count decreases candidate',
      },
      negative: { action: 'onItemUse', setup: 'unplaceable target', expect: 'false/no decrement candidate' },
      special: { kind: 'WIRE_PLACEMENT_CANDIDATE' },
      av: { kind: 'PLACEMENT_AUDIO_GAP' },
    },
    ItemShears: {
      source: [source('ItemShears.java', '10-L28', 'leaf/web durability, harvest and speed candidates')],
      positive: { action: 'onBlockDestroyed', setup: 'leaves or web', expect: 'durability +1 candidate' },
      negative: {
        action: 'onBlockDestroyed',
        setup: 'ordinary block',
        expect: 'no ItemShears durability path candidate',
      },
      special: { kind: 'SHEARS_HARVEST_SPEED_CANDIDATE', maxDamage: e.staticRegistration.maxUses },
      av: { kind: 'NO_ITEM_CLASS_AUDIO_VISUAL_EVENT_CANDIDATE' },
    },
    ItemTool: {
      source: [source('ItemTool.java', '9-L45', 'tool stack/durability/strength/entity candidate')],
      positive: { action: 'hitEntity', setup: 'living target', expect: 'durability +2 candidate' },
      negative: {
        action: 'onBlockDestroyed',
        setup: 'air block ID 0',
        expect: 'no generic block-destruction damage candidate',
      },
      special: { kind: 'TOOL_DURABILITY_AND_EFFECTIVE_BLOCK_GAP', maxDamage: e.staticRegistration.maxUses },
      av: { kind: 'NO_ITEM_CLASS_AUDIO_VISUAL_EVENT_CANDIDATE' },
    },
    ItemSpade: null,
    ItemPickaxe: null,
    ItemAxe: null,
    ItemSword: {
      source: [source('ItemSword.java', '6-L37', 'weapon damage, web behavior and durability candidates')],
      positive: { action: 'hitEntity', setup: 'living target', expect: 'durability +1 candidate' },
      negative: { action: 'onBlockDestroyed', setup: 'air block ID 0', expect: 'no destruction damage candidate' },
      special: { kind: 'SWORD_DAMAGE_AND_WEB_CANDIDATE', maxDamage: e.staticRegistration.maxUses },
      av: { kind: 'NO_ITEM_CLASS_AUDIO_VISUAL_EVENT_CANDIDATE' },
    },
    ItemArmor: {
      source: [source('ItemArmor.java', '4-L19', 'armor reduction/durability construction candidates')],
      positive: {
        action: 'equip',
        setup: 'valid armor slot',
        expect: 'equip behavior is a GAP outside ItemArmor constructor',
      },
      negative: { action: 'equip', setup: 'wrong slot', expect: 'rejection behavior GAP' },
      special: { kind: 'ARMOR_STAT_CANDIDATE', maxDamage: e.staticRegistration.maxUses },
      av: { kind: 'ARMOR_RENDER_AND_DAMAGE_PIPELINE_GAP' },
    },
    ItemCoal: {
      source: [source('ItemCoal.java', '3-L12', 'subtype and coal/charcoal label candidate')],
      positive: { action: 'inspectMetadata', setup: 'damage=1', expect: 'charcoal label candidate' },
      negative: { action: 'inspectMetadata', setup: 'damage=2', expect: 'coal label candidate (all non-1 values)' },
      special: { kind: 'COAL_METADATA_CANDIDATE', charcoalDamage: 1 },
      av: { kind: 'NO_ITEM_CLASS_AUDIO_VISUAL_EVENT_CANDIDATE' },
    },
  };
  if (['ItemSpade', 'ItemPickaxe', 'ItemAxe'].includes(klass))
    return {
      ...standard.ItemTool,
      special: {
        kind: `${klass.toUpperCase()}_DURABILITY_AND_EFFECTIVE_BLOCK_GAP`,
        maxDamage: e.staticRegistration.maxUses,
      },
    };
  return standard[klass] ?? { ...standard.Item, special: { kind: 'UNCLASSIFIED_BEHAVIOR_GAP', className: klass } };
}
