# Classic 船与水面转向证据 920–990

本组绑定 head `4a9b47c9437ac395fc91b366c09a127550a6b5ff` 的未提交源码，逐文件身份见 freeze988，生产构建与浏览器身份见 delivery-validation。不能当作提交后精确 SHA 的 CI 结果。

正式 boat use 接入现有通用 Transport Authority；新增明确 fluid-surface 政策，保留水桶 fluid-source 的容器与水源限制。水面转向使用实际 yaw 区间的保守包围体，保留未知/非水支撑、碰撞和安全下车检查。

990 从统一 classic-runtime 入口、已校验 production build 运行，零重试；真实键鼠完成部署、前进、转向、倒退、返岸和下船落地。原起步石台会阻挡惯性前进后的转向，所以先用原生 S 驶离，不改变地图、角色、质量、断言或 120 秒总预算。原始失败 979/980/985 完整保留：979/980 远离岸边无安全落脚点；985 转向位于起步石台附近。

978 完整 Classic headless：164 文件、1289 项通过。生产代码此后未变，只增加浏览器验收与文档。974 完整 stdlib：1311 通过、3 项超时失败；976 采用 CI 单 worker 隔离同两文件，11 项通过，仅证明这些文件，不改超时、不声称完整 stdlib 通过。950 的 18 个轨道夹具选择失败及修复后 955 的 51 项通过均保留。969/970 为小角转向支撑和碰撞的 RED，972 为 74 项定向 GREEN。

生产 predecessor 捕获来自构建 897 的真实 Pack 锁与逐资源校验；b9→4a9 的 packages/playbooks 无差异。只验证非空矿车 gameplay 状态恢复与篡改拒绝，不证明完整旧 portable world 导入。922 合成 a/b/c identity 已撤回，不进入生产 allowlist；旧 VehicleRuntimeV1 非空状态仍明确拒绝。

原始两帧截图显示船模型，但部署初期水面/地形存在黑色区域，后续帧恢复。未确认其根因或完整灯光正确性。当前远端 CI441 Chromium 和主旅程899 仍 FAIL，PR 不能据此宣布可合入；音频、完整旧存档导入及其他需求仍开放。没有性能结论。

JSON 与本文在封存前格式化；日志和 PNG 保留原字节。manifest 记录所有负证据及正证据的 SHA256，封存后不得改写。
