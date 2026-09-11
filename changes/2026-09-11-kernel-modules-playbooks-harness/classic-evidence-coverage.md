# Classic 唯一生产线路覆盖台账

## 固定线路与证据边界

唯一浏览器线路是 `apps/web/tests/e2e/classic-runtime.spec.ts`，场景数据是
`playbooks/classic/scenarios/canonical-runtime-v1.json`。正确性、诊断与 Runtime
benchmark 只通过环境变量改变采样等级，不复制行动序列。初态准备在 C0 计数基线前完成；C1–C5
途中不注入资源、不传送、不直接写权威结果。

当前固定观察点如下：

- C0 从正式 preview 读取 `harness-artifact.json`、`packs/packs.lock.json` 和实际网络请求，校验稳定产品身份
  `seedlands:overworld@1.0.0`、`packs/overworld.mjs` 的准入 SHA、Worker/Wasm 产物以及实际 WebGL2
  renderer/vendor/version。
- C1 通过 Pointer Lock、真实鼠标、`W` 和 `Space` 产生 Authority 输入回执、物理推进和 Chunk 边界跨越。
- C2 用真实鼠标挖掘四个原木和一个浆果，要求掉落物先可见，再用真实移动拾取；随后用 E 背包和可见配方按钮制作木板、木斧、木剑与工作台。
- C3 用右键放置结构并等待 mesh commit；用 UI 食用浆果；木剑连续真实输入必须观察到“已衔接下一击”“第 2 击”和 7 点伤害，固定 12HP 生物由 5+7 两段击败。工作台由库存放置并打开，随后通过真实采集拆除、看到掉落并拾回库存。
- C4 默认 NPC 使用初态内固定浆果栈，不连接模型服务；浆果位于 NPC 家园附近、但在玩家 x 轴线路的 1.5 格自动拾取半径之外，保留 NPC 的真实寻路、拾取和消费机制。同一 `nodeId + episode` 必须有
  `activity-started` 与 `activity-succeeded`，且身体位置改变。玩家真实往返四个 stream center，远端
  loaded/rendered Chunk 保持有界；返回时同一 Chunk key 必须产生不同于出发前的新 trace ID，并包含
  `worker-start → worker-complete → commit-queued → visible-postrender`。
- C5 用真实 Escape 暂停、保存并返回主菜单，再继续同一世界；保存前同时记录 Authority inspect、portable checkpoint 中对应 Chunk/index/voxel、NPC entity/actor/character 的 lifecycle、health、needs、事件和 Web 派生镜像，并要求 NPC 在保存边界仍为 active/alive。恢复后先等 Authority 目标 Chunk 可读，再要求派生镜像追上相同 voxel，借此区分存档丢失和镜像尚未同步；随后再次读取 portable checkpoint 和角色观察，要求同一 NPC 仍为 active/alive。线路仍要求新 epoch、结构修改、库存、NPC 身份和行为状态恢复。首次工作台在 C3 已拆除并拾回，所以恢复时目标体素应为空、库存应含工作台；随后从可见目标卡读回当前指向，通过 Pointer Lock 真实鼠标重新对准支撑体素与工作台，再用背包键盘手势放置并打开工作台，并要求新的真实移动输入被 Authority 确认。保存/继续创建的新控制器不继承旧 yaw，因此该重新对准动作是 C5 正式输入的一部分。

C4 的浏览器证据证明客户端 Chunk 被取消后为同一 key 重新请求、完成、提交并可见；公开 telemetry
目前没有直接的 PlayCanvas `destroy` 回执，因此不把它表述为精确内存释放。Authority residency
在诊断样本中可保持无 eviction；这不等同于客户端 presenter 没有释放，也不能据此宣称 Authority
eviction 已覆盖。现有 trace 把阶段绑定到 trace ID 和 Chunk key，但仍未公开完整的
`taskId + epoch + revision` 元组；§10.5 的完整关联上限以生产 telemetry 实际字段为准。

## 历史浏览器保护去向

| 历史保护                                  | C0–C5 去向                                                                | 状态   |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------ |
| `tests/e2e/regression/world-play.spec.ts` | C1 真实输入、跳跃与 Chunk 跨越；C2/C3 权威修改与呈现；C5 保存继续         | 已迁入 |
| loading-performance / web-package-runtime | C0 正式产物、Pack、Worker/Wasm、WebGL2；C4 当前线路任务实际消费           | 已迁入 |
| gameplay-foundation / inventory-pointer   | C2 掉落、拾取、背包和配方；C3 食物、放置、木剑二段连招；C5 恢复后键盘换装 | 已迁入 |
| creative-container-interaction            | C3 工作台放置、打开、拆除、拾回；C5 恢复库存后再次放置并打开              | 已迁入 |
| npc-composable production/resident        | C4 无模型活动的开始/成功 episode 与身体后果；C5 同一角色身份恢复          | 已迁入 |
| initial-world benchmark                   | 相同 C0–C5 路线由 benchmark 模式采样                                      | 已迁入 |

以下保护不能由 C0–C5 无损替代，保持显式缺口：

- 无 JavaScript 首屏与 hydration 前输入连续性；
- high quality 灯笼动态阴影 caster 移除的像素观察；
- Macro 地图与窄视口 F3 诊断可见 UI；
- Asset Workbench、IndexedDB 编辑和完整外观/动画矩阵；
- 真实模型 provider、PG、WebSocket 与三个 resident 角色；
- 主观音频质量和非 WebGL2 renderer。

这些缺口不能被 Classic 总 PASS 吞掉，也不能通过恢复第二条 Playwright 线路或删除旧连招断言消失。
