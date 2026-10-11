# Local303 C4 Authority 诊断终态

source120c6ff5，主旅程使用明确30分钟诊断窗口，原真实输入、C4 90秒及玩法断言保持不变。61段V2返回，C4 outbound 90.694秒后抛错，70个真实输入脉冲，最终x194.129、目标208.5；返回及C5未到达。不能记作canonical PASS。

C4入口真实Authority CPU采样完整：20.066秒、1722样本、精确page/context/worker及asset SHA校验通过，产物后验通过。采样定位重复实体投影用于actor getter生命周期解析；仅作为310候选依据，不表示CPU利用率、因果根因或优化后产品通过。原样完整profile私有保留，摘要与哈希见result.json。
