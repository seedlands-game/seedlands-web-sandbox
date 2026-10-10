# 主线程 CPU 诊断 checkpoint85

精确 source `2b17241b64dfba61147444d9187881cddc32e942` / artifact `efd549f30cc12570084c5742f33bbe9de2b3e522582dafe114a68600ffd5a580`，run `pr41-main-cpu-diagnostic-browser85-02`。原 main、所有内部步骤与断言、900000ms、质量和原生输入不变，唯一诊断轴为现有 10000us CDP Profiler。

终态 main FAIL（原总时限），C0–C3 有 PASS 记录；C4/C5 未取得通过证据。诊断不替代完整产品或 A/A、A/B，`diagnosticOnly=true / eligible=false`。

71608 samples 的 timeDeltas 加权跨度 899598.035ms：idle 458705.073ms（51.0%）、program 218305.491ms（24.3%）、GC 16802.596ms（1.9%）。Authority onmessage 包含链 89003.611ms（9.9%）；各 inclusive 行相互重叠，不可相加。两个 JSON.stringify 比较函数 lu/hy 的单节点 self 分别 13392.788/8222.143ms，不能把它们宣称为主要整帧缺口。idle/program 不证明 GPU 或宿主根因。

私有原始 profile：`/workspace/pr41-recovery-20261008-root-01/browser85-profile-extracted-03/classic-main-thread-cpu-profile.json`，1539334 bytes，SHA256 `822f254fb49507f459f1f317fa42dfa10cae27d15385ed1346dad378808d19e5`；HTML/trace 在 `browser85-cpu-02/`。第一次解码因报告重复 attachment 描述失败；第二次完整描述去重仍失败；第三次明确区分 1 个可读取 body 和 1 个只有 name/contentType 的引用，唯一原始 payload 身份校验通过。旧失败 log 不覆盖。

下一诊断只检验观察成本，不先改生产。旧 61 原生 trace 的 ReadPixels 与当前 CPU 空档仅为选择实验的线索，旧结果不是当前 source 的对照。候选 82 仍未采用/推送，PR 主旅程与组合/整帧准入仍失败。长期 docs baseline 不变：本片无生产或测试口径变更。
