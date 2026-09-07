export const PRERENDER_OUTLET = '<!--seedlands-prerender-outlet-->';
export const PRERENDER_BASE_PLACEHOLDER = '/__seedlands_base_path__/';

export function validatePrerenderedStartScreen(fragment) {
  if (!fragment.trim()) throw new Error('Prerendered start screen is empty.');
  if (!fragment.includes('<!--[-->') || !fragment.includes('<!--]-->'))
    throw new Error('Prerendered start screen is missing Svelte hydration markers.');
  if (!fragment.includes('id="start-card"') || !fragment.includes('id="seed"') || !fragment.includes('id="enter"'))
    throw new Error('Prerendered start screen is missing required boot controls.');
  if (fragment.includes('data-ui-fallback')) throw new Error('Legacy fallback markup must not be prerendered.');
  return fragment;
}

export function injectPrerenderedStartScreen(template, fragment) {
  const outletCount = template.split(PRERENDER_OUTLET).length - 1;
  if (outletCount !== 1) throw new Error(`Expected exactly one prerender outlet, received ${outletCount}.`);
  return template.replace(PRERENDER_OUTLET, validatePrerenderedStartScreen(fragment));
}

export function applyPrerenderedBasePath(fragment, base) {
  if (!base.startsWith('/') || !base.endsWith('/')) throw new Error(`Invalid Vite base path: ${base}`);
  return fragment.replaceAll(PRERENDER_BASE_PLACEHOLDER, base);
}

export function ensureCriticalStylesheetBeforeModule(html) {
  const criticalPattern = /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>\s*/g;
  const matches = html.match(criticalPattern) ?? [];
  if (matches.length === 0) throw new Error('Expected at least one render-blocking stylesheet.');
  const moduleIndex = html.indexOf('<script type="module"');
  if (moduleIndex < 0) throw new Error('Expected one module entry script.');
  if (matches.every((match) => html.indexOf(match) < moduleIndex)) return html;
  const withoutCritical = html.replace(criticalPattern, '');
  const nextModuleIndex = withoutCritical.indexOf('<script type="module"');
  return `${withoutCritical.slice(0, nextModuleIndex)}${matches.map((match) => match.trimEnd()).join('\n    ')}\n    ${withoutCritical.slice(nextModuleIndex)}`;
}
