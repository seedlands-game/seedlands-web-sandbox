# S4 方块与矿石生成合同

状态：Implementing；细化已批准木石铁成长与工位实体的产品方块。

保留数值 0–10；新增 Workbench=11、Chest=12、Furnace=13、CoalOre=14、IronOre=15。新增均为普通完整立方体，分别有可辨识的第一方像素纹理；旧材质编号不变，新增五种 FaceMaterial 顺序为 14–18。保持 WebGL2 与现有 atlas/texture-array 管线，不增加模型或外部资产依赖。

新世界 generatorVersion=4；已存世界版本 2、3 的 baseVoxel、chunk 和 halo 字节不得改变。V4 保留既有宏观地形、植被和水，只把地下原 Stone 换成 coal/iron ore；不会替换建筑编辑、canonical chunk 或邻块 overlay。矿石以 2×2×2 世界整数格分组，用 seed 和分组 x/y/z 的固定 32 位整数 hash 选择；独立盐区分煤铁，铁优先。煤在 terrainHeight-y>=4 时 hash%97<10，铁在 depth>=8 时 hash%97<6。此处矿石密度是初版玩法参数，无性能收益主张；正常生存验收再验证木石铁可达性。

唯一算法需在 core TS、浏览器 staged、Rust scalar/SIMD 的 chunk 与 procedural halo 保持字节一致；Wasm ABI 显式携带 seed、world origin 与 generatorVersion，禁止在已有编辑值上补矿或只改 TS。矿石 hash 选定后冻结算法和黄金样本，包括负坐标。版本 2/3 的完整 chunk 黄金 hash 先在旧实现采集；新增验证用实际版本 4 JS/Rust 输出与 halo revision 比较，普通功能对照不作性能采样。

RED：旧世界2/3字节保持；V4有地下煤/铁且不改地表/水/树；seed/负坐标/跨 chunk 一致；显式编辑与 overlay 保留；TS staged与实际 Wasm scalar/SIMD chunk/halo 字节相同。新增 voxel 被 mesh/material 支持，所有合法值边界仍拒绝 16 及以上，禁止简单放宽为任意 number。

产品/存档所有入口的合法 generator/voxel 检查由 root 集成；Root 保留 game-server、world-mutation、persistence、Harness 与 Block 工位生命周期写权。Rust source 返回后由 root 按 package.json 运行 artifact build/verify 并串行总门禁，worker 不写生成 wasm 或历史 evidence。
