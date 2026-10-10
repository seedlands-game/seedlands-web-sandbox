# 原生释放消费边界128与CI415终态

较早 idle command 的 ACK 和零速度可能在本次原生 keyup 尚未消费时成立。实际 Controller/InputCommandBuffer 的 RED 复现这一消费者缺口；不声称它已经解释 CI415 的 V2 超时。

Controller 只读投影最后真实 keyup command 的 epoch/code/sequence/neutral，返回复制值，换 epoch 清除可见性；不造输入、不改变 Authority。唯一路线消费者必须看到本次新 neutral release、对应 ACK 和原静止/地面/双投影条件。时限、脉冲、容差和输入次数保持。路线测试里的 metadata 是显式合成协议观测，物理模型仅在 modeled keyboard.up 更新；这些不充当真实浏览器证据。原 visual finally 的 JSON 同时进入非 benchmark Node 日志，查询、点击、原断言和附件保持。

范围测试10files75PASS，最终Controller17PASS，Harness2files14PASS，CI选择17PASS，生产Web/Classic类型与范围lint PASS。实际 epoch、读取复制隔离、非neutral、旧release、缺观测及 ACK 未消费反例均覆盖。128提交冻结时 build/browser 尚未运行；后续回执单独增补。Root逐文件复核输入、snapshot、route与诊断边界，本片未委派独立审阅。

CI415精确308d：五非Browser SUCCESS、Chromium FAIL、部署SKIP；V1两轮PASS，V2两轮FAIL/C4未运行，原visual单击FAIL/冷阶段未运行，普通native PASS、Modular SKIP。raw日志身份与检查输出摘要见validation.json。此前125在7aaf identified build及独立review通过，冷Sky浏览器仍未证明。完整PR不可合入。

长期docs/code-map.md补充派生观察职责与消费边界，无产品基线或验收阈值修改。真实预算最新仍14:25UTC周剩75%，新的UI读数待主对话；停止线约60%，没有估算额度百分比。未合并、未开自动合并、未生产部署或新增权限。
