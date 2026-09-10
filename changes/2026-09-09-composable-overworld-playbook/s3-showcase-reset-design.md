# 木剑体验场重置与稳定身份

状态：Implementing；T14 已批准回归修复，未准出 S6。

Browser 回归真实 RED 已两次复现。第二次 trace 捕获 `Entity id was already issued or retired: showcase-dummy-left`：重置先销毁四个固定目标，再尝试复用旧 EntityId，违反 S2 稳定身份合同。UI 尚可看到上一批目标的瞬间不能证明重置完成，随后长按攻击实际没有训练目标。

体验场每次布置分配新的实例 nonce，四个目标保留明确的场景角色前缀并带 nonce。该身份只用于开发体验场命令，基础 seed/generatorVersion 与正常游戏实体分配不变。清理只接受四个历史固定 ID 或四种角色前缀加规范 UUID 的本场景 ID；不清理任意同前缀字符串。重复点击复用当前布置 Promise，避免两个异步布置交叉。布置失败沿已有交互反馈路径报告，再向启动调用者返回失败。

验证：固定 nonce 的命令工厂纯测试；实际 GameServer 连续布置/销毁后另一 nonce 的命令可执行，旧引用不复活；Browser 重置等待旧 ID 消失及四个新 ID 出现，捕获 pageerror，然后按真实左键检查两段伤害、目标死亡、HUD 与声音。失败日志保留，不增加超时掩盖错误。
