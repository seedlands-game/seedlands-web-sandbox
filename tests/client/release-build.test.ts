import { describe, expect, it } from 'vitest';
import { formatBuildWatermark } from '../../src/client/build-watermark';
import { publicAssetUrl } from '../../src/client/public-asset-url';

describe('release build metadata', () => {
  it('shows a short commit hash together with the generator version', () => {
    expect(formatBuildWatermark('0123456789abcdef0123456789abcdef01234567', 2)).toBe('commit 0123456 · generator v2');
  });

  it('does not invent release metadata in a local build', () => {
    expect(formatBuildWatermark(undefined, 2)).toBeNull();
    expect(formatBuildWatermark('not-a-git-sha', 2)).toBeNull();
  });

  it('resolves public assets under both root and repository Pages bases', () => {
    expect(publicAssetUrl('/', '/assets/voxel-atlas.webp')).toBe('/assets/voxel-atlas.webp');
    expect(publicAssetUrl('/seedlands-web-sandbox/', 'assets/voxel-atlas.webp')).toBe(
      '/seedlands-web-sandbox/assets/voxel-atlas.webp',
    );
  });
});
