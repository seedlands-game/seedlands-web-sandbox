# V1 流体来源目标服务端合同

状态：实现与定向验收已获 root 准出，交 `GIT-12-FLUID-TARGET` 合并

## 问题

Browser-04 实际在首次 water-bucket 放水时仍被 Authority 以 `blocked` 拒绝，空桶取水未触达；该次
浏览器回执暴露 solid hit center LOS 与有效暴露面不一致。随后使用 Browser-04 真实 body 坐标的
Authority 集成夹具证明共享面修复后放水可达，并在中间实现阶段暴露 non-targetable Water source 的
`invalid-target`。Water 的通用 voxel semantics 按设计为 non-targetable；把 Water 全局改为 targetable
会改变挖掘、普通交互和其他 Playbook 语义，因此本阶段只增加由已注册 item interaction 声明的
additive source policy。

## 冻结接口与所有权

- `ItemInteractionDefinition.voxelHitPolicy?: 'fluid-source'` 是 stdlib 的可选、只读定义字段；不进入
  Authority action、Worker wire 或客户端输入。
- 缺省策略仍要求 hit voxel 已由当前 composition 注册且 `targetable=true`。
- `fluid-source` 仍要求 hit voxel 已注册；在此基础上允许 `targetable=true`，或 Authority
  `getFluidCell(hit)` 返回 `{source:true, level:8}`。
- 该策略只允许 `trigger='voxel'`，且 definitions-ready 时 selector item 必须有
  `fluid-container/empty` capability；否则装配 fail closed。
- Classic 只给空桶 binding 声明 `fluid-source`；water-bucket 与 lava-bucket 保持缺省策略。
- Authority 注入当前 loaded voxel、当前 composition voxel semantics 与当前 fluid cell。任一 hit/adjacent
  未加载先返回 `chunk-unavailable`；不把 unknown 当 Air 或可交互。

## 校验顺序

1. actor、selection freshness 与服务端 binding 解析；
2. hit/adjacent 曼哈顿正交与各自 center 半径 5；
3. hit/adjacent loaded；
4. hit voxel 存在当前 composition semantics；
5. 缺省 targetable 或已注册 `fluid-source` 的 authoritative full-source 条件；
6. 从 hit center 沿 adjacent 方向移动 `0.5 + 1e-6`，对共享面中心向 adjacent 内偏 `1e-6` 的点执行
   face LOS；
7. adjacent center 独立 LOS；
8. 调用已注册 operation。

registered fluid host 在 prepare 与最终 validate 中继续从当前投影重算 Water/Lava membership、source、
level、库存和世界 frontier；dispatcher policy 不替代事务校验。

## RED / GREEN 与失败边界

- Browser RED：Browser-04 body `[65.34008376511767,31.000001,2.602567930028762]` 的首次放水被
  Authority 以 `blocked` 拒绝，取水未触达。
- 中间实现 RED：继承的阶段 checkpoint 记录共享面修复后放水可达，但空桶面对 non-targetable Water
  source 返回 `invalid-target`；没有可定位的独立原始回执，因此不称 Browser-04 实测或新造 RED。
- GREEN：使用 Browser-04 body 坐标的 Authority 集成测试中，同一路由对 Water/Lava 各完成一次放置、
  一次取回；每个动作只提交一次 world/gameplay revision，创造库存不变。
- Water 与 Lava 的 full source 均可由声明策略命中；flowing、非满 source、缺省 policy、filled-container
  错配、未注册 semantics、unknown endpoints、超距、stale、墙后与非正交目标都在 invoke/写入前拒绝。
- targetable solid 仍进入空桶 handler 并由 fluid 机制返回 `not-fluid-source`，不在 dispatcher 冒充成功。
- 客户端附加 `voxelHitPolicy` 字段继续被 action target validator 拒绝。

## 非 Classic 反例与边界

非 Classic Pack 可为自己的 empty fluid-container item 声明同一策略；未声明时仍使用默认 targetable。
不识别 `bucket`、Water/Lava storage ID 或 Classic operation ID，不修改全局 ray、Structure、Media、
Kernel、存档或网络协议。
