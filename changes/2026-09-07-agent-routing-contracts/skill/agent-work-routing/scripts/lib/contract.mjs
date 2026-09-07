import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export class ContractError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ContractError';
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireValue(condition, message) {
  if (!condition) throw new ContractError(message);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function pathArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function isWithin(candidate, roots) {
  const resolved = path.resolve(candidate);
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

const agentRoutes = new Map([
  ['implementation', ['gpt-5.6-sol', 'high']],
  ['development', ['gpt-5.6-sol', 'high']],
  ['validation', ['gpt-5.6-terra', 'high']],
  ['acceptance', ['gpt-5.6-terra', 'high']],
  ['extraction', ['gpt-5.6-luna', 'medium']],
  ['mechanical-text', ['gpt-5.3-codex-spark', 'xhigh']],
  ['text-scan', ['gpt-5.3-codex-spark', 'xhigh']],
  ['design', ['gpt-6-astra', 'high']],
  ['exploration', ['gpt-6-astra', 'high']],
  ['complex-ui', ['gpt-6-astra', 'high']],
]);

function validateShape(contract) {
  requireValue(contract && typeof contract === 'object', '合同必须是 JSON object');
  requireValue(contract.version === 1, '仅支持 version 1');
  for (const field of ['id', 'role', 'workType', 'goal']) {
    requireValue(nonEmptyString(contract[field]), `${field} 必须是非空字符串`);
  }
  requireValue(['human', 'agent'].includes(contract.initiatedBy), 'initiatedBy 必须为 human 或 agent');
  requireValue(Array.isArray(contract.context), 'context 必须是数组');
  requireValue(
    contract.context.every((entry) => nonEmptyString(entry?.path) && nonEmptyString(entry?.purpose)),
    'context 条目必须包含 path 与 purpose',
  );
  requireValue(contract.scope && typeof contract.scope === 'object', 'scope 缺失');
  requireValue(pathArray(contract.scope.writePaths), 'scope.writePaths 必须是路径数组');
  requireValue(stringArray(contract.scope.readPaths), 'scope.readPaths 必须是非空路径数组');
  requireValue(stringArray(contract.scope.nonGoals), 'scope.nonGoals 必须是非空数组');
  requireValue(
    [...contract.scope.writePaths, ...contract.scope.readPaths].every(path.isAbsolute),
    '读写路径必须是绝对路径',
  );
  requireValue(stringArray(contract.outputs), 'outputs 必须是非空数组');
  requireValue(contract.execution && nonEmptyString(contract.execution.form), 'execution.form 缺失');
  if (contract.execution.form === 'script') {
    requireValue(
      contract.execution.model == null && contract.execution.effort == null,
      'script 执行必须使用 null model/effort',
    );
  } else {
    requireValue(
      nonEmptyString(contract.execution.model) && nonEmptyString(contract.execution.effort),
      'execution model/effort 缺失',
    );
  }
  requireValue(Array.isArray(contract.acceptance) && contract.acceptance.length > 0, 'acceptance 不得为空');
  requireValue(
    contract.acceptance.every(
      (item) => nonEmptyString(item?.id) && nonEmptyString(item?.check) && nonEmptyString(item?.evidence),
    ),
    'acceptance 条目不完整',
  );
  requireValue(
    Number.isInteger(contract.budget?.maxAttempts) && contract.budget.maxAttempts > 0,
    'budget.maxAttempts 必须为正整数',
  );
  requireValue(
    Number.isFinite(contract.budget?.maxAgentHours) && contract.budget.maxAgentHours > 0,
    'budget.maxAgentHours 必须为正数',
  );
  for (const permission of ['localWrite', 'externalWrite', 'delegate']) {
    requireValue(typeof contract.permissions?.[permission] === 'boolean', `permissions.${permission} 必须为 boolean`);
  }
  requireValue(
    !contract.permissions.localWrite || contract.scope.writePaths.length > 0,
    'localWrite=true 时 writePaths 不得为空',
  );
  requireValue(
    contract.resources && Object.hasOwn(contract.resources, 'exclusiveGroup'),
    'resources.exclusiveGroup 缺失',
  );
  requireValue(stringArray(contract.escalation), 'escalation 必须是非空数组');
  requireValue(stringArray(contract.reportFields), 'reportFields 必须是非空数组');
  for (const entry of contract.context) {
    requireValue(path.isAbsolute(entry.path), `context 路径必须是绝对路径: ${entry.path}`);
    requireValue(
      isWithin(entry.path, [...contract.scope.readPaths, ...contract.scope.writePaths]),
      `context 超出读写范围: ${entry.path}`,
    );
  }
}

function validateAgentRoute(contract) {
  if (contract.initiatedBy === 'human') return;
  if (contract.execution.form === 'script') return;
  const expected = agentRoutes.get(contract.workType);
  requireValue(expected, `agent workType 不受支持: ${contract.workType}`);
  if (['implementation', 'development'].includes(contract.workType)) {
    requireValue(
      !['gpt-5.6-luna', 'gpt-5.3-codex-spark'].includes(contract.execution.model),
      'Luna/Spark 不得承担开发',
    );
  }
  const exactDefault = contract.execution.model === expected[0] && contract.execution.effort === expected[1];
  if (!exactDefault) {
    requireValue(nonEmptyString(contract.execution.routeReason), `${contract.workType} 偏离默认路由时必须提供调整理由`);
    requireValue(
      ['gpt-5.3-codex-spark', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra'].includes(
        contract.execution.model,
      ),
      `不支持的调整模型: ${contract.execution.model}`,
    );
    requireValue(
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(contract.execution.effort),
      '不支持的 effort',
    );
  }
  if (contract.execution.model === 'gpt-5.3-codex-spark')
    requireValue(['mechanical-text', 'text-scan'].includes(contract.workType), 'Spark 只用于纯文本机械任务');
}

function validateParentBoundary(child, parent) {
  for (const permission of ['localWrite', 'externalWrite', 'delegate']) {
    requireValue(!(child.permissions[permission] && !parent.permissions[permission]), `子合同扩大权限: ${permission}`);
  }
  for (const candidate of child.scope.writePaths) {
    requireValue(isWithin(candidate, parent.scope.writePaths), `子合同扩大写入范围: ${candidate}`);
  }
  for (const candidate of child.scope.readPaths) {
    requireValue(
      isWithin(candidate, [...parent.scope.readPaths, ...parent.scope.writePaths]),
      `子合同扩大读取范围: ${candidate}`,
    );
  }
  requireValue(child.budget.maxAttempts <= parent.budget.maxAttempts, '子合同扩大 maxAttempts');
  requireValue(child.budget.maxAgentHours <= parent.budget.maxAgentHours, '子合同扩大 maxAgentHours');
}

export async function loadAndValidateContract(contractPath, options = {}) {
  const absolutePath = path.resolve(contractPath);
  const raw = await readFile(absolutePath);
  const digest = sha256(raw);
  if (options.expectedHash)
    requireValue(digest === options.expectedHash, `合同 hash 不匹配: expected ${options.expectedHash}, got ${digest}`);
  let contract;
  try {
    contract = JSON.parse(raw);
  } catch (error) {
    throw new ContractError(`合同 JSON 无效: ${error.message}`, { cause: error });
  }
  validateShape(contract);
  validateAgentRoute(contract);
  let parent = null;
  if (contract.parent !== null) {
    requireValue(nonEmptyString(contract.parent?.path), 'parent.path 缺失');
    requireValue(/^[a-f0-9]{64}$/.test(contract.parent?.sha256 ?? ''), 'parent.sha256 无效');
    requireValue(path.resolve(contract.parent.path) !== absolutePath, '合同不得引用自身为父合同');
    requireValue(!options._seen?.has(path.resolve(contract.parent.path)), '检测到父合同循环');
    parent = await loadAndValidateContract(contract.parent.path, {
      expectedHash: contract.parent.sha256,
      _seen: new Set([...(options._seen ?? []), absolutePath]),
    });
    validateParentBoundary(contract, parent.contract);
  }
  return { path: absolutePath, raw: raw.toString('utf8'), sha256: digest, contract, parent };
}

export function renderHandoff(loaded) {
  const { contract, path: contractPath, sha256: digest } = loaded;
  return [
    `固定合同：${contractPath}`,
    `SHA-256：${digest}`,
    `角色：${contract.role}`,
    `目标：${contract.goal}`,
    `执行：${contract.execution.form}；${contract.execution.model}/${contract.execution.effort}`,
    `权限：localWrite=${contract.permissions.localWrite}，externalWrite=${contract.permissions.externalWrite}，delegate=${contract.permissions.delegate}`,
    `写入范围：\n${contract.scope.writePaths.map((value) => `- ${value}`).join('\n')}`,
    `非目标：\n${contract.scope.nonGoals.map((value) => `- ${value}`).join('\n')}`,
    `准出：\n${contract.acceptance.map((item) => `- [${item.id}] ${item.check}（${item.evidence}）`).join('\n')}`,
    `升级条件：\n${contract.escalation.map((value) => `- ${value}`).join('\n')}`,
    '先读取并执行完整合同。不得扩大范围或权限；完成后按 reportFields 回报。',
  ].join('\n\n');
}

export function reportTemplate(contract) {
  return contract.reportFields.map((field) => `## ${field}\n\n待填写`).join('\n\n');
}
