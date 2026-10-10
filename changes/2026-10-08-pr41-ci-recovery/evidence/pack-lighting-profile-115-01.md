# Pack 光照 profile 元数据（115-01）

状态：已完成 Pack metadata/parser/loader 子片；渲染消费者和整体受光尚未验收。

## 实现

- 在 `apps/web/src/client/presentation/pack-lighting-profile.ts` 新增固定单参数 `parsePackLightingProfile(unknown)` 与 `PackLightingProfile`。校验 exact keys、plain object、无访问器属性、dense 三通道 RGB、数值边界、2–32 个严格递增 keyframe、0/24 锚点及周期闭合；解析结果冻结。未知键、缺键、非有限值、毒化原型、非 plain 对象、错误色域/长度和非法 mapper 均拒绝。
- Pack presentation schemaVersion 1 增加可选 `lighting`；旧 presentation 未提供时 catalog 的 `lighting` 为 `undefined`。loader 将 emission material id 与本 Pack 已声明 materials 校验，多个 Pack 声明 lighting 时拒绝，并继续执行现有 manifest/resource 摘要校验、资源路径和 asset 绑定检查。
- Classic profile 复用当前 8 个环境帧，背景颜色从现有 8-bit sRGB 归一化为 0..1，并显式声明线性 `skyRadiance`；block tint 为暖色，torch emission 仅引用 presentation 中已声明的 `seedlands:material/terrain/torch`；tone mapper `linear`、exposure `1`。
- modular-world fixture 使用独立冷色循环、不同 skyRadiance、block tint、ACES 与 exposure `1.15`；self emission 为空。没有根据 Pack ID 推断 Classic。

## 验证

- 定向 Vitest：`pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/client/pack-lighting-profile.test.ts apps/web/tests/unit/client/pack-presentation-loader.test.ts`，2 个文件、18 个测试 PASS。覆盖 profile 正反例、旧 metadata 兼容、合法声明材料 emission、lighting 多 owner 冲突，以及既有资源加载/摘要合同。
- targeted ESLint、Prettier check、`git diff --check` PASS；loader 测试文件 500 行。
- 原始 Vitest 输出：`/workspace/pr41-profile-115-luna-01/vitest-pack-lighting-profile-final.log`。
- 未运行 build、浏览器、全量测试或 WebGL2 产品验收。Root 已取得旧 shader GPU probe RED；本子片不宣称统一受光、渲染正确或 PR 可合入。

模型实际会话元数据未核实。当前剩余周额度按协调方 11:00 UTC 读数为 76%；此子片未估算额度百分比。
