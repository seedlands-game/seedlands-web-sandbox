import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStalePlayEvidence, mergeMechanismSourceReview } from './mechanism-review-merge.mjs';

const sourceBase =
  'https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src';

test('play source sync removes stale reconstructed and mutable wiki evidence', () => {
  const current = `${sourceBase}/ItemFood.java#L14-L17`;
  const stale = `${sourceBase}/ItemFood.java#L7-L22`;
  const independent = 'https://wiki.retromc.org/index.php?title=B1.7.3_data_values&oldid=9822';
  const parent = {
    caseId: 'M15-01',
    expected: { sourcedPartialExpected: 'old claim' },
    evidence: [
      { uri: stale },
      { uri: 'https://minecraft.fandom.com/wiki/Java_Edition_Beta_1.7.3' },
      { uri: independent },
    ],
  };
  const play = {
    cases: [{ caseId: 'M15-01', classification: 'RECONSTRUCTED_SOURCE_CANDIDATE', candidateExpected: 'narrow claim' }],
  };
  mergeMechanismSourceReview([parent], play, new Map([['M15-01', { verdict: '部分', sourceUris: [current] }]]));
  assert.equal(parent.expected.sourcedPartialExpected, 'narrow claim');
  assert.deepEqual(
    parent.evidence.map((source) => source.uri),
    [independent, current],
  );
  assert.equal(isStalePlayEvidence(stale, new Set([current])), true);
  assert.equal(isStalePlayEvidence(current, new Set([current])), false);
});
