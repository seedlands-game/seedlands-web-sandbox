# main 同步合并独立复核

冻结 merge：4e39e485e067d81e21aa17238cc5f4e35d3e8f4e；父树：3abf70b21520fe08eeee749379fb1ea112ec0f53 与 baeba098af506f0184b9344c04b9555f9750c20f。合同 main-sync-recheck.json SHA-256 c762e9fb007c843bc58c509ee0fa4eb0e9d94f85efaf92959aea1839199ff725 已核对。只读集成审阅，未运行测试、Browser、provider 或门禁。

## 结论

未发现本次合并决议造成的具体 P0/P1/P2。手动冲突文件 tsconfig.test.json 正确合并双方基线。

## 集成核对

- tsconfig.test.json 保留既有 tests、Node monorepo、PR15、gameplay-foundation 与 developer-world-harness E2E，同时包含 living-npc-mvp/e2e 和 dynamic-local-shadow-invalidation/e2e；两侧独有目录均未丢失。
- 合并后的 root build 继续执行 build:web 与 build:agent；typecheck 包含 Agent Server 与全量 test tsconfig。Agent package/lockfile/workspace dependency 都随 living 分支保留。
- 合并后的 CI Production build 包含 Build local cognition service；Chromium regression 保留主线 regression、developer Harness、主线 visual/melee 入口，并追加 living companion integration 与证据归档。
- 主线 playwright/config 和 dynamic shadow E2E 仍存在，living E2E 仍有独立 test:living-npc 脚本及 typecheck include。没有为解决 tsconfig 冲突删掉任一验证入口。

两父树差异中由 Git 自动合并的 workflow、package、lockfile、playwright 和主线视觉文件已只按入口保留性核对，未重新审阅外部已合并的实现。只读 diff check 报出的 trailing whitespace 位于主线此前提交的 CI 证据日志，不是本次 tsconfig 冲突决议。

## 验证与风险

Root 正在执行 fullstatic、build 与 NPC/Harness Browser；本复核未执行。合并前父头没有本 merge 的 CI，因此这些进行中的门禁仍是必要证据。

## 实际成本

约 0.13 agent 小时；未派发、未写仓库、未调用外部服务。
