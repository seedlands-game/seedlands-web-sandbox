import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Svelte retained UI integration', () => {
  it('configures Svelte 5 for Vite, typecheck and ESLint', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(packageJson.dependencies?.svelte).toBeTruthy();
    expect(packageJson.dependencies?.svelte ?? '').toMatch(/^\^?5\./);
    expect(packageJson.devDependencies?.['@sveltejs/vite-plugin-svelte']).toBeTruthy();
    expect(packageJson.devDependencies?.['svelte-check']).toBeTruthy();
    expect(packageJson.devDependencies?.['eslint-plugin-svelte']).toBeTruthy();
    expect(packageJson.scripts?.typecheck).toContain('svelte-check');
    expect(read('vite.config.ts')).toContain('svelte()');
    expect(read('eslint.config.mjs')).toContain('svelte.configs');
  });

  it('has one AppRoot and the required reusable primitives', () => {
    const expected = [
      'src/app/ui/app-root.svelte',
      'src/app/ui/primitives/game-button.svelte',
      'src/app/ui/primitives/game-overlay.svelte',
      'src/app/ui/primitives/game-panel.svelte',
      'src/app/ui/primitives/game-slider.svelte',
      'src/app/ui/primitives/game-slot.svelte',
      'src/app/ui/primitives/game-text-field.svelte',
    ];
    expected.forEach((path) => expect(existsSync(join(root, path)), path).toBe(true));
    expect(read('src/app/bootstrap.ts')).toContain("from './ui/mount-ui'");
    const main = read('src/app/main.ts');
    expect(main).toMatch(/import\(['"]\.\/bootstrap['"]\)/);
    expect(main.match(/\.\/bootstrap/g)).toHaveLength(1);
  });

  it('keeps Svelte components on presentation contracts rather than game runtime internals', () => {
    const uiRoot = join(root, 'src/app/ui');
    const files = readdirSync(uiRoot, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('.svelte'));
    expect(files.length).toBeGreaterThan(6);
    files.forEach((path) => {
      const source = read(join('src/app/ui', path));
      expect(source, path).not.toMatch(/from ['"][^'"]*(server|world-runtime|playcanvas)/);
    });
  });

  it('keeps a static first-paint fallback but no second manual runtime HUD tree', () => {
    const html = read('index.html');
    expect(html).toContain('data-ui-fallback');
    expect(html).toContain('id="ui"');
    expect(html).not.toContain('id="debug-command-shell"');
    expect(html).not.toContain('id="hotbar"');
    expect(html).not.toContain('id="macro-map-panel"');
  });
});
