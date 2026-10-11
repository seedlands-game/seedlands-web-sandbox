# Authority CPU阶段诊断300

已有Authority CPU profile增加可选C4阶段。默认仍六分钟延迟/20秒采样/10ms采样间隔；显式C4在beforeEach只登记，原C4入口才启动。source/run/asset、page/context与唯一精确worker选择保持，未知值/冲突/身份改变拒绝。未激活NOT_STARTED，初始化失败FAILED与原错误，不虚构profile；并发激活只分配一次CDP。

RED9失败/13通过，最终相关4文件62通过，既有owner23例（新增13例），复用原行为/类型选择。Classic类型、相关lint与CI选择17通过；最终相关格式与冻结5/5通过。新真实调用栈尚未采集，详见validation.json；诊断始终不可作为正式PASS，当前产品问题仍未闭合。
