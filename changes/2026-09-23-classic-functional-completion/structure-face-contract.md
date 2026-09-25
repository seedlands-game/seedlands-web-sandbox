# V1 Structure 命中面可见性合同

状态：实现与定向服务端验收已获 root 准出，交 `GIT-14-STRUCTURE-FACE` 合并。

## 问题与证据身份

- Browser-06 source 为 `5d52330fa58d315e9e10b1298e1bdc65e2321898`，artifact digest 为 `a91a3528abc9b8154f16e48fd0bf41be8c834bb3226e389fbb7550245b5a1f02`；正式 diagnosis SHA-256 为 `4fef2ba0d25395c44a04e195c662f64f96e5136eacf3dd1e10e5edf4a944d0e2`。
- Browser-06 已通过 C0-C3、water place/pick、正式 UI 切生存、落地、走到门与 Classic visual；木门真实右键命中 `hit=[70,30,0]`、`adjacent=[70,31,0]` 后，Authority 返回 `blocked`，world revision 保持 `141`。门两格、媒体与 save 尚未触达。
- Harness `serverPlayerPosition` 的实现为 `[authorityPlayer.x, authorityPlayer.y + PLAYER_FEET_OFFSET, authorityPlayer.z]`，所以证据值 `[67.35381531679855,32.600001,0.6452957045056721]` 是 eye；正式 Authority fixture 使用真实 body `[67.35381531679855,31.000001,0.6452957045056721]`。不得把该 eye 再加 `1.6`。
- 当前 Structure dispatcher 对 hit center 做 LOS；registered Structure host 的初次 prepare 与最终 validate 也对 hit center 做 LOS。Browser-06 的 floor Stone `[69,30,0]` 因此遮挡 `[70.5,30.5,0.5]`，但合法共享面点与 adjacent center 均可见。两层必须同步修复。

## 冻结实现

1. 在内部 `gameplay-geometry.ts` 提供共享 helper：输入已经通过曼哈顿正交校验的整数 `hit/adjacent`，返回 `hit center + (adjacent-hit) * (0.5 + 1e-6)`。该 helper 不是 package/mod-api 公共 API。
2. Structure dispatcher 继续先校验 actor、selection freshness、voxel target、曼哈顿正交与 hit/adjacent center 各自半径 5；resolve/fallback/ownCells 顺序保持。仅把 hit LOS endpoint 从 hit center 改为共享面向 adjacent 内偏点；adjacent center LOS 不变。
3. registered Structure host 的 `assertReachable` 保持可信 body 派生 eye origin、hit/adjacent center 各自半径 5、当前 semantics、ownCells 忽略及 unknown/solid fail closed；仅把 hit LOS endpoint改为同一共享面 helper，adjacent center LOS 不变。初次 prepare 与最终 validate 继续调用同一校验。
4. item interaction 已有等价局部函数可改用同一内部 helper，必须是行为等价提取；不得改变 fluid policy、manifest、协议、全局 `traceVoxelRay` 或 Classic 内容判断。
5. 保留 registration/targetable、authorization、support/occupancy、两格原子提交、inventory、receipt/fact、stale actor/world/candidate 与最终事务重验。不得增加 door/Classic/Water/Lava 特判。

## 测试设计与验收

### RED

- 正式 Authority：使用 Browser-06 真实 body、hit/adjacent/upper 与 floor Stone，选择真实 `wooden-door` 后执行 `performAction(interact)`；旧 dispatcher 必须返回 `blocked`，门两格保持 Air、inventory/revisions/commitSequence 不变、response commits 为空。
- 直接 registered host：使用非 Classic fixture、同构合法共享面几何与额外 floor blocker，直接调用 registered Structure operation；旧 host 必须返回 `blocked`，证明即使绕过 dispatcher 也需要同样修复，并验证 world/gameplay/inventory/receipt/fact/participant 均零写。

### GREEN

- 同一 Browser-06 Authority fixture 原子放置门的 lower `[70,31,0]` 与 upper `[70,32,0]`，inventory、response commits、world/gameplay revision 与 commitSequence 按现有双 owner 合同精确断言。
- shared helper 覆盖六个正负轴正交面，返回共享面向 adjacent 内偏 `1e-6`；非正交输入不由 helper 放宽，仍在调用层拒绝。
- dispatcher 与 direct host 保留现有 Structure 上/下 half、ownCells、rotation/support/occupied、stale/final validate、unknown、range、non-orthogonal、wall/backface 负例；失败在相应层证明零 invoke 或零写。
- 运行现有 fluid security `26` 与相关 Classic fluid composition 回归，证明 helper 等价提取未改变 fluid policy/行为。

## 非目标

不修改 Web targeting、Browser fixture/scenario/坐标/地形/timeout、global ray、Structure/Media 外领域、transport、Lighting、Kernel、存档、协议、build、浏览器或 CI。本阶段只证明服务端两层 Structure reachability；真正门、Media、save 的产品 GREEN 留给新 artifact 上的唯一 Browser-07。
