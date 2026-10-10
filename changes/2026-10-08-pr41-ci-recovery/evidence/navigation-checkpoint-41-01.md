# checkpoint41：正式导航 producer 与接受视图

原 NavigationItemsRuntime 仍唯一拥有地图、序列和V1 checkpoint。新可组合 policy 不引用Classic；item IDs、体素颜色和body feet下方一格的采样配置归Playbook。window0..4和color0..15保留V1保存边界；未知cell不填色、不加载、不借用MacroMap。旧center/scale/pixel解释与map ID保留。

地图真实右键复用既有Authority interact self与四类expectedSelection，不新增action/target。注册模块先读owner投影并生成纯候选，再由唯一owner prepared port检查候选/作用域、actor/owner lifetime、selection、loaded样本与授权后提交。注册测试暴露的host resource许可、definitions-ready顺序和player self授权缺口已修复；新的导航resource只授予已注册的player自身实体，不增加autonomy或云权限。

两阶段反例获得实际RED：validate后切换物品，旧apply仍写入地图。修复为apply重新校验当前owner、actor、projection、revision、权限与容量；Task78/79最终4/4 GREEN。after-rule veto、伪造write、selection/loaded颜色/restore/actor换代拒绝后checkpoint、inventory、gameplay revision均无写。policy sparse palette原被接受获得RED，已拒绝hole和超过16-bit唯一体素域容量的数组，仍3/3 GREEN。

Task76 registered主链3/3 GREEN，包含两次更新同map ID、未知pixel保留与inventory不变；它的选槽是夹具设置，不能当作正式选择验收。Task81/82补真实Authority performAction caller：hotbar选择→self注册更新→accepted navigation view一致，四类过期选择无写，指南针/时钟持有投影随实际选择变化。最终2/2 GREEN。

V4前驱只使用Browser30真实export的精确composition身份，并限定V4。逻辑fixture使用当前合法checkpoint body加实际旧identity、删除optional navigation child；恢复空owner且保留库存内容，篡改pack-lock digest拒绝且snapshot不变。它不是原始旧存档bytes的真实浏览器恢复。恢复后的actor epoch会更新，最初夹具比较reference失败已保留并改为比较库存内容。

客户端右键、原食品消费及HUD接受投影联合3文件12/12 PASS；新增map owner revision只在accepted view显示，不改变V1 child。HUD用注册地图、出生点方向和Authority世界时间，地图未知pixel透明。原唯一Classic runner内已注册正常Creative导航选择/self更新/截图与C5恢复；尚未实际运行，不称Survival自然采集或194完整验收。

首轮整体静态navigation-static-41-01 FAIL在新prepared fixture的actor/system联合类型；显式actor guard后Task79 Classic types PASS。首轮scoped lint的原500行门槛失败已保留；将held-item消费者和派生crop protocol类型抽到现有职责目录，公开类型入口兼容re-export，没有豁免。

冻结整体验证：navigation-headless-41-01 为84文件552/552 PASS；navigation-stdlib-41-01 为153文件1101 PASS、同一Headless CLI文件7 FAIL，实际原因是工程宿主许可表未列navigation resource。仅补Overworld明确读/写/执行许可，未放宽其他Playbook或采纳Pack自请求权限；navigation-headless-cli-41-02 原7例全部PASS。复用153文件有效结果，没有称修复后的整套stdlib已重新执行。

navigation-static-41-02 的format、sealed5/5、paths、全lint、产品types和Svelte0/0通过，随后新Authority夹具对可空slot读取itemId的类型错误FAIL。改为显式可空读取后navigation-static-completion-41-03：受影响两文件lint、全types、规则66/66、CI选择器14/14 PASS；navigation-authority-41-03 为2/2 PASS。新修改仅工程许可表与fixture，未改变已通过552例所测生产模块。本组采用有效静态结果加有界完成复验，保留两次失败日志。实际源码风险检查覆盖注册候选/owner再次校验、公开类型兼容、宿主明确许可、accepted HUD与正常输入runner；这不是整PR正式审阅或产品通过声明。

全部私有日志在Root/fixtures recovery run目录，未改sealed evidence。06:55实际周UI剩88%，不能将同期账户下降都归因PR；60%停止。长期docs仅更新真实owner/consumer/runner职责，不重复复制历史证据。完整V2/V3/V4/194、Survival农业、C5实际恢复、真实Modular玩法和组合整帧A/A/A/B仍未完成，当前不可合入。
