import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const evidenceDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidenceDirectory, '../../../..');
const acceptanceRoot = '/private/tmp/seedlands-v2-acceptance-0eafd427';

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const readAcceptance = (path) => readFileSync(resolve(acceptanceRoot, path), 'utf8');
const parse = (path, kind = ts.ScriptKind.TS) =>
  ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, kind);
const normalize = (value) => value.replace(/\s+/g, '');

function fail(message) {
  throw new Error(message);
}

function property(object, name) {
  const found = object.properties.find(
    (entry) =>
      ts.isPropertyAssignment(entry) &&
      ((ts.isIdentifier(entry.name) && entry.name.text === name) ||
        (ts.isStringLiteral(entry.name) && entry.name.text === name)),
  );
  if (!found || !ts.isPropertyAssignment(found)) fail(`Missing property ${name}.`);
  return found.initializer;
}

function numericValue(expression, label) {
  if (!ts.isNumericLiteral(expression)) fail(`${label} is not a numeric literal.`);
  return Number(expression.text);
}

function stringValue(expression, label) {
  if (!ts.isStringLiteral(expression)) fail(`${label} is not a string literal.`);
  return expression.text;
}

function booleanValue(expression, label) {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  fail(`${label} is not a boolean literal.`);
}

function calls(source, receiver, method) {
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === receiver &&
      node.expression.name.text === method
    )
      found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

const mainPath = 'apps/web/tests/e2e/classic-runtime.spec.ts';
const visualPath = 'apps/web/tests/e2e/classic-support/visual-rebuild.ts';
const modularPath = 'apps/web/tests/e2e/classic-support/modular-pack-smoke.ts';
const configPath = 'playwright.config.ts';
const workerPath =
  'node_modules/.pnpm/@playwright+test@1.62.1/node_modules/playwright/lib/worker/workerProcessEntry.js';

const mainSource = parse(mainPath);
const mainTimeoutCalls = calls(mainSource, 'test', 'setTimeout');
if (mainTimeoutCalls.length !== 1) fail(`Expected one main test.setTimeout, got ${mainTimeoutCalls.length}.`);
const mainTimeoutMs = numericValue(mainTimeoutCalls[0].arguments[0], 'canonical main timeout');
if (mainTimeoutMs !== 900_000) fail(`Expected canonical main timeout 900000, got ${mainTimeoutMs}.`);

const visualSource = parse(visualPath);
const visualTimeoutCalls = calls(visualSource, 'test', 'setTimeout');
if (visualTimeoutCalls.length !== 1) fail(`Expected one visual test.setTimeout, got ${visualTimeoutCalls.length}.`);
const visualTimeoutMs = numericValue(visualTimeoutCalls[0].arguments[0], 'visual timeout');
if (visualTimeoutMs !== 240_000) fail(`Expected visual timeout 240000, got ${visualTimeoutMs}.`);

const modularSource = parse(modularPath);
const modularTimeoutCalls = calls(modularSource, 'test', 'setTimeout');
if (modularTimeoutCalls.length !== 1) fail(`Expected one modular test.setTimeout, got ${modularTimeoutCalls.length}.`);
const modularTimeoutMs = numericValue(modularTimeoutCalls[0].arguments[0], 'modular timeout');
if (modularTimeoutMs !== 90_000) fail(`Expected modular timeout 90000, got ${modularTimeoutMs}.`);

const configSource = parse(configPath);
let configObject;
for (const statement of configSource.statements) {
  if (
    ts.isExportAssignment(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(configSource) === 'defineConfig' &&
    ts.isObjectLiteralExpression(statement.expression.arguments[0])
  )
    configObject = statement.expression.arguments[0];
}
if (!configObject) fail('Unable to resolve defineConfig object.');

const projects = property(configObject, 'projects');
if (!ts.isArrayLiteralExpression(projects) || projects.elements.length !== 1) fail('Expected exactly one project.');
const chromium = projects.elements[0];
if (!ts.isObjectLiteralExpression(chromium)) fail('Chromium project is not an object literal.');
const projectName = stringValue(property(chromium, 'name'), 'project name');
const projectTimeoutMs = numericValue(property(chromium, 'timeout'), 'project timeout');
if (projectName !== 'chromium' || projectTimeoutMs !== 60_000)
  fail(`Expected chromium/60000 project, got ${projectName}/${projectTimeoutMs}.`);

const use = property(configObject, 'use');
const webServer = property(configObject, 'webServer');
if (!ts.isObjectLiteralExpression(use) || !ts.isObjectLiteralExpression(webServer))
  fail('Config objects are not literals.');
const preservedConfig = {
  testMatch: ts.isArrayLiteralExpression(property(configObject, 'testMatch'))
    ? property(configObject, 'testMatch').elements.map((value) => stringValue(value, 'testMatch'))
    : fail('testMatch is not an array.'),
  fullyParallel: booleanValue(property(configObject, 'fullyParallel'), 'fullyParallel'),
  workers: numericValue(property(configObject, 'workers'), 'workers'),
  retriesExpression: normalize(property(configObject, 'retries').getText(configSource)),
  failOnFlakyTests: booleanValue(property(configObject, 'failOnFlakyTests'), 'failOnFlakyTests'),
  actionTimeoutMs: numericValue(property(use, 'actionTimeout'), 'actionTimeout'),
  navigationTimeoutMs: numericValue(property(use, 'navigationTimeout'), 'navigationTimeout'),
  trace: stringValue(property(use, 'trace'), 'trace'),
  webServerTimeoutMs: numericValue(property(webServer, 'timeout'), 'webServer timeout'),
};
const expectedConfig = {
  testMatch: ['apps/web/tests/e2e/classic-runtime.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retriesExpression: 'process.env.CI?1:0',
  failOnFlakyTests: true,
  actionTimeoutMs: 10_000,
  navigationTimeoutMs: 30_000,
  trace: 'retain-on-failure',
  webServerTimeoutMs: 30_000,
};
if (JSON.stringify(preservedConfig) !== JSON.stringify(expectedConfig))
  fail(`Preserved config mismatch: ${JSON.stringify(preservedConfig)}.`);

const playwrightVersion = JSON.parse(readAcceptance('node_modules/@playwright/test/package.json')).version;
if (playwrightVersion !== '1.62.1') fail(`Expected Playwright 1.62.1, got ${playwrightVersion}.`);
const workerSource = ts.createSourceFile(
  workerPath,
  readAcceptance(workerPath),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const declarations = new Map();
const visitDeclarations = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    const values = declarations.get(node.name.text) ?? [];
    values.push({ line: lineOf(workerSource, node), initializer: normalize(node.initializer.getText(workerSource)) });
    declarations.set(node.name.text, values);
  }
  ts.forEachChild(node, visitDeclarations);
};
visitDeclarations(workerSource);
const afterHooks = declarations.get('afterHooksTimeout') ?? [];
const teardownSlots = declarations.get('teardownSlot') ?? [];
const tracingSlots = declarations.get('tracingSlot') ?? [];
if (
  !afterHooks.some(
    ({ initializer }) => initializer === 'calculateMaxTimeout(this._project.project.timeout,testInfo.timeout)',
  )
)
  fail('Playwright after-hooks max(project,test) slot was not found.');
if (!teardownSlots.some(({ initializer }) => initializer === '{timeout:this._project.project.timeout,elapsed:0}'))
  fail('Playwright worker teardown project-timeout slot was not found.');
if (!tracingSlots.some(({ initializer }) => initializer === '{timeout:this._project.project.timeout,elapsed:0}'))
  fail('Playwright trace-stop project-timeout slot was not found.');

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      status: 'PASS',
      canonicalMain: { path: mainPath, line: lineOf(mainSource, mainTimeoutCalls[0]), timeoutMs: mainTimeoutMs },
      explicitOverrides: {
        visual: { path: visualPath, timeoutMs: visualTimeoutMs },
        modular: { path: modularPath, timeoutMs: modularTimeoutMs },
      },
      config: {
        path: configPath,
        project: { name: projectName, timeoutMs: projectTimeoutMs },
        preserved: preservedConfig,
      },
      playwright: {
        version: playwrightVersion,
        dependencyRoot: acceptanceRoot,
        workerSource: workerPath,
        afterHooksSlots: afterHooks,
        workerTeardownSlots: teardownSlots,
        traceStopSlots: tracingSlots,
        semantics:
          'The 60000ms project timeout applies independently to worker teardown and trace-stop slots; main after-hooks use max(project timeout, test timeout). It is not a total finalization wall-time promise.',
      },
    },
    null,
    2,
  )}\n`,
);
