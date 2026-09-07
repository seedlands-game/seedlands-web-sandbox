# 合同与交接

v1 合同字段以 `scripts/validate-contract.mjs` 为准：身份与目标、上下文、读写范围和非目标、输出、执行形式与模型、准出、预算、权限、父合同 hash、资源、升级条件和报告字段。只读任务可在 `localWrite=false` 时使用空 `writePaths`。

典型流程：

```text
node scripts/validate-contract.mjs child.json --expected-hash <sha256>
node scripts/render-handoff.mjs child.json --expected-hash <sha256>
node scripts/render-handoff.mjs child.json --expected-hash <sha256> --report
```

固定 hash 绑定合同原始字节。子合同的读写路径、权限和单项预算不得扩大父合同。路径只是交接所有权约束，不是 OS sandbox；权限字段也不替代平台或用户授权。

父预算是整棵任务树共享预算。校验器只能证明单份子合同不超过父上限；父 agent 必须维护已分配与已消耗汇总，避免多个子项重复领取完整预算。脚本不读取真实计费，也不硬限制平台 token、时间或费用。

校验通过后使用渲染出的完整交接文本，禁止只发“继续做”。报告按合同 `reportFields` 回填真实结果和限制。范围、公开接口或授权变化，以及同因达到尝试上限时升级，不静默扩大合同。
