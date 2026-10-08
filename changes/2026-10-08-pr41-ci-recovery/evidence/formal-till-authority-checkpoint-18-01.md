# V2 正式 till Authority 与 capability selector

本组从远端 `956bc6a6ec280b65974b0145481222e63a1da10c` 接续；未合并、未开启 auto-merge、未推 main、未部署生产。只读审计发现旧 tillOutcome 是未接入正式选中物品交互的纯函数，并把 Classic Grass/Dirt/Farmland 固定在 stdlib。有效 RED `till-authority-21-red-02.log` 在实际 Authority、存活 Survival、当前铁锄250耐久、已加载草地/空气、有效四元选择、范围/LOS条件下收到 item-no-interaction。拒绝早于范围/LOS执行，前置条件由夹具另行证明。

## 生产职责

item-interaction-module 从冻结内容目录展开 itemId 或 capability selector；任一实际 storage itemId/trigger 的绑定重叠拒绝准入，没有隐含 priority。selector 仍是严格单字段枚举 data record，拒绝 accessor、symbol、额外键及未知/无匹配能力。客户端仍只能提交实际 intent、target 和四元 selection，不能挑 binding、operation 或 capability。

新的 soil-transform-interaction 只接受 Pack 显式来源、目标、空上方方块及耐久成本，通过正式注册 operation 读取 actor、hit、adjacent、独立 soil-above 投影。上方即使不是鼠标命中面，也必须已加载且可耕。host 用已装配配置重派生完整候选，核对观察集、原始角色/授权及 revision，复用 voxel-interaction-commit 准备库存、取消、世界和回执；统一 finalizer 先验证所有参与者再 apply。不扩张为跨任意外部 I/O 的异常回滚承诺。

Classic 只在自己的 item-interactions 配置 Grass/Dirt→Farmland、Air、耗损1，五种锄具经能力 till 绑定。生存模式实际耗损和破损移除；Creative 使用明确声明的 max 耐久构造脱离库存的评估栈，保持库存与 catalog，不启用 legacy durability 默认迁移。配置也写入 capability definitionIdentity，避免同 descriptor 下不同策略共享组合身份。

## 校准与验证边界

初始 producer 拒绝的根因是候选中 targetPosition 与 hit.position 共用同一个数组，违反既有 invocation 的无共享 alias 合同。改为独立副本，保留严格合同。一次 direct-op 诊断也使用同类 alias、已移除；其报错不充当产品 RED。Creative 初次矩阵21/22暴露无 instance 的评估栈拒绝；显式声明 max instance 后22/22通过。

当前 Authority till 矩阵23/23 PASS，覆盖五锄×两土、破损移除、四种 stale selection、Creative、错误工具/土/上方、侧面上方占用、距离/遮挡、未加载目标、仅独立上方未加载、准备期间外部 world commit 和无半提交；`soil-above-26-green-01.log`。完全非 Classic Pack 的2/2 HeadlessSession spine 使用自定义 soil-shaper、方块3→4、成本2，生存耐久5→3、Creative不写库存、策略外来源无提交；`soil-spine-24-green-01.log`。

根 focused 五文件51/51 PASS（矩阵扩展前22例；`formal-till-headless-18-01.log`），包括旧 pure till2、正式 fluid15、nonClassic2、item-spine10。后者原 RED9/10 因缺显式 death inventory policy，唯一死亡场景局部加非Classic retain policy，保留 applyDamage成功与 dead interaction拒绝断言。新测试和原正式fluid加入 headless/types 固定选择器，不移除已有用例。selector/security36/36 PASS（`item-selectors-22-green.log`）；CI selector13/13 PASS。

完整 headless 首次5FAIL/256PASS：两份原 mouse fake 没有新实际锁定 guard 所需的状态；随实际 fake click维护锁定，并把虚拟 cursor baseline与其明确 canvas中心一致后，原6个route/RAF/pulse断言 PASS（`pointer-fixture-regression-17-02.log`）。完整类型首次只在新纳入的测试发现 unknown result、过窄默认 voxel参数、invocation JSON输入类型和unused type，均已修正，Classic types PASS。最终 verify:static:ci PASS（含完整 typecheck、format、5/5 sealed-byte identities、lint、eslint tests、13/13 CI选择器）；完整 Classic headless43文件262/262 PASS。stdlib CI广泛回归147文件1084 PASS、3文件6 FAIL，全部是原15秒/5秒超时；不更改门禁。该轮与static/headless并行，本环境CPU quota4、内存16GB；这些容量读数不直接证明失败原因。其他进程终态后只重跑这3个文件、原maxWorkers1、原门禁，13/13 PASS，56.37秒（formal-till-stdlib-serial-18-04.log）。同一生产候选没有功能性代码修改；结果与并行资源竞争一致，但不把容量读数当唯一因果证明，也不把分次通过改写成首次全suite PASS。最终精确SHA CI仍须核实。

## 精确存档身份

pre-till-v4-browser15-01.json 来自 c682770 的真实 world.checkpoint export、闭合 browser15 trace call@39；只新增一份精确 capture，未删除/改写 sealed evidence。生产 pre-till-v4-composition-identity 为独立常量，前驱只允许这个完整身份的 V4。5/5 lineage PASS，新增 V1/2/3拒绝、operation/module/hash篡改拒绝。首跑因 sparse未物化旧pre-death单个JSON而ENOENT，随后仅 git show 当前HEAD精确blob到原空缺路径，5/5通过。没有展开历史目录，没有把当前 Pack 动态滤除新模块形成宽松兼容。

这只证明身份准入；尚未做旧完整存档真实恢复及耕地世界持久化验收。只读有界风险审查未发现 P1/P2，指出 target voxel未知配置在 world-edit准备时失败关闭而非freeze时拒绝、以及上方未加载缺测；后者已补23例。完整 Browser17尚未运行，crop producer/V3/V4/modular/194项仍未闭合，PR尚不能合入。实际产品周额度20:01UTC剩余92%、停止线约60%；未收到停止要求，模型实际会话元数据未核实。
