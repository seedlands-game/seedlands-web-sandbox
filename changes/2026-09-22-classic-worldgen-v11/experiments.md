# v11 worldgen A/B 实验合同

状态：Pre-registered，尚未读取候选 B 结果。

## Seed corpus

固定 24 个 seed，包含用户实际路径、历史基准和无语义随机样本：

`mosslight-68`、`living-world-autonomy`、`seedlands-shell-journey`、`seedlands-regression`、`seedlands-mvp-river`、`seedlands-mvp-highland`、`classic-visual-v3`、`phase1-final-creative`、`oak-camp`、`riverbank-01`、`forest-path-02`、`plains-home-03`、`wetland-04`、`dry-start-05`、`cold-start-06`、`mountain-pass-07`、`ember-11`、`quartz-12`、`cedar-13`、`willow-14`、`copper-15`、`maple-16`、`birch-17`、`spruce-18`。

不按结果增删 seed。若某 biome 未覆盖，只能在运行前根据 v10 `macroAt(seed, 0, 0)` 的静态分类追加一个明确 seed，并同时保留原 24 个。

## 候选与唯一轴

- A：当前 generatorVersion 10。
- B1：v11 树源/树形变化，植被阈值和出生算法保持 A。
- B2：在已接受 B1 上只改变自然植被阈值。
- B3：在已接受 B1+B2 上只改变出生候选评分。
- 组合 B：最终 v11。

分项逐个接受，避免把树形、密度和出生评分的影响混为一个技术名词。

## 样本与指标

每个 seed 对 v10/v11：

1. 在固定出生候选或原点周围半径 8 与 16 读取地表上方体素。
2. `treeTrunksR8`：半径 8 内 Wood 列数。
3. `leafCanopyR8`：玩家眼高附近上半球采样中 Leaves 比例。
4. `vegetationR8`：半径 8 内 TallGrass/Flower/Mushroom/SugarCane/Cactus 数。
5. `openDirections`：8 个水平扇区中，可从候选点连续走至少 6 格、宽 1/高 2 无阻挡的扇区数。
6. `nearestTrunk`：候选点到最近树干的水平距离。
7. `safe`：脚下合法地面、身体空间为空、非水。
8. 生成 chunk SHA-256 与重复运行一致性。

唯一主指标：24 seeds 中 `openDirections >= 1` 的比例。

## 判定式

- B1：主指标不得回退；forest seed 的 `leafCanopyR8` 中位数至少下降 20%，且 `nearestTrunk` 中位数不下降。
- B2：主指标不得回退；forest/plains 的 `vegetationR8` 中位数下降 25%–55%；dry/wet/cold/mountain 标志性装饰不得减少超过 10%。
- B3：`safe` 必须 100%；主指标比 A 至少提高 25 个百分点或达到 90%，取较低门槛；固定重复运行完全一致。
- 组合 B：所有单项门槛同时满足；任一 v2–v10 byte hash 改变即否决。

## A/A 与执行顺序

这些是确定性计数，不以耗时为主指标；先对 A 重复两次并打乱 seed 遍历顺序，要求全部指标和 hash 完全一致。随后按 seed 做 A/B 交错输出，保留 JSON 原始记录与 summary。若出现非确定，停止所有候选采用，不调门槛。

## 否决与恢复

- v2–v10 bytes、存档选择或旧玩家位置变化。
- v11 同 seed/坐标因加载顺序或 Worker 路径不同而变化。
- 出生搜索写世界、落水、卡树/低顶或无稳定 tie-break。
- 任一 biome 标志性结构明显消失，或树林退化为空地。

否决时删除未采用生产分支，保留实验脚本、原始数据和结论。
