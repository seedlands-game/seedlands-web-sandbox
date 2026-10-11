# Actor lifetime resolver 310

共用原有 epoch、indexed entity 及 lifetime 校验，actor facet 直接获取 eid；公开 resolveReference 保留复制投影。持有旧 actor/inventory 句柄销毁及恢复时仍拒绝，公开投影仍隔离。

预约窗口先做12对 A/A，再做20对交错 A/B，96 actor、每轮100遍相同5 getter，校验和一致。读取中位15.79ms → 3.57ms，配对 B/A 中位0.2258；A/A 相对差中位0.0566，满足预注册门槛。该结论仅为 owner 读取，不能替代真实输入或产品验收。原样样本见 aa.json 与 ab.json。

完整 stdlib 1276 PASS / 1 FAIL：未改动 vegetation 的原5秒超时；隔离相关3文件12例 PASS，保留首轮失败。类型、lint及其余状态见 validation.json。当前尚未有此候选的浏览器通过或精确 SHA CI。

315 将计数移出计时：12对A/A相对差中位14.08%；20对交错A/B耗时中位16.375ms → 3.963ms，配对B/A中位0.24265，满足至少20%且超过3倍A/A噪声的门槛。结果全部一致；计时外投影计数57600→0。310 的计数wrapper可能增加旧实现成本，保留原数据但不单独用于采用。315预约收据已私有保存，子进程要求独占窗口标记。

串行完整 stdlib 172文件1277例全部通过；首轮1276通过/1超时未覆盖。完整类型与lint通过。

提交前 headless 158文件1205例、Kernel28、CI选择17、完整类型/lint/格式及封存5文件逐字节检查通过。真实主旅程、新SHA CI及联合端到端对照仍待运行，PR未宣称可合入。
