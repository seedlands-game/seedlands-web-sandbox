# 玩家动作请求与整数表示：进度

本切片沿用 [实施合同](network-action-request-plan.md)，新增 Host 真实两参数的请求参考投影，未采用 wire 或连接协议。身份只在真实 Host 上下文中取得；裸请求参考不能作为已经认证的公网协议。

## 变更与独立验证

Terra 负责 request/receipt 共用动作副本和整数零，Sol 负责真实 Host 采集与应用 oracle，root 负责共同 schema、候选整合和统一检查。九种动作保留各自字段、MAX_SAFE_INTEGER 槽位和带符号安全坐标；稀疏三元组不能绕过检查。整数零在参考投影先统一为 `+0`，f64 的负零保持；这不修改 Host/世界规则，也不由各 codec 私自决定。

新增纯投影和整数规则分别有缺模块/原值不符的 RED，随后 reference 单元 36/36 GREEN。所有参考字段按类型处理：tick/revision/sequence、计数/索引是整数，move、issuedAtMs、位置/速度、worldTime 等已定义 f64 的字段继续保真。Gameplay breakAction 的展示位置是 f64，动作请求的整格位置是整数，两者不混淆。

## 真实语料与应用范围

`/tmp/seedlands-network-action-corpus-v1-source-bound` 记录 10 次真实调用：九动作各一次，并重试一次同 sequence、同 payload 的 `select-hotbar`。每次包含 request、实际 receipt、Gameplay 和 correction，合计 40 条。实际成功项为 select-hotbar 与 cancel-break；其余失败来自真实业务规则，包括不存在的 recipe/target、超范围位置、存活时 respawn、不能移动物品和非法槽位。旧 `/tmp/seedlands-network-action-corpus-v1` 保留不动。没有制造成功 crafting、combat、placement 或库存消费。

每条 provenance 绑定 Host 提供的 epoch/issuer/`player-actions`、调用 attempt 和原 request id；manifest 与逐条内容/索引 hash 从磁盘重新计算。原始内存记录与落盘记录另做 deep equality，本组没有因 JSON.stringify 静默丢失 f64 负零。当前 recorder 尚不通用地承诺任意负零语料都能用原生 JSON.stringify 保存；若出现差异，该门直接失败。

三候选每组 40 条 decoded reference 在实际应用前核对来源与强等价，再分别创建全新真实 Host，用解码 action/sequence 调用 `performAction`，逐条核对真实回执、Gameplay 与 correction。错误来源、篡改动作或混入客户端身份字段的负例在应用次数为 0 时拒绝。应用 oracle 还以固定清单重新计算当前工作树的六个源码 SHA-256，拒绝缺项、多项或过期 hash，并精确核对四帧组的 provenance、attempt、retry 引用、observedResult 与 receipt transaction。

重复选栏的 receipt 与首次一致，Gameplay revision 不增加。这是该动作的重试证据，不能扩张为非幂等库存消费、世界编辑、断线未知结果或跨 epoch 重试已经准出。当前受控时钟固定为 0，动作失败路径不进行地形变更；它不是持续模拟、网络延迟或世界压力语料。

## 检查与剩余门禁

`pnpm verify:static` 本轮通过：179 文件通过/2 跳过，942 项通过/4 跳过，world 行覆盖 96.37%；格式、ESLint、命名、coverage 与完整类型检查均通过。新增源码绑定用例先在空实现下 RED；启用门禁后又真实拦住格式化造成的旧采集源码 hash，未绕过。固定源码稳定后以 Node 22.23.2 新采集 source-bound corpus，动作 corpus 1/1；三候选实际 Host 应用 oracle 3/3 通过，日志为 `/tmp/seedlands-action-application-source-bound.log`。浏览器构建与五入口 Node 构建通过，浏览器构建仍有既有大 chunk 提示。源码、环境与日志 hash 见 [机器证据](network-action-request-evidence.json)。旧采集的 Node 26.0.0 记录保留为历史；本次 source-bound 采集与应用均为 Node 22.23.2。

三候选小动作 direct codec、完整 pipeline 与实际 wire 边界已经验证；C2 非法动作枚举、超安全序号在对象解码前拒绝。原型仍只放 `/tmp`，所有结果 `timing: NOT_COLLECTED`。当前尚无 N2/N3 正式性能结论、支持矩阵或 wire v1；大消息表示/分片、真实消费者字段、T2 能力、GUI/WAN 与上移不退化实验继续保留门禁。

长期 docs baseline 本次不新增入口/职责变更，记录保留在当前 change。原冻结 spec/附件不改写，整个 change 仍 Active；源码与本页随阶段语义提交推送当前功能分支。

## 浏览器互操作与复验方式

Chrome 152.0.7977.76 与 Node 22.23.2 对动作组每候选、每方向各 40 条通过。此前 59 条（9 真实/50 synthetic）、21 条输入、6 条实体、3 条 synthetic 负零四组也分别通过。路径为 parse → schema → own → hash → consumer。426744 字节 bundle 包含全部候选和 oracle，不作为候选产品包大小。

采集与应用用当前 change 的 vitest.action-corpus.config.ts 和 vitest.action-application.config.ts 显式运行；应用要求 SEEDLANDS_ACTION_DECODED_FIXTURE 与 SEEDLANDS_ACTION_SOURCE_CORPUS 指向已验证的临时 decoded fixture 和源语料目录，缺少输入会失败。旧 source 语料保持历史身份。原型和临时语料未提交，机器证据保存内容 hash、结果与范围。

最终 source-bound 动作组于 2026-09-07 04:15:10.696 UTC 完成 Chrome/Node 双向各候选 40/40。该次 bundle 为 427380 字节，独立 hash 见机器证据；前述 426744 字节属于历史五组验证，不将两次 bundle 混为一次。源码绑定门补充后，定向应用 3/3、目标格式/ESLint 与完整类型检查通过；未改变本批已通过全静态与构建的生产源码，未为验证 helper 的修改重复整套构建/coverage。
