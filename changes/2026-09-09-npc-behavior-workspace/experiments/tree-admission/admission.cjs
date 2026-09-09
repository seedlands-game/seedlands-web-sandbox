'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const prefix = process.env.MISTREEVOUS_PREFIX;
if (!prefix) throw new Error('Set MISTREEVOUS_PREFIX to the isolated npm prefix.');
const candidateRequire = createRequire(path.join(prefix, 'package.json'));
const { BehaviourTree, State } = candidateRequire('mistreevous');
const candidatePackage = candidateRequire('mistreevous/package.json');
assert.equal(candidatePackage.version, '4.3.1');

const clone = (value) => JSON.parse(JSON.stringify(value));
const signatureOf = (node) => JSON.stringify([node.skill, node.mode ?? 'running', ...(node.args ?? [])]);

class FakeWorldSkills {
  constructor(name) {
    this.name = name;
    this.danger = false;
    this.deltaTime = 0;
    this.randomValues = [];
    this.nextActionSequence = 0;
    this.cycleSequence = 0;
    this.executions = new Map();
    this.effects = new Map();
    this.trace = [];
    this.guardAbortCount = 0;
    this.rejudgeRequests = [];
  }

  random() {
    assert.ok(this.randomValues.length > 0, `${this.name}: deterministic random input exhausted`);
    return this.randomValues.shift();
  }

  check(predicate) {
    if (predicate === 'danger') return this.danger;
    if (predicate === 'safe') return !this.danger;
    throw new Error(`Unknown predicate: ${predicate}`);
  }

  run(nodeId, skill, mode = 'running', ...args) {
    const signature = JSON.stringify([skill, mode, ...args]);
    const previous = this.executions.get(nodeId);
    if (previous && previous.signature === signature && previous.status !== 'cancelled') {
      previous.pollCount += 1;
      this.trace.push({ type: 'poll', nodeId, actionId: previous.actionId, status: previous.status });
      return previous.status === 'running'
        ? State.RUNNING
        : previous.status === 'succeeded'
          ? State.SUCCEEDED
          : State.FAILED;
    }
    if (previous?.status === 'running') throw new Error(`Changed skill was not reconciled: ${nodeId}`);
    const execution = {
      nodeId,
      signature,
      actionId: `${this.name}-action-${++this.nextActionSequence}`,
      status: mode === 'once' ? 'succeeded' : 'running',
      progress: 0,
      pollCount: 1,
    };
    this.executions.set(nodeId, execution);
    this.trace.push({ type: 'start', nodeId, actionId: execution.actionId, skill });
    if (mode === 'once') {
      this.effects.set(skill, (this.effects.get(skill) ?? 0) + 1);
      this.trace.push({ type: 'effect', nodeId, actionId: execution.actionId, skill });
      return State.SUCCEEDED;
    }
    return State.RUNNING;
  }

  complete(nodeId) {
    const execution = this.executions.get(nodeId);
    assert.ok(execution && execution.status === 'running');
    execution.status = 'succeeded';
    this.trace.push({ type: 'complete', nodeId, actionId: execution.actionId });
  }

  cancel(nodeId, reason) {
    const execution = this.executions.get(nodeId);
    if (!execution || execution.status !== 'running') return false;
    execution.status = 'cancelled';
    this.trace.push({ type: 'cancel', nodeId, actionId: execution.actionId, reason });
    return true;
  }

  onExit(result, nodeId) {
    this.trace.push({ type: 'exit', nodeId, aborted: result.aborted, succeeded: result.succeeded });
    if (!result.aborted) return;
    this.guardAbortCount += 1;
    this.cancel(nodeId, 'guard-aborted');
  }

  reconcile(compatibleSignatures) {
    for (const [nodeId, execution] of this.executions) {
      if (compatibleSignatures.get(nodeId) === execution.signature) continue;
      this.cancel(nodeId, 'tree-replaced');
      this.executions.delete(nodeId);
    }
  }

  beginNextCycle() {
    assert.equal(
      [...this.executions.values()].some((execution) => execution.status === 'running'),
      false,
    );
    this.cycleSequence += 1;
    this.executions.clear();
    this.trace.push({ type: 'cycle', cycleSequence: this.cycleSequence });
  }

  requestRejudge(monitorId) {
    this.rejudgeRequests.push({ monitorId, cycleSequence: this.cycleSequence });
    this.trace.push({ type: 'rejudge', monitorId });
  }

  snapshot() {
    return {
      name: this.name,
      danger: this.danger,
      nextActionSequence: this.nextActionSequence,
      cycleSequence: this.cycleSequence,
      executions: [...this.executions.values()].map(clone),
      effects: Object.fromEntries(this.effects),
    };
  }
}

function visit(node, callback) {
  callback(node);
  if (node.children) node.children.forEach((child) => visit(child, callback));
  if (node.child) visit(node.child, callback);
}

function actionSignatures(definition) {
  const signatures = new Map();
  visit(definition.root, (node) => {
    if (node.type !== 'action') return;
    if (signatures.has(node.id)) throw new Error(`Duplicate canonical node id: ${node.id}`);
    signatures.set(node.id, signatureOf(node));
  });
  return signatures;
}

function compile(node) {
  if (node.type === 'action') {
    return {
      type: 'action',
      call: 'RunSkill',
      args: [node.id, node.skill, node.mode ?? 'running', ...(node.args ?? [])],
      exit: { call: 'OnSkillExit', args: [node.id] },
      ...(node.guard ? { while: { call: 'Check', args: [node.guard] } } : {}),
    };
  }
  if (node.type === 'condition') return { type: 'condition', call: 'Check', args: [node.predicate] };
  if (node.type === 'selector' || node.type === 'sequence') {
    return { type: node.type, children: node.children.map(compile) };
  }
  throw new Error(`Unsupported canonical node: ${node.type}`);
}

class CandidateAdapter {
  constructor(definition, world) {
    this.world = world;
    this.guardAborted = false;
    this.monitorStates = new Map();
    this.definition = clone(definition);
    this.build();
  }

  build() {
    const agent = {
      Check: (predicate) => this.world.check(predicate),
      RunSkill: (nodeId, skill, mode, ...args) => this.world.run(nodeId, skill, mode, ...args),
      OnSkillExit: (result, nodeId) => {
        if (result.aborted) this.guardAborted = true;
        this.world.onExit(result, nodeId);
      },
    };
    this.tree = new BehaviourTree({ type: 'root', child: compile(this.definition.root) }, agent, {
      getDeltaTime: () => this.world.deltaTime,
      random: () => this.world.random(),
    });
  }

  tick(deltaTime) {
    this.world.deltaTime = deltaTime;
    this.guardAborted = false;
    if (this.tree.getState() === State.SUCCEEDED || this.tree.getState() === State.FAILED) this.world.beginNextCycle();
    for (const monitor of this.definition.monitors ?? []) {
      const active = this.world.check(monitor.predicate);
      const previous = this.monitorStates.get(monitor.id) ?? false;
      if (active && !previous) this.world.requestRejudge(monitor.id);
      this.monitorStates.set(monitor.id, active);
    }
    this.tree.step();
    let reactiveRestep = false;
    if (this.guardAborted && !this.tree.isRunning()) {
      reactiveRestep = true;
      this.guardAborted = false;
      this.tree.step();
    }
    return { state: this.tree.getState(), reactiveRestep };
  }

  rebuildCompatible() {
    const previousEngineRootId = this.tree.getTreeNodeDetails().id;
    this.world.reconcile(actionSignatures(this.definition));
    this.build();
    return { previousEngineRootId, rebuiltEngineRootId: this.tree.getTreeNodeDetails().id };
  }

  replace(definition) {
    const previousEngineRootId = this.tree.getTreeNodeDetails().id;
    this.world.reconcile(actionSignatures(definition));
    this.definition = clone(definition);
    this.build();
    return { previousEngineRootId, replacementEngineRootId: this.tree.getTreeNodeDetails().id };
  }
}

const actionTree = (id = 'work') => ({
  version: 1,
  revision: 1,
  root: { type: 'action', id, skill: 'work' },
});

const priorityTree = {
  version: 1,
  revision: 1,
  root: {
    type: 'selector',
    children: [
      {
        type: 'sequence',
        children: [
          { type: 'condition', id: 'danger?', predicate: 'danger' },
          { type: 'action', id: 'flee', skill: 'flee', guard: 'danger' },
        ],
      },
      { type: 'action', id: 'routine', skill: 'work', guard: 'safe' },
    ],
  },
};

const resumableTree = {
  version: 1,
  revision: 1,
  root: {
    type: 'sequence',
    children: [
      { type: 'action', id: 'announce', skill: 'announce', mode: 'once' },
      { type: 'action', id: 'travel', skill: 'travel' },
    ],
  },
};

function proveInstanceIsolation() {
  const firstWorld = new FakeWorldSkills('first');
  const secondWorld = new FakeWorldSkills('second');
  const first = new CandidateAdapter(actionTree(), firstWorld);
  const second = new CandidateAdapter(actionTree(), secondWorld);
  first.tick(0.1);
  second.tick(0.1);
  firstWorld.complete('work');
  first.tick(0.1);
  assert.equal(first.tree.getState(), State.SUCCEEDED);
  assert.equal(second.tree.getState(), State.RUNNING);
  assert.equal(secondWorld.executions.get('work').status, 'running');
  assert.notStrictEqual(firstWorld.executions, secondWorld.executions);
  return {
    first: {
      actionId: firstWorld.executions.get('work').actionId,
      status: firstWorld.executions.get('work').status,
      pollCount: firstWorld.executions.get('work').pollCount,
    },
    second: {
      actionId: secondWorld.executions.get('work').actionId,
      status: secondWorld.executions.get('work').status,
      pollCount: secondWorld.executions.get('work').pollCount,
    },
  };
}

function proveInjectedTimeAndRandom() {
  let deltaTime = 0.4;
  const timer = new BehaviourTree(
    { type: 'root', child: { type: 'wait', duration: 1000 } },
    {},
    {
      getDeltaTime: () => deltaTime,
    },
  );
  const timerStates = [];
  for (let index = 0; index < 3; index += 1) {
    timer.step();
    timerStates.push(timer.getState());
  }
  assert.deepEqual(timerStates, [State.RUNNING, State.RUNNING, State.SUCCEEDED]);

  const choose = (randomValue) => {
    const picked = [];
    const tree = new BehaviourTree(
      {
        type: 'root',
        child: {
          type: 'lotto',
          children: [
            { type: 'action', call: 'Pick', args: ['left'] },
            { type: 'action', call: 'Pick', args: ['right'] },
          ],
        },
      },
      { Pick: (choice) => (picked.push(choice), State.RUNNING) },
      { random: () => randomValue },
    );
    tree.step();
    return picked[0];
  };
  assert.equal(choose(0), 'left');
  assert.equal(choose(0.999), 'right');
  return {
    timerStates,
    randomChoices: [
      { input: 0, choice: 'left' },
      { input: 0.999, choice: 'right' },
    ],
  };
}

function provePersistentRunningIdentity() {
  const world = new FakeWorldSkills('persistent');
  const adapter = new CandidateAdapter(actionTree(), world);
  for (let index = 0; index < 5; index += 1) adapter.tick(0.1);
  const execution = world.executions.get('work');
  assert.equal(execution.actionId, 'persistent-action-1');
  assert.equal(execution.pollCount, 5);
  assert.equal(world.trace.filter((event) => event.type === 'start').length, 1);
  return {
    actionId: execution.actionId,
    startCount: world.trace.filter((event) => event.type === 'start').length,
    pollCount: execution.pollCount,
    status: execution.status,
  };
}

function proveGuardPreemptionAndReactivePriority() {
  const world = new FakeWorldSkills('priority');
  const adapter = new CandidateAdapter(priorityTree, world);
  adapter.tick(0.1);
  const routineAction = world.executions.get('routine').actionId;
  world.danger = true;
  const switched = adapter.tick(0.1);
  assert.deepEqual(switched, { state: State.RUNNING, reactiveRestep: true });
  assert.equal(world.executions.get('routine').status, 'cancelled');
  assert.equal(world.executions.get('flee').status, 'running');
  assert.equal(world.guardAbortCount, 1);
  assert.equal(world.trace.filter((event) => event.type === 'cancel' && event.actionId === routineAction).length, 1);
  return {
    rootState: switched.state,
    reactiveRestep: switched.reactiveRestep,
    reactiveRestepBound: 1,
    routineStatus: world.executions.get('routine').status,
    routineCancelCount: world.trace.filter((event) => event.type === 'cancel' && event.actionId === routineAction)
      .length,
    fleeStatus: world.executions.get('flee').status,
    trace: world.trace.map((event) => {
      if (event.type === 'exit') return { type: event.type, nodeId: event.nodeId, aborted: event.aborted };
      return { type: event.type, nodeId: event.nodeId, actionId: event.actionId };
    }),
  };
}

function proveLifeCyclesAndNonBlockingMonitors() {
  const cycleWorld = new FakeWorldSkills('cycles');
  const cycleAdapter = new CandidateAdapter(
    {
      version: 1,
      revision: 1,
      root: { type: 'action', id: 'daily-task', skill: 'daily-task', mode: 'once' },
    },
    cycleWorld,
  );
  for (let index = 0; index < 3; index += 1) cycleAdapter.tick(0.1);
  assert.equal(cycleWorld.effects.get('daily-task'), 3);
  assert.equal(cycleWorld.cycleSequence, 2);

  const monitorWorld = new FakeWorldSkills('monitors');
  const monitorAdapter = new CandidateAdapter(
    {
      ...actionTree('continuous-life'),
      monitors: [{ id: 'danger-episode', predicate: 'danger' }],
    },
    monitorWorld,
  );
  for (const danger of [false, true, true, false, true]) {
    monitorWorld.danger = danger;
    monitorAdapter.tick(0.1);
  }
  assert.equal(monitorWorld.executions.get('continuous-life').actionId, 'monitors-action-1');
  assert.equal(monitorWorld.executions.get('continuous-life').pollCount, 5);
  assert.deepEqual(
    monitorWorld.rejudgeRequests.map((request) => request.monitorId),
    ['danger-episode', 'danger-episode'],
  );
  return {
    completedLifeCycles: cycleWorld.effects.get('daily-task'),
    cycleSequence: cycleWorld.cycleSequence,
    monitorPollCountWhileRootRunning: monitorWorld.executions.get('continuous-life').pollCount,
    sameRootActionId: monitorWorld.executions.get('continuous-life').actionId,
    monitorInputs: [false, true, true, false, true],
    risingEdgeRejudgeCount: monitorWorld.rejudgeRequests.length,
  };
}

function proveRebuildAndHotReplacement() {
  const world = new FakeWorldSkills('replace');
  const adapter = new CandidateAdapter(resumableTree, world);
  adapter.tick(0.1);
  const firstTravel = world.executions.get('travel');
  firstTravel.progress = 7;
  const originalActionId = firstTravel.actionId;
  const rebuild = adapter.rebuildCompatible();
  adapter.tick(0.1);
  assert.equal(world.executions.get('travel').actionId, originalActionId);
  assert.equal(world.executions.get('travel').progress, 7);
  const resumedProgress = world.executions.get('travel').progress;
  assert.equal(world.effects.get('announce'), 1);
  assert.equal(world.trace.filter((event) => event.type === 'start' && event.nodeId === 'travel').length, 1);
  assert.notEqual(rebuild.previousEngineRootId, rebuild.rebuiltEngineRootId);

  const replacement = {
    version: 1,
    revision: 2,
    root: {
      type: 'sequence',
      children: [
        { type: 'action', id: 'announce', skill: 'announce', mode: 'once' },
        { type: 'action', id: 'rest', skill: 'rest' },
      ],
    },
  };
  adapter.replace(replacement);
  adapter.tick(0.1);
  assert.equal(world.effects.get('announce'), 1);
  assert.equal(world.trace.filter((event) => event.type === 'cancel' && event.nodeId === 'travel').length, 1);
  assert.equal(world.executions.has('travel'), false);
  assert.equal(world.executions.get('rest').status, 'running');
  return {
    engineGeneratedRootIdChangedOnCompatibleRebuild: rebuild.previousEngineRootId !== rebuild.rebuiltEngineRootId,
    compatibleTravelActionId: originalActionId,
    compatibleTravelProgressBefore: 7,
    compatibleTravelProgressAfter: resumedProgress,
    travelStartCount: world.trace.filter((event) => event.type === 'start' && event.nodeId === 'travel').length,
    changedTravelCancelCount: world.trace.filter((event) => event.type === 'cancel' && event.nodeId === 'travel')
      .length,
    replacementRestActionId: world.executions.get('rest').actionId,
    announceWorldEffectCount: world.effects.get('announce'),
    announceCallbackPollCount: world.executions.get('announce').pollCount,
  };
}

const originalRegister = BehaviourTree.register;
let staticRegistryCalls = 0;
BehaviourTree.register = () => {
  staticRegistryCalls += 1;
  throw new Error('Candidate adapter must not use the process-global registry.');
};

const results = {
  candidate: {
    package: candidatePackage.name,
    version: candidatePackage.version,
    publicExports: Object.keys(candidateRequire('mistreevous')).sort(),
  },
  checks: {
    instanceIsolation: proveInstanceIsolation(),
    injectedTimeAndRandom: proveInjectedTimeAndRandom(),
    persistentRunningIdentity: provePersistentRunningIdentity(),
    guardPreemptionAndReactivePriority: proveGuardPreemptionAndReactivePriority(),
    lifeCyclesAndNonBlockingMonitors: proveLifeCyclesAndNonBlockingMonitors(),
    rebuildAndHotReplacement: proveRebuildAndHotReplacement(),
  },
  constraints: {
    staticRegistryCalls,
    privateHydrateCalls: 0,
    reactiveRestepBound: 1,
    worldOwnsActionIdentityAndProgress: true,
    browserOrPerformanceClaims: false,
  },
};

BehaviourTree.register = originalRegister;
assert.equal(staticRegistryCalls, 0);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
