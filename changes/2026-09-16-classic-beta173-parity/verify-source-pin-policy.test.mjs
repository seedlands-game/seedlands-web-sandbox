import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findUnpinnedUrls } from './verify-source-pin-policy.mjs';

test('fixed reconstructed, community and official metadata URLs are accepted', () => {
  const result = findUnpinnedUrls([
    'https://github.com/jacobo-mc/mc_b1.7.3_release/blob/740c583901e1ff1150e9ef37e37dab5bc0e4f807/1.7.3-LTS/src/minecraft/net/minecraft/src/ItemFood.java#L14-L17',
    'https://raw.githubusercontent.com/OfficialPixelBrush/beta-wiki/8bcc41aee34334c2b916e7b500abe6853b4fd704/general/blocks.md',
    'https://piston-meta.mojang.com/v1/packages/44f6969326bd45aa00dcd3c4ca3a7c05ebb24c04/b1.7.3.json',
  ]);
  assert.equal(result.uniqueUrls, 3);
  assert.deepEqual(result.unpinned, []);
});

test('mutable wiki and moving repository branches are rejected', () => {
  const result = findUnpinnedUrls({
    evidence: [
      { uri: 'https://minecraft.fandom.com/wiki/Java_Edition_Beta_1.7.3' },
      { uri: 'https://github.com/jacobo-mc/mc_b1.7.3_release/blob/main/ItemFood.java' },
    ],
  });
  assert.equal(result.unpinned.length, 2);
});
