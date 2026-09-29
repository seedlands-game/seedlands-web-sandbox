# V1 Fluid Source Browser Target 合同

状态：`V1-FLUID-TARGET-WEB-01` 实施合同。只扩展 Browser 的只读目标选择，不改变 Authority 授权、协议、Pack、存档或 canonical scenario。

## 行为

1. `traceVoxelTarget` 的 predicate 接收 `(voxel, x, y, z)`；现有只接收 `voxel` 的调用仍兼容。射线仍按 Amanatides-Woo 顺序遍历实际 cell，不跳过首个 predicate 命中的阻挡。
2. `BrowserGameplay.canTargetFluidSource()` 每次从当前 `AuthorityGameplayView` 读取 selected item：生存读当前 inventory slot，创造读当前 creative hotbar slot；只在当前 `items` 中该 item声明 `{ type: 'fluid-container', fluid: 'empty' }` 时返回 true。不得硬编码 bucket ID，不缓存旧 selection、item registry 或 epoch。
3. `game-player-controller` 把该 getter作为必填 binding注入 `PlayerController`。`PlayerController` 的目标 predicate 为：
   - 当前 Authority voxel semantics声明 `targetable=true`；或
   - getter当前为 true，且该 voxel有已注册 semantics，并且当前 World `getFluidCell(x,y,z)` 精确为 `{ source: true, level: 8 }`。
4. filled container、普通物品、flowing fluid、未注册 voxel和unknown cell均不能启用 fluid source targeting；前方已注册 targetable墙体必须先命中，不能穿墙选水。
5. 该 hint只影响 Browser ray target。客户端不提交 policy，Authority仍必须根据已注册 interaction binding的 `voxelHitPolicy: 'fluid-source'` 独立重查来源、LOS、选择和 freshness。

## RED / 验收

- ray test证明 predicate收到真实 cell坐标并命中source cell，不只测试一个独立布尔函数。
- Browser selection test覆盖 survival/creative、empty/filled、selected变化、items/epoch替换即时生效。
- Player controller test覆盖默认/filled/flowing/source/wall/unknown，并使用 camera eye位置而非 player body位置。
- 定向 Web tests、Web/root-test types、ESLint、Prettier、diff check通过；不运行 build、browser、Cua或CI。
