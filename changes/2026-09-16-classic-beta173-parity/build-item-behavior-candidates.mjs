#!/usr/bin/env node
/**
 * Builds source-candidate item behavior fixtures without reading or running a
 * proprietary client. The input registry remains the owner of ID/name/scope.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { specialFor } from './item-special-behavior.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const input = resolve(dir, 'reference-cases.json');
const output = resolve(dir, 'item-behavior-candidates.json');
const revision = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const sourceBase = `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${revision}/1.7.3-LTS/src/minecraft/net/minecraft/src`;
const link = (file, lines) => `${sourceBase}/${file}#L${lines}`;
const source = (file, lines, supports) => ({
  uri: link(file, lines),
  supports,
  evidence: 'RECONSTRUCTED_SOURCE_CANDIDATE',
});
const universalPersistence = source('ItemStack.java', '75-L85', 'NBT candidate: id, Count and Damage are written/read');

function candidateFor(c) {
  const e = c.expected;
  const r = e.staticRegistration;
  const behavior = specialFor(c, source);
  const scopeExcluded = c.scope !== '做';
  const max = r.stackLimit;
  const durable = Number.isInteger(r.maxUses) && r.maxUses > 0;
  return {
    caseId: c.caseId,
    item: { id: e.id, name: e.name, scope: c.scope, historicalObtainability: e.historicalObtainability },
    candidateStatus: 'SOURCE_CANDIDATE_NOT_APPROVED',
    sourceLinks: [...c.evidence, ...behavior.source],
    registrationCandidate: r,
    acquisitionFixture: scopeExcluded
      ? {
          kind: 'PROFILE_ACCESS_NEGATIVE_ONLY',
          positive: null,
          negative: {
            setup: `profile denies ${c.scope} item`,
            expect: 'cannot obtain/use through profile fixture candidate',
          },
        }
      : {
          kind: 'INVENTORY_SEED_CANDIDATE',
          positive: { setup: `seed exact item ${e.id} count=1`, expect: 'item becomes reachable in fixture inventory' },
          negative: { setup: `item ${e.id} absent`, expect: 'use precondition fails/no item action candidate' },
        },
    stackFixture: {
      maxStackCandidate: max,
      positive: { setup: `count=${max}`, expect: 'registered stack limit candidate' },
      negative: {
        setup: `count=${max + 1}`,
        expect: 'inventory merge/rejection behavior not executed; must not be accepted as verified',
      },
    },
    durabilityFixture: durable
      ? {
          kind: 'DAMAGE_VALUE_CANDIDATE',
          maxUses: r.maxUses,
          positive: {
            setup: 'damage=0 and class-specific successful action',
            expect: 'only class-specific damage delta asserted as candidate',
          },
          negative: {
            setup: `damage=${r.maxUses}`,
            expect: 'break boundary requires executed fixture; static ItemStack uses strictly greater-than check',
          },
          source: source('ItemStack.java', '124-L138', 'damage/break threshold candidate'),
        }
      : {
          kind: 'NOT_DURABLE_CANDIDATE',
          maxUses: null,
          negative: {
            setup: 'attempt durability assertion',
            expect: 'must be rejected: no positive maxUses registration candidate',
          },
        },
    remainderFixture: r.containerItem
      ? {
          kind: 'CONTAINER_ITEM_CANDIDATE',
          item: r.containerItem,
          positive: { setup: 'crafting-grid consumption path', expect: `container item ${r.containerItem} candidate` },
          negative: { setup: 'ordinary use path', expect: 'not inferred from crafting container declaration' },
        }
      : {
          kind: 'NO_STATIC_CONTAINER_ITEM_CANDIDATE',
          note: 'This does not rule out a class-specific right-click replacement (for example soup/buckets).',
        },
    behaviorFixture: behavior,
    specialStateCandidate: behavior.special,
    audioVisualCandidate: behavior.av,
    persistenceCandidate:
      e.id === 358
        ? {
            kind: 'ITEMSTACK_PLUS_MAPDATA_CANDIDATE',
            itemStack: universalPersistence,
            mapData: behavior.source.filter((x) => x.uri.includes('ItemMap.java')),
          }
        : { kind: 'ITEMSTACK_NBT_CANDIDATE', source: universalPersistence },
    gaps: [
      'OFFICIAL_B173_JAR_TO_SOURCE_MAPPING_MISSING',
      'FIXTURE_NOT_EXECUTED',
      'NO_APPROVAL_OR_DESIGN_FREEZE',
      ...(scopeExcluded ? ['PROFILE_SCOPE_POSITIVE_BEHAVIOR_NOT_REQUIRED'] : []),
      ...(c.unresolved ? ['INPUT_CASE_UNRESOLVED_BEHAVIOR_CARRIED_FORWARD'] : []),
    ],
  };
}

const inputJson = JSON.parse(await readFile(input, 'utf8'));
const entries = inputJson.cases
  .filter((c) => c.kind === 'item')
  .map(candidateFor)
  .sort((a, b) => a.item.id - b.item.id);
const counts = Object.groupBy(entries, (x) => x.item.scope);
const artifact = {
  schemaVersion: 1,
  generatedBy: 'build-item-behavior-candidates.mjs',
  sourceCaseSet: 'reference-cases.json item entries',
  referenceCaseSetVersion: inputJson.referenceCaseSetVersion,
  candidateOnly: true,
  provenance: 'RECONSTRUCTED_SOURCE_CANDIDATE_NOT_OFFICIAL_JAR_TRUTH',
  fixedReconstructionRevision: revision,
  counts: { total: entries.length, byScope: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.length])) },
  entries,
};
artifact.sha256 = createHash('sha256')
  .update(JSON.stringify({ ...artifact, sha256: undefined }))
  .digest('hex');
await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`wrote ${output}: ${artifact.counts.total} entries, sha256 ${artifact.sha256}`);
