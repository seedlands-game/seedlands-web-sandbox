<script lang="ts">
  import type { BehaviorNode, CharacterBehaviorState } from '@seedlands/game-core/runtime/behavior-control-protocol';

  let { behavior }: { behavior: CharacterBehaviorState } = $props();

  function rows(node: BehaviorNode, depth = 0): { node: BehaviorNode; depth: number }[] {
    return [{ node, depth }, ...('children' in node ? node.children.flatMap((child) => rows(child, depth + 1)) : [])];
  }
  const labels = { selector: '优先选择', sequence: '依次执行', condition: '条件', action: '技能' };
  const statuses = { running: '执行中', succeeded: '已完成', failed: '失败', interrupted: '已中断' };
  let nodes = $derived(rows(behavior.definition.root));
  let running = $derived(behavior.runtime.skills.filter((skill) => skill.status === 'running'));
</script>

<details class="behavior-inspector" data-testid="character-behavior">
  <summary><span>行为与执行</span><small>版本 {behavior.revision} · 轮次 {behavior.runtime.cycle}</small></summary>
  <div class="body">
    <p class="goal">{behavior.goal.description}</p>
    <div class="activity" aria-label="当前持续活动">
      {#each running as skill (skill.nodeId)}
        <div>
          <span class="dot" aria-hidden="true"></span>
          <strong>{skill.skill}</strong><span>{skill.phase}</span>
          <small>已执行 {Math.floor(skill.elapsedSeconds)} 秒 · 重规划 {skill.replanCount} 次</small>
          {#if skill.actionId}<code title={skill.actionId}>{skill.actionId}</code>{/if}
        </div>
      {:else}
        <p class="muted">当前没有占用身体的活动；条件与生活轮次继续推进。</p>
      {/each}
    </div>
    {#if behavior.goal.milestones?.length}
      <ul class="milestones" aria-label="目标进度">
        {#each behavior.goal.milestones as milestone (milestone.id)}
          {@const satisfied = behavior.runtime.milestones.find((entry) => entry.id === milestone.id)?.satisfied}
          <li class:satisfied>
            <span aria-label={satisfied ? '已满足' : '未满足'}>{satisfied ? '✓' : '○'}</span>{milestone.description}
          </li>
        {/each}
      </ul>
    {/if}
    <ol class="tree" aria-label="生效行为树">
      {#each nodes as { node, depth } (node.id)}
        {@const skill = behavior.runtime.skills.find((entry) => entry.nodeId === node.id)}
        <li
          style:--depth={Math.min(depth, 6)}
          class:active={behavior.runtime.activeNodeIds.includes(node.id)}
          data-status={skill?.status ?? 'inactive'}
        >
          <div class="node-heading"><code>{node.id}</code><small>{labels[node.type]}</small></div>
          {#if node.type === 'action'}<span class="skill-name">{node.skill}</span>{/if}
          {#if skill}<small class="node-status">{statuses[skill.status]} · {skill.phase}</small>{/if}
          {#if skill?.reason}<p class="reason">{skill.reason}</p>{/if}
        </li>
      {/each}
    </ol>
    {#if behavior.definition.monitors?.length}
      <div class="monitors" aria-label="重新思考条件">
        <strong>重新思考条件</strong>
        {#each behavior.definition.monitors as monitor (monitor.id)}
          {@const state = behavior.runtime.monitors.find((entry) => entry.nodeId === monitor.id)}
          <p>
            <span class:matched={state?.matched}>{monitor.reason}</span><small>触发 {state?.episode ?? 0} 次</small>
          </p>
        {/each}
      </div>
    {/if}
    <details class="definition">
      <summary>完整生效定义</summary>
      <pre>{JSON.stringify(behavior.definition, null, 2)}</pre>
    </details>
  </div>
</details>

<style>
  .behavior-inspector {
    margin: 12px 0;
    border: 1px solid #536650;
    border-radius: 8px;
    background: #15221bd9;
  }
  summary {
    cursor: pointer;
    padding: 10px;
    color: #eee6d1;
    font-size: 12px;
  }
  summary > small {
    display: block;
    padding: 3px 0 0 14px;
    color: #b1bea9;
    font-size: 10px;
  }
  .body {
    padding: 0 10px 10px;
  }
  .goal {
    margin: 4px 0 10px;
    font-size: 12px;
    line-height: 1.6;
    color: #e9e2c9;
  }
  .activity {
    border-radius: 5px;
    padding: 8px;
    background: #2b3f30;
    font-size: 11px;
  }
  .activity > div {
    display: grid;
    grid-template-columns: 6px 1fr auto;
    gap: 5px;
    align-items: center;
  }
  .activity small,
  .activity code {
    grid-column: 2 / -1;
    color: #b6c5ae;
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #b8d88b;
  }
  .muted {
    margin: 0;
    color: #b8c3ad;
    line-height: 1.6;
  }
  .milestones {
    list-style: none;
    padding: 0;
    margin: 10px 0;
    font-size: 11px;
    color: #aebaa8;
  }
  .milestones li {
    display: flex;
    gap: 6px;
    margin: 5px 0;
  }
  .satisfied {
    color: #c4dfa2;
  }
  .tree {
    list-style: none;
    padding: 0;
    margin: 12px 0;
    max-height: 300px;
    overflow: auto;
  }
  .tree li {
    margin: 3px 0 3px calc(var(--depth) * 8px);
    padding: 6px 7px;
    border-left: 2px solid #445443;
    background: #1b2b22;
  }
  .tree li.active {
    border-color: #c4de99;
    background: #334733;
  }
  .tree li[data-status='failed'] {
    border-color: #ce927c;
  }
  .node-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 5px;
  }
  .node-heading code {
    color: #e1e2d0;
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .node-heading small {
    flex-shrink: 0;
    font-size: 9px;
    color: #a6b5a0;
  }
  .skill-name,
  .node-status {
    display: block;
    margin-top: 3px;
    color: #bfcbae;
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .reason {
    margin: 4px 0 0;
    color: #e3b6a4;
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .monitors {
    font-size: 10px;
    color: #afbea5;
  }
  .monitors > strong {
    font-weight: 500;
    color: #d0d5bd;
  }
  .monitors p {
    display: flex;
    justify-content: space-between;
    gap: 5px;
  }
  .monitors small {
    flex-shrink: 0;
  }
  .matched {
    color: #e0d593;
  }
  .definition summary {
    padding: 8px 0 0;
    color: #aebda4;
    font-size: 10px;
  }
  pre {
    max-height: 260px;
    overflow: auto;
    color: #c9d3ba;
    font-size: 10px;
    line-height: 1.5;
  }
</style>
