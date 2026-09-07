import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ContractError, loadAndValidateContract, renderHandoff, reportTemplate } from '../scripts/lib/contract.mjs';

const rootContract = {
  version: 1,
  id: 'root',
  initiatedBy: 'human',
  role: '统筹',
  workType: 'design',
  goal: '交付路由系统',
  context: [],
  scope: {
    writePaths: ['/workspace', '/global/skill'],
    readPaths: ['/workspace', '/references'],
    nonGoals: ['不写线上服务'],
  },
  outputs: ['交付物'],
  execution: { form: 'current-task', model: 'gpt-6-astra', effort: 'high' },
  acceptance: [{ id: 'done', check: '全部验证通过', evidence: 'node --test' }],
  budget: { maxAttempts: 3, maxAgentHours: 12 },
  permissions: { localWrite: true, externalWrite: false, delegate: true },
  parent: null,
  resources: { exclusiveGroup: null },
  escalation: ['两次同因失败'],
  reportFields: ['完成状态', '验证结果'],
};

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'routing-contract-'));
  const rootPath = path.join(directory, 'root.json');
  await writeFile(rootPath, `${JSON.stringify(rootContract, null, 2)}\n`);
  const { sha256 } = await loadAndValidateContract(rootPath);
  const child = {
    ...structuredClone(rootContract),
    id: 'child',
    initiatedBy: 'agent',
    role: '实现负责人',
    workType: 'implementation',
    goal: '实现并验证合同工具',
    scope: {
      writePaths: ['/workspace/change'],
      readPaths: ['/workspace', '/references'],
      nonGoals: ['不写线上服务'],
    },
    execution: { form: 'subagent', model: 'gpt-5.6-sol', effort: 'high' },
    budget: { maxAttempts: 2, maxAgentHours: 6 },
    permissions: { localWrite: true, externalWrite: false, delegate: false },
    parent: { path: rootPath, sha256 },
  };
  const childPath = path.join(directory, 'child.json');
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  return { directory, rootPath, childPath, child };
}

test('固定合同校验、hash 与完整交接渲染稳定', async () => {
  const { childPath } = await fixture();
  const first = await loadAndValidateContract(childPath);
  const second = await loadAndValidateContract(childPath, { expectedHash: first.sha256 });
  assert.equal(first.sha256, second.sha256);
  assert.equal(renderHandoff(first), renderHandoff(second));
  assert.match(renderHandoff(first), new RegExp(first.sha256));
  assert.match(renderHandoff(first), /全部验证通过/);
  assert.match(reportTemplate(first.contract), /完成状态/);
});

test('缺验收、错误路由与 Luna 开发均拒绝；人类模型选择保留', async () => {
  const { childPath, child } = await fixture();
  for (const mutate of [
    (value) => (value.acceptance = []),
    (value) => (value.execution.effort = 'medium'),
    (value) => {
      value.execution.model = 'gpt-5.6-luna';
      value.execution.effort = 'medium';
    },
  ]) {
    const value = structuredClone(child);
    mutate(value);
    await writeFile(childPath, `${JSON.stringify(value, null, 2)}\n`);
    await assert.rejects(loadAndValidateContract(childPath), ContractError);
  }

  const human = structuredClone(rootContract);
  human.execution = { form: 'current-task', model: 'custom-human-choice', effort: 'max' };
  await writeFile(childPath, `${JSON.stringify(human, null, 2)}\n`);
  await assert.doesNotReject(loadAndValidateContract(childPath));
});

test('父 hash、权限、路径和预算的任一扩大均拒绝', async () => {
  const { childPath, child } = await fixture();
  const cases = [
    (value) => (value.parent.sha256 = '0'.repeat(64)),
    (value) => (value.permissions.externalWrite = true),
    (value) => (value.scope.writePaths = ['/outside']),
    (value) => (value.budget.maxAgentHours = 13),
  ];
  for (const mutate of cases) {
    const value = structuredClone(child);
    mutate(value);
    await writeFile(childPath, `${JSON.stringify(value, null, 2)}\n`);
    await assert.rejects(loadAndValidateContract(childPath), ContractError);
  }
});

test('原始合同字节变化会触发 expected hash 拒绝', async () => {
  const { childPath } = await fixture();
  const loaded = await loadAndValidateContract(childPath);
  const text = await readFile(childPath, 'utf8');
  await writeFile(childPath, `${text}\n`);
  await assert.rejects(loadAndValidateContract(childPath, { expectedHash: loaded.sha256 }), /合同 hash 不匹配/);
});

test('确定性 script 允许无模型执行', async () => {
  const { childPath, child } = await fixture();
  child.workType = 'deterministic-script';
  child.execution = { form: 'script', model: null, effort: null };
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.doesNotReject(loadAndValidateContract(childPath));
});

test('只读合同允许空 writePaths，但 localWrite=true 时仍拒绝', async () => {
  const { childPath, child } = await fixture();
  child.workType = 'validation';
  child.execution = { form: 'subagent', model: 'gpt-5.6-terra', effort: 'high' };
  child.scope.writePaths = [];
  child.permissions.localWrite = false;
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.doesNotReject(loadAndValidateContract(childPath));
  child.permissions.localWrite = true;
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.rejects(loadAndValidateContract(childPath), /localWrite=true/);
});

test('有明确理由可升档；无理由或 Luna/Spark 开发仍拒绝', async () => {
  const { childPath, child } = await fixture();
  child.execution = {
    form: 'subagent',
    model: 'gpt-6-astra',
    effort: 'xhigh',
    routeReason: '涉及跨模块公开契约，需要高阶架构判断',
  };
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.doesNotReject(loadAndValidateContract(childPath));
  delete child.execution.routeReason;
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.rejects(loadAndValidateContract(childPath), /调整理由/);
  child.execution = {
    form: 'subagent',
    model: 'gpt-5.3-codex-spark',
    effort: 'xhigh',
    routeReason: '成本更低',
  };
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.rejects(loadAndValidateContract(childPath), /不得承担开发/);
});

test('默认路由可按任务成本与能力有理由调整', async () => {
  const { childPath, child } = await fixture();
  child.execution = {
    form: 'subagent',
    model: 'gpt-5.6-terra',
    effort: 'medium',
    routeReason: '任务已收敛为单文件小实现，边界和验收均机器可判定',
  };
  await writeFile(childPath, `${JSON.stringify(child, null, 2)}\n`);
  await assert.doesNotReject(loadAndValidateContract(childPath));
});
