# 颜色path候选拒绝152

local9c99d904，test-only新身份/verify通过，生产bytes同150。原visual一次FAIL71170ms；相同构造上下文仍105项16px RGBA不同，32px全相同。同source A/A只有paper@16为72channel不同，其余259case为0；该异常不能消除剩余104项AA为0的候选差异。拒绝149生产path分支，未push，原main151未启动，不调整RGBA容差或任何原visual/玩法断言。

远端f01 CI422自然FAIL，五非Browser成功，main C4首次900sec/第二轮208.5,.5原45sec失败，visual1.3min/native29.5sec通过，preview跳过，C5未完成。不同运行进度不作性能A/B。完整raw/hash见validation，冷存档sky阶段在本地visual未到达。
