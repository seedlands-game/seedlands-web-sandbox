import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Svelte retained UI integration', () => {
  it('configures Svelte 5 for Vite, typecheck and the standalone ESLint package', () => {
    const packageJson = JSON.parse(read('apps/web/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    expect(packageJson.dependencies?.svelte).toBeTruthy();
    expect(packageJson.dependencies?.svelte ?? '').toMatch(/^\^?5\./);
    expect(packageJson.devDependencies?.['@sveltejs/vite-plugin-svelte']).toBeTruthy();
    expect(packageJson.devDependencies?.['svelte-check']).toBeTruthy();
    expect(packageJson.scripts?.typecheck).toContain('svelte-check');
    expect(read('apps/web/vite.config.ts')).toContain('svelte()');
    expect(read('packages/eslint-plugin/src/config.mjs')).toContain("svelte.configs['flat/recommended']");
    expect(read('eslint.config.mjs')).toContain("from '@seedlands/eslint-plugin/config'");
  });

  it('has one AppRoot and the required reusable primitives', () => {
    const expected = [
      'apps/web/src/app/ui/app-root.svelte',
      'apps/web/src/app/ui/primitives/game-button.svelte',
      'apps/web/src/app/ui/primitives/game-overlay.svelte',
      'apps/web/src/app/ui/primitives/game-panel.svelte',
      'apps/web/src/app/ui/primitives/game-slider.svelte',
      'apps/web/src/app/ui/primitives/game-slot.svelte',
      'apps/web/src/app/ui/primitives/game-text-field.svelte',
    ];
    expected.forEach((path) => expect(existsSync(resolve(root, path)), path).toBe(true));
    expect(read('apps/web/src/app/bootstrap.ts')).toContain("from './ui/mount-ui'");
    const main = read('apps/web/src/app/main.ts');
    expect(main).toMatch(/import\(['"]\.\/bootstrap['"]\)/);
    expect(main.match(/\.\/bootstrap/g)).toHaveLength(1);
  });

  it('keeps Svelte components on presentation contracts rather than runtime internals', () => {
    const uiRoot = resolve(root, 'apps/web/src/app/ui');
    const files = readdirSync(uiRoot, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('.svelte'));
    expect(files.length).toBeGreaterThan(6);
    files.forEach((path) => {
      const source = read(`apps/web/src/app/ui/${path}`);
      expect(source, path).not.toMatch(/from ['"][^'"]*(server|world-runtime|playcanvas)/);
    });
  });

  it('injects a generated Svelte first paint without a second manual runtime HUD tree', () => {
    const html = read('apps/web/index.html');
    expect(html).toContain('data-ui-prerendered="svelte5"');
    expect(html).toContain('<!--seedlands-prerender-outlet-->');
    expect(html).not.toContain('data-ui-fallback');
    const generated = read('apps/web/src/app/ui/generated/prerendered-start-screen.html');
    expect(generated).toContain('<!--[-->');
    expect(generated).toContain('id="start-card"');
    expect(html).not.toContain('id="debug-command-shell"');
    expect(html).not.toContain('id="hotbar"');
    expect(html).not.toContain('id="macro-map-panel"');
  });
});
