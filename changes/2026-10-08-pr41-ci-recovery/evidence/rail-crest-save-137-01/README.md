# 坡顶连接与旧非空 V4 存档137

四方向坡顶上层平轨原先被正式 loaded-cell deployment 判为 ambiguous。只给既有 EW/NS 平轨增加四个准确 placement pattern，保持三向 junction 和未知邻居拒绝。四个真实配置反例 RED → GREEN；双低邻居两例原本通过。

新规则改变定义身份。变更前从 a1a9ed3b 正式 Authority 捕获了已部署、已骑乘、正在移动的十形状旧 V4 状态，composition 精确等于 b705f370 的实际 Browser135-02 Pack 身份。该 fixture 是 headless capture；单独加入只接受 V4 的精确 predecessor，保留先前 straight-only 来源。恢复保留 pose、velocity、cursor、库存、rider、lifetime 与 module clock，epoch 正常递增；未知摘要、定义或系统篡改继续拒绝。

定向 Web 三实际文件55 PASS，另两正式 transport Authority 文件16 PASS，Pack/Classic/root test types、lint 通过。完整原 Classic headless 结果另记在 validation；stdlib生产逻辑未变，此次未重跑完整stdlib。未运行137 identified build、Browser、性能验收。初轮测试误用 option.pose、两个不存在的文件 pattern、错误 type config 路径、TS literal 的 JSON 解码错误均保留原输出，正确修正后验证，不计为产品失败或未运行文件通过。

136的四个受 Stone 支撑坡道仍失败。原 sweep 的实际首 contact 是上层东向轨道下的 `voxel:3,31,2:0`，法线 `[-1,0,0]`，不是 unknown 或仅查询候选。观察时 HEAD 为 a1a9ed3b，工作树已有137规则，motion/collision 未改；来源修正 sidecar 与原 raw 私有保留。未忽略 Stone、缩小车体或修改行驶断言；新 RED Owner 测试尚未交付为通过。

本轮只交付有限的连接与存档修复。Classic 主旅程、连续坡道碰撞、实际轨道 mesh、完整运输/照明/玩法矩阵仍开放，PR 不可合入。实际预算17:54 UTC周剩余74%，共享账户，约60%停止线；长期 baseline 未改。

原日志、fixture出处、观察与来源 sidecar 的大小和 SHA-256 见 [validation.json](validation.json)。私有日志路径供本云环境恢复，公开记录不将不可访问的原数据替换成伪造结果。
