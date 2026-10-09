# checkpoint46：Transport 的 ECS lifetime owner 基础

基于精确 `5d91421ecbd6a57ecc255f476cb41bb6614c236f`，编辑前远端feature仍为该SHA、main仍为 `fba4486e433c145db658f6b1598b70c47f759c8a`。不创建worktree、不改sealed evidence、旧voxel/Chunk常量或生产浏览器期限/断言。

新增 transport entity type 与bitECS component：同一 EntityStore canonical transform/velocity/lifetime 是唯一位置与身份来源，component仅持definition/yaw/route/rider stable lifetime/fuel/cargo/revision。TransportStateV2每次从当前实体派生pose与epoch；没有可写Chunk/内部EID、第二份位置Map或猜测reference。world-local definitions必须显式配置到EntityStore第5参数，cargo使用同一items registry并验证每槽stack limit。未配置world的旧export不新增child。

EntityStore V2 optional transports child沿用原候选owner恢复：先创建全部实体、identity、actor/station/transport components，再核对完整集合、定义、货物、容量与rider实际活actor lifetime/唯一性，之后一次替换owner。缺/额外/重复child、未知定义、错误生命周期和显式undefined/null child拒绝；失败原owner/epoch/issued IDs/sequence/状态保持，成功restore使旧epoch reference失效。component中的rider不持volatile epoch，成功恢复后投影使用当前epoch。

原 `ecs-entity-owner.ts` 与 `entity-store.ts` 超500有效行的lint失败保留。仅按职责提取 `ecs-entity-types.ts`、`entity-spawn-validation.ts` 和运输组件helper；公共原类型从owner重导出，空间写入复用原字段顺序/检查，compound update的既有部分提交行为保留。Authority session实体类型从canonical enum派生并排除station；未隐藏新transport，也尚未实现Transport body policy。

实际可执行Task93 RED仅本fixture6/6 FAIL，根因unsupported transport type/缺API；命令初次误筛选被中止的日志不算有效RED。新owner8例包含真实spawn/move、独立冻结投影、restore/recycled lifetime、坏definition/cargo/child零写、rider唯一/无效生命周期、当前epoch投影和旧缺省child兼容。追加cargo overflow实际RED为7PASS/1FAIL，因为normalizeStack允许待分槽输入超过单槽上限；补组件预检后最终与原ECS/model合计3文件17/17 PASS，`transport-owner-final-46-02.log`。

受影响Web ECS/Station/Prepared/Spatial回归5文件28PASS/1FAIL；原V4 NPC fixture在未修改的spawnAutonomous注册处报Unknown actor profile: settler。Task94只给该通用codec用例加入world-local明确settler profile，保留Classic items/recipes/melee及NPC库存/模拟绑定/epoch断言，不改生产Classic profile或换成sheep。该文件最终5/5 PASS；复用其他四文件24/24，有效总计29/29。该关键V4 regression追加到既有Classic headless选择和测试类型路径；stdlib新fixture由既有包内自动收集。

静态原完整 `transport-static-46-01.log` exit2：sealed5/5、全format/paths/lint已PASS，stdlib production types发现Authority port旧enum不接transport。修正派生类型的局部format/lint PASS；`transport-static-remainder-46-01.log` 实际exit0，完整生产/root/Classic types、Svelte0错误0警告、ESLint规则及CI选择均PASS。选择器新增项的Classic类型另按真实结果记录；不是原完整命令exit0。风险核对为有界owner/static review，不等于整PR正式review。

此组只建立owner接缝，旧VehicleRuntime与非空legacy vehicles保存保持原行为，尚未转换或静默丢弃。正式prepared deploy/fuel/container、Pack/Host注册、Authority caller/view/body、骑乘停止walking/安全下车、实际客户端呈现及V3/V4产品验收仍需后续落实。未构建、未重跑浏览器或性能；Browser34/远端44 Chromium依然FAIL，C5、194、真实Modular与组合整帧A/A/A/B未完成，PR不可合入。10:10实际周额度86%，含其他任务；约60%停止线保持。
