# 作物 Chunk 消费者 checkpoint31

## 改动与责任

accepted cropStages 经纯 CropStagePresenter 按terrain resident Chunk/呈现ID/阶段分组，同内容签名复用GPU资源；它不保存权威作物状态。crop-stage-geometry 从Pack宽高生成相对Chunk原点的两片crossed-quads（每株8顶点12索引），包括负坐标。没有逐作物Entity/碰撞体、体素变化或新的Kernel/Worker owner。GPU adapter每个batch一个render Entity，透明cutout、nearest采样、双面，借用既有terrain光照砖并复用block-light shader片段；terrain替换重新绑定，不销毁借用砖。

WorldCropPresentation 小协调器连接terrain驻留/替换、World beginScenario/restore/dispose及已有runtime错误出口；失败清理全部overlay并停止重复创建，reset可重新接受新场景，dispose之后迟到输入不复活。World仅保留窄接线，Game复用既有clientOptions.onFatal回调。GPU mesh/Entity由adapter销毁，材质/纹理由既有visualResources退出流程释放；异步纹理或半途创建失败回收自身资源。

## 验证

- 新API RED：原来两个模块缺失导致两suite导入失败；仅说明新seam未实现。Task45实际只读源码证实旧Web无cropStages消费者；原真实画面观察预期已登记，未声称已执行浏览器RED。
- Task53 pure presenter/geometry：14PASS，覆盖驻留/签名/阶段/删除/epoch/负坐标/边界/非法数据/partial factory失败/复制与尺寸。一次fixture误将不同stage放到相同cell，生产按合同拒绝，fixture更正后通过。
- Task54 World/GPU生命周期：6PASS，覆盖灯光重绑/失败清理/reset/dispose、多株一个batch、材质/几何、borrowed brick不销毁、缺light失败、decode/setSource半途回收/幂等销毁。fake PlayCanvas不是WebGL/视觉证据。
- pnpm test:classic:headless：exit0，75文件516PASS，156.20秒。
- 静态31-01在Game max-lines503>500终止；通过复用已有onFatal减少重复回调后不改门禁。31-02通过5 frozen bytes、格式/路径/lint、Kernel/stdlib/Classic/plugin/Web生产类型与Svelte0/0，但agent-server类型检查包含新fixture时发现2处Texture mock类型转换+1未用参数，原命令exit2，未记整体PASS。
- 原作者仅修mock显式unknown类型转换与未用参数命名；6focused/格式/scoped lint及pnpm typecheck:classic（已真实include全部4新文件）exit0。
- Root必要续跑 agent-server类型、tsconfig.test/tools、11文件66插件测试、14 CI/证据/identity工具测试exit0。因此本组全部必需静态项已闭环，不把31-02原命令改记PASS。

Root日志：/workspace/pr41-recovery-20261008-root-01/crop-render-static-31-{01,02}.log、crop-render-static-continuation-31-01.log、crop-render-headless-31-01.log。Luna日志：/workspace/pr41-recovery-20261008-fixtures-01/crop-stage-presenter-53-_.log、crop-presentation-54-_.log；失败日志均保留。

## 边界与后续

当前尚无新build/Chromium/实际crop画面或夜间灯光证据；现有canonical旅程未正常种植，因此仅跑旧旅程不能证明本feature可见。下一组仅在唯一完整Classic入口补正式UI/鼠标的农业消费者和readonly实际GPU观测，保持原全部断言、900s/timeout/画质，正常创造成果与Survival农业链须分别解释。不能复用4db旧dist。V2超时、V3/Modular、完整V4/194项、组合整帧A/B仍未闭环。

Kernel/stdlib/Classic Pack源码相对24896c2零diff，复用checkpoint30 stdlib153文件1105PASS；本组未重跑Kernel/stdlib行为。长期docs仅代码地图细化consumer/资源责任，不更新产品方向或性能决策，不修改sealed evidence。最近实际UI02:09UTC周剩余90%，约6天重置，60%停止线保持。本组本地提交，不推送/合并/部署。
