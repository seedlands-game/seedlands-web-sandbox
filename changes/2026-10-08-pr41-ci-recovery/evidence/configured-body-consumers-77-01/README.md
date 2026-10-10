# 已配置载具 body 消费者修复（checkpoint77）

真实 native76-05 在普通右键部署后报 `Entity has no registered body: transport:undefined`。Logic 请求有效 RED 和两条原预加载代码故障反例复现同一错误；七文件33例及 stdlib 三文件22例定向 GREEN。Logic v2 保留载具当前 definition/yaw AABB，不赋予 Actor 导航控制；Authority 同一 resolver 供 Browser/Headless preload，导航不再静默漏载具，诊断投影读取权威边界。

全 stdlib 为1196通过/1条原15秒CLI超时；完整Headless为793通过/2条原5秒超时。失败用例分别隔离通过（CLI1例、Headless6例），原时限和断言保留。隔离通过不能把整批失败改写为通过；未证明超时根因或稳定性。完整回归的raw logs与故障反例在 `/workspace/pr41-recovery-20261008-root-01/*77*.log`，只保存本轮新输出，历史 sealed evidence 未修改。

附 JSON 绑定此轮候选源码字节与既有父提交；最后提交/新生产 artifact 的 native 验收尚待执行，不能据此认定整个Classic、照明、运输、性能或PR可合入。长期代码地图仅更新上述真实公共投影合同。

测试文件搬移后，两文件10例再次PASS；七文件33例属于搬移前候选，JSON同时保留两组输入字节身份。全仓lint已PASS，原最终类型清单及源码类型PASS；新增显式清单的最后复核另记结果。测试迁移不把整批超时改绿。
