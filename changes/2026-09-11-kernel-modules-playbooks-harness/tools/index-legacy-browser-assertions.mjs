import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const baseSha = 'c18a890c7f97f76421e13565ec628d8c50a942da';
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseSha], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((path) => /^(?:tests\/e2e|changes\/[^/]+\/e2e)\/.*\.spec\.ts$/.test(path));
const entries = [];
for (const path of paths) {
  const contents = execFileSync('git', ['show', `${baseSha}:${path}`], { encoding: 'utf8' });
  const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
  const tests = [];
  function visit(node) {
    if (ts.isCallExpression(node) && /^test(?:\.(?:skip|only|fixme|fail))?$/.test(node.expression.getText(source))) {
      const title = node.arguments[0];
      const body = node.arguments.find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
      if (title && body) {
        const assertions = [];
        function collect(child) {
          if (ts.isCallExpression(child) && /^(?:await\s+)?expect(?:\(|\.)/.test(child.expression.getText(source))) {
            const text = child.getText(source);
            if (!ts.isCallExpression(child.parent) && !ts.isPropertyAccessExpression(child.parent)) {
              assertions.push({
                line: source.getLineAndCharacterOfPosition(child.getStart(source)).line + 1,
                expression: text,
              });
            }
          }
          ts.forEachChild(child, collect);
        }
        collect(body);
        tests.push({
          title: ts.isStringLiteralLike(title) ? title.text : title.getText(source),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          disposition: 'GAP_NOT_EQUIVALENT',
          reason:
            '旧浏览器场景退出默认发现；新合同和 Classic 的局部重叠不等于本场景全部断言得到替代。冻结源与逐项断言保留供审核。',
          assertions,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  entries.push({ source: path, sourceSha256: createHash('sha256').update(contents).digest('hex'), tests });
}
const world = entries.find((entry) => entry.source === 'tests/e2e/regression/world-play.spec.ts');
for (const test of world.tests) {
  const stages = /moves and jumps|flat voxel platform|chunk-crossing/.test(test.title)
    ? ['C1']
    : /persists a controlled/.test(test.title)
      ? ['C2', 'C5']
      : [];
  if (stages.length) {
    test.disposition = 'INTEGRATE_PARTIAL';
    test.classicStages = stages;
    test.reason =
      '动作类别进入唯一 Classic；原路线初态、HUD 和全部轨迹断言不自动视为等价。具体新证据见 Classic 回执，未重现细节仍为显式缺口。';
  }
  if (/edge support|ledge/.test(test.title)) {
    test.disposition = 'LOWER_WITH_BROWSER_GAP';
    test.contracts = [
      'packages/stdlib/tests/physics/step-body.test.ts',
      'apps/web/tests/unit/client/local-player-prediction.test.ts',
    ];
    test.reason =
      '支撑、薄平台、无自动登阶与预测规则保留在 owner 合同；旧浏览器连招与完整轨迹没有等价自动替代，不宣称浏览器保护保持。';
  }
}
const ledger = {
  schemaVersion: 1,
  baseSha,
  scope: '冻结 base 的全部 Playwright testMatch 源；包括历史/opt-in/性能实验，不能把此数量称为旧默认每次执行量。',
  canonical: 'apps/web/tests/e2e/classic-runtime.spec.ts',
  rule: 'GAP_NOT_EQUIVALENT 为显式覆盖缺口，不是 PASS；历史文件仍保留，默认命令只维护一个 Classic。断言提取是可定位索引，不是语义等价证明；辅助函数中的断言仍以冻结源为准。',
  entries,
};
writeFileSync(new URL('../assertion-migration-ledger.json', import.meta.url), JSON.stringify(ledger, null, 2) + '\n');
console.log(
  JSON.stringify({
    files: entries.length,
    tests: entries.reduce((n, e) => n + e.tests.length, 0),
    assertions: entries.reduce((n, e) => n + e.tests.reduce((m, t) => m + t.assertions.length, 0), 0),
  }),
);
