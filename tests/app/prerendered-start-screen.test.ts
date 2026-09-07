import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPrerenderedStartScreen } from '../../apps/web/src/app/ui/prerender-entry';
import {
  applyPrerenderedBasePath,
  ensureCriticalStylesheetBeforeModule,
  injectPrerenderedStartScreen,
  PRERENDER_BASE_PLACEHOLDER,
  PRERENDER_OUTLET,
} from '../../apps/web/scripts/prerendered-start-screen.mjs';

describe('prerendered start screen', () => {
  it('renders the deterministic Svelte boot tree with hydration markers', () => {
    const first = renderPrerenderedStartScreen(PRERENDER_BASE_PLACEHOLDER);
    const second = renderPrerenderedStartScreen(PRERENDER_BASE_PLACEHOLDER);
    expect(first).toBe(second);
    expect(first).toContain('<!--[-->');
    expect(first).toContain('id="start-card"');
    expect(first).toContain('id="world-version-mode"');
    expect(first).not.toContain('data-ui-fallback');
  });

  it('injects only one non-empty outlet and resolves the production base path', () => {
    const fragment = readFileSync('apps/web/src/app/ui/generated/prerendered-start-screen.html', 'utf8').trimEnd();
    const based = applyPrerenderedBasePath(fragment, '/seedlands/');
    expect(based).not.toContain(PRERENDER_BASE_PLACEHOLDER);
    expect(based).toContain('/seedlands/assets/ui/arcane-crest.png');
    expect(injectPrerenderedStartScreen(`<main>${PRERENDER_OUTLET}</main>`, based)).toContain('id="start-card"');
    expect(() => injectPrerenderedStartScreen('<main></main>', based)).toThrow(/exactly one/);
    expect(() => injectPrerenderedStartScreen(`${PRERENDER_OUTLET}${PRERENDER_OUTLET}`, based)).toThrow(/exactly one/);
    expect(() => injectPrerenderedStartScreen(PRERENDER_OUTLET, '')).toThrow(/empty/);
  });

  it('keeps the critical stylesheet ahead of the module entry', () => {
    const module = '<script type="module" src="/entry.js"></script>';
    const critical = '<link rel="stylesheet" href="/critical.css">';
    const reordered = ensureCriticalStylesheetBeforeModule(`<head>${module}${critical}</head>`);
    expect(reordered.indexOf(critical)).toBeLessThan(reordered.indexOf(module));
    expect(ensureCriticalStylesheetBeforeModule(`<head>${critical}${module}</head>`)).toBe(
      `<head>${critical}${module}</head>`,
    );
    expect(() => ensureCriticalStylesheetBeforeModule(`<head>${module}</head>`)).toThrow(/at least one/);
  });
});
