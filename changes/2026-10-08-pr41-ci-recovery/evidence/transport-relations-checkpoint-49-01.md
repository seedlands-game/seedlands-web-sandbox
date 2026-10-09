# checkpoint49：正式上下车与静态骑乘约束

基于07ed9416c7c49cb8ff38e1a77bae2dcc390f7b96。新增可选 `defineTransportRelationModule({moduleId, operationId})`，requires显式transport-interactions能力。沿现有Authority interact使用原协议 `use`＋entity lifetime target上车、`alternate`＋self下车；预注册的primary/secondary指操作语义，不增加这些枚举或新action。模块只读actor/site、返回候选；Host重建候选，验证目标、四项selection revision、活着且唯一的rider、距离/加载射线、真实身体/实体占位、receipts和当前owner。两项实体变更用同一prepared EntityStore participant发布transport rider/revision与actor position/零velocity，任何after-rule veto、改写或新鲜度失败均零写。资源仍为原显式Host运输授权，不给模块可写owner。

原真实caller RED `task102-relations-red-01.log` 捕获 `OPERATION_FAILED / No state owner for seedlands:transport-relation.`；接stateport后实际 `STATE_PARTITION_INVALID` 暴露root误用string partition，类型检查同样捕获。修为两个显式component而不改变partition合同。site的seat观察排除players后，由Host按真实自身Actor/目标transport排除、重新检查其他player占位；出口使用已加载World/实体和player AABB，支撑用实际registered/model碰撞floor strip，不以solid flag代替几何。所有格先完整检查unknown，扫描限4096格；不可索引、精度坍缩或超容量输入在读取World前拒绝，避免finite巨坐标进入不前进的整数循环。

骑乘座位由当前EntityStore transform/transport component和definition派生，无第二份位置/关系owner。Authority骑乘者不走独立walking/creative flight/gravity、角色分离或恢复位置写入；运输body本片仍静态。未骑乘角色原分离算法按职责搬到authority-character-separation。真实receiveInput＋500ms物理推进后仍在canonical seat；mounted portable checkpoint保存/新Authority恢复重新投影当前lifetime与seat，坏rider存档调用同一source.server.restore()拒绝且当前owner/存档不变。

Task102曾在deploy后world edit抓到 `Entity has no registered body: transport:undefined`。这是生产接缝缺陷，不能当fixture错误绕过。Task103保留原后部署编辑取得真实RED `task103-transport-edit-red-01.log`；physics与geometry recovery现在共用authority-body-config解析同一个当前世界definition。station与Authority实体body集合一致，碰撞由其World voxel形状承担。原失败编辑随后通过，mount因真正seat solid拒绝；mounted后方块改动、其他player占seat/出口、真实初始unloaded north出口都验证拒绝零写。evict尝试实际false，原因bodyActiveChunkKeys的±1padding保持pin，未修改保护；最终改用自然未物化frontier并两次确认peekLoadedVoxel null，保留false尝试日志。

Task103最终2文件19/19 PASS、scoped ESLint、Classic types PASS；根物理/owner/Kernel/模型6文件68/68与正式交互/结构/媒体4文件48/48 PASS。geometry回归首轮3文件8PASS但新增测试因错import/schema有无效0-tests和1FAIL记录；校正真实geometry import及合法semantics后新增4/4 PASS，不改model注册规则。完整static49-01实际EXIT2：冻结5、全format/paths/lint、全生产与工具types、Svelte0/0有效，最后Classic fixture在编辑中出现readonly tuple错误；Task103复制tuple后最终Classic types通过。随后单独补原未运行的规则66/66、CI选择14/14，均actual exit0；不将原全命令改写为PASS。

根风险审查发现site为了seat排除所有players也使出口挑到第一个被占位置，Host正确拒绝但没有尝试其余安全出口。Task104新增单个west出口player占位实际RED12/13，正常alternate返回OPERATION_FAILED / target-occupied；出口投影改为读取所有真实player AABB，只排除carrier，seat仍单独由Host重检。最终2文件20/20 PASS、scopedlint及Classic types actual exit0；根最后geometry ESLint/stdlibtypes亦actual exit0。首次错误package-filter参数触发更广Vitest后立即中断，只采用后续精确文件命令，不把中断当通过。未降低断言/500行门槛或改body/权限合同。

远端48组run37924184808五项SUCCESS，Chromium CANCELLED、Cloudflare SKIP。job113799502427日志显示第一次main在原900秒耗尽（15.3min），C0–C3、Creative作物/导航、V1完成，V2耗时9.2min；retry在25min job上限被取消。本次不是49推送取消（当时远端仍07ed9416）。没有浏览器完整PASS、没有C5/Survival自然生产或新的performance/build证据，不能由step显示完成或headless宣称可合入。

Classic pack声明、旧V4 identity与legacy vehicles保持；尚未实现运输运动、燃料/货箱UI、Classic/Modular真实产品、mounted death结算与非空legacy迁移。11:40产品真实周剩86%、约5天15小时重置，60%停止线保持。11:42连接通知后的正常只读Git/status/process读取成功，未重建或重跑环境。feature PR预览沿用明确授权，不合并、不main推送、不生产部署。
