# 全局 skill 与 runtime 实施快照

下文保留实施者交棒时状态。最终版本已完成15/15测试与独立验收，并安装本机；当前状态与安装记录见 [交付记录](delivery.md)。

## 完成状态

已完成可版本化的 `agent-work-routing` skill 源、固定合同校验/渲染、可恢复批处理 runtime、默认 dry-run 的全局安装器，以及原生测试。未安装到全局目录；由 root 验收后执行 `install-global.mjs --apply`。

## 用法

```text
node skill/agent-work-routing/scripts/validate-contract.mjs <contract.json> --expected-hash <sha256>
node skill/agent-work-routing/scripts/render-handoff.mjs <contract.json> --expected-hash <sha256>
node skill/agent-work-routing/scripts/batch-runtime.mjs --help
node skill/agent-work-routing/scripts/install-global.mjs
node skill/agent-work-routing/scripts/install-global.mjs --apply
```

安装器默认只输出计划。`--apply` 先备份旧 skill 和全局 `AGENTS.md`，再复制版本化源、幂等写入唯一标记段，并在备份目录生成安装 hash 清单、恢复元数据和可执行恢复命令。它不依赖 Seedlands 绝对路径。

## RED / GREEN 与验证结果

- 初始 RED：`node --test .../tests/*.test.mjs` 因合同/runtime 模块尚不存在而失败。
- 接口 RED：无模型 script、只读空写范围、带理由升档三个新增测试均按预期失败；修复后通过。
- 恢复 RED：verify 失败续跑曾重复 write；加入持久化 `writeStarted/writeCompleted` 阶段后，只重做 read/verify。
- GREEN：14 个 Node 原生测试全部通过，覆盖父 hash/权限/路径/预算拒绝、默认路由有理由调整、100 项本地 HTTP 并发、有限重试、失败续跑、输入/配置/adapter 漂移拒绝、非幂等未知结果对账、取消恢复、审计保护和安装备份/幂等性。
- 正式合同：`global-runtime.json` 以指定 SHA-256 通过新校验器；`project-policy.json` 也以指定 SHA-256 通过并成功渲染完整交接。
- 所有 CLI `--help` 可运行，Node 语法检查通过。
- 实施环境的 Python 因缺少 `yaml` 在导入阶段退出；随后独立 Terra 验收在可用环境完成 skill-creator `quick_validate.py`，并复跑 13/13 当时测试、四个路由演练与安装 dry-run，结果通过。最后的默认路由调整由合同测试继续覆盖。

## 限制

- 合同脚本校验交接文件，不能硬拦截平台派发、形成 OS sandbox、读取真实消费或保证整棵父子树预算；父 agent 仍需汇总已分配与已耗预算。
- runtime 的稳定 key 只有在远端/adapter 真正支持幂等时才有效。非幂等结果不明会停止并要求对账；runtime 不能自动撤销远端写入，取消也不能证明在途请求未执行。
- 审计不保存 payload、原始响应、异常正文、幂等键或密钥；恢复所需输入 snapshot 仍是敏感运行数据，应放在受控目录。
- 当前只用本地 HTTP fixture 验证，没有访问真实线上表格或其他外部服务。skill 不会自动同步到其他机器。

## 下一步

root 审阅 dry-run 后执行全局安装。当前 agent 继续按已正式校验的 `project-policy` 合同实现项目性能窗口与规则。
