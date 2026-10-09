# 作物内容呈现合同 checkpoint30

## 本组结果

CropPolicy 可选 presentationId 经原 CropRuntime 冻结，只读 Authority cropStages 条件投影，旧无标识配置严格保持 position/stage 两字段。标识不进入 CropRecord/checkpoint，没有新作物状态 owner。Classic 声明 seedlands:wheat-crop 与8张原创16×16透明SVG、8阶段尺寸，并列入 Pack resources。旧 presentation schemaVersion1 缺 crops 仍有效；新可选 crops 强制唯一ID、恰好8阶段、锁定相对纹理、有限正尺寸(0,2]，失败释放此前创建的资源URL。

实际 Browser22 捕获的完整组合身份作为唯一新增 V4 predecessor；模块定义或 entry integrity 篡改仍拒绝。捕获来自4db1a0b（玩法组合与cd5相同），Browser22完整旅程因A/A噪声失败；该捕获仅证明身份，不冒充玩法PASS。原始 Browser22 measurement/trace 与旧 captures 均未改写。

## 验证与失败记录

- 有效RED：正式Classic planting已成功，旧Authority投影缺ID；旧loader拒绝合法8阶段声明。此前fixture404另存，不作为产品RED。
- focused GREEN：loader+Authority 14/14、policy 3/3；新用例覆盖成长/恢复/独立投影、不改checkpoint、旧格式、锁校验/URL销毁、异常声明、精确V4恢复与篡改拒绝。
- 完整 pnpm verify:static:ci：exit0；5/5 frozen bytes、Prettier、路径与ESLint、全部生产/工具/Classic测试类型、Svelte0 errors/0 warnings、11文件66插件测试、14 CI/证据/identity工具测试PASS。
- pnpm test:classic:headless：exit0，71文件496PASS，188.01秒。
- pnpm test:stdlib:ci：exit0，153文件1105PASS，195.03秒。
- Root首次V4 helper源码字符串转义错误使Authority import失败，已改为双层JSON序列化，原失败日志保留。policy测试首次误放src导致正式config找不到文件，已移至packages/stdlib/tests并沿用正式selector，不使用override。Luna legacy fixture descriptor/manifest不一致亦已修正，未改生产门禁。

日志：/workspace/pr41-recovery-20261008-root-01/crop-presentation-{static,headless,stdlib}-30-01.log；focused及失败探针位于 /workspace/pr41-recovery-20261008-fixtures-01/crop-presentation-52-*.log。状态核对01:57:40UTC成功，Root与Luna操作未受环境断连通知影响。

## 未完成与交接

未运行本组生产构建、Chromium、实际8阶段可见性或性能采样。Web尚无crop渲染消费者；当前dist仍属于已撤回4db候选，不能用于新源码验收。Kernel未改，本轮不重复其行为测试。远端cd5的Chromium取消，V2超时仍未闭环；正式V3/Modular、V4完整旅程、194项产品矩阵与组合整帧A/B仍待验收。

长期docs仅更新代码地图的内容/投影职责与ASSETS来源说明；产品方向、碰撞/射线合同、CI期限/断言、性能门槛与sealed evidence未改。本组仅本地功能提交，不触发外部发布。最近实际UI读数01:41UTC周剩余90%，包含其他账户任务；02:01左右已请求更新，约60%停止线维持。请求模型Sol6.1/high与既有Luna/medium；本会话实际模型元数据未核实。
