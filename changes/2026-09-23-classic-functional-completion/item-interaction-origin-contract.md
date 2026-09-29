# Item Interaction 可信视线原点合同

状态：`V1-ITEM-INTERACTION-ORIGIN-01` 实施合同。只修复公共 voxel item interaction 的服务端距离与双 LOS 原点，不修改 Structure、Media、fluid handler、协议或 Browser 输入。

## 行为

1. voxel interaction 的距离、hit LOS 与 adjacent LOS 统一使用服务端权威 actor body position 推导的 `playerInteractionOrigin(position)`，即 `[x, y + 1.6, z]`。
2. 客户端仍不提交 camera、yaw、itemId、operationId 或 interaction origin；服务端继续从权威 actor/selection 推导。
3. 最大距离仍为 5；hit/adjacent 必须曼哈顿距离恰好 1；hit 与 adjacent 两条 LOS 都必须独立通过。
4. stale selection、unknown Chunk、out-of-range、hit/adjacent 墙阻挡与 operation 授权失败继续 fail closed，handler 未调用且世界/库存不写入。
5. entity/self 分支不在本阶段改变。fluid handler 保持 target occupied、not source、inventory full、world stale/unchanged 与原子提交语义。
6. registered fluid host 在 prepare 与最终 validate 阶段重算同一可信 origin，并复核 hit/adjacent 都在半径 5 内；直接 operation 不能绕过该范围门禁。

## RED / GREEN

- RED 使用 Browser-03 的权威坐标：actor `[65.95881945378738,32.600001,2.4981569866156805]`、hit `[68,30,2]`、adjacent `[68,31,2]`、floor `y=30`。旧 feet-origin LOS 穿过 `[67,30,2]` 并错误返回 `blocked`。
- GREEN 要求公共 dispatcher 命中已注册 operation；Classic 正式 Authority/registered fluid route 使 adjacent 成为 Water source，并保持 creative inventory 不变。
- host 直接 operation RED/GREEN 使用 actor `[0.5,0,0.5]`：hit/adjacent `[4,3,0]/[4,4,0]` 对 eye 均在 5 内但 feet 到 hit 大于 5，应成功；`[5,3,0]/[5,4,0]` 对 eye 超出 5，应在 canonical/ECS/receipt 写入前拒绝。
- 同组负例继续覆盖正交邻接、未知 Chunk、可信 eye-origin 半径大于 5、hit/adjacent 墙阻挡和 stale selection；被拒绝路径不得调用 handler。

## 非目标

- 不移动 scenario 坐标，不放宽 LOS/距离，不删除 adjacent LOS，不增加客户端视角字段。
- 不修改 Structure/Media/Browser/协议、fluid 算法或其他 gameplay domain。
