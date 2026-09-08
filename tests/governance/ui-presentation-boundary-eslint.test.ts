import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lintSource = async (source: string, filePath: string) => {
  const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
  return eslint.lintText(source, { filePath });
};

describe('retained UI presentation boundary', () => {
  it('rejects manual Player UI construction and presentation writes from app TypeScript', async () => {
    const [result] = await lintSource(
      `
      const panel = document.createElement('section');
      panel.textContent = 'debug';
      panel.innerHTML = '<span>hotbar</span>';
      panel.hidden = false;
      panel.replaceChildren(document.createElement('span'));
      document.body.append(panel);
      export { panel };
    `,
      'apps/web/src/app/manual-ui-probe.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/ui-presentation-boundary')).toHaveLength(
      6,
    );
  });

  it('allows intent publication, PlayCanvas canvas input and 2D map drawing', async () => {
    const [result] = await lintSource(
      `
      export const publishSelection = (publish: (slot: number) => void) => publish(2);
      export const drawMap = (canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d');
        context?.fillRect(0, 0, 1, 1);
        canvas.requestPointerLock();
      };
    `,
      'apps/web/src/app/ui-safe-probe.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/ui-presentation-boundary')).toHaveLength(
      0,
    );
  });

  it('allows the single Svelte mount adapter to replace the static fallback', async () => {
    const [result] = await lintSource(
      `
      export const mountUi = (target: HTMLElement, mount: (target: HTMLElement) => void) => {
        target.replaceChildren();
        mount(target);
      };
    `,
      'apps/web/src/app/ui/mount-ui.ts',
    );

    expect(result.messages.filter((message) => message.ruleId === 'seedlands/ui-presentation-boundary')).toHaveLength(
      0,
    );
  });
});
