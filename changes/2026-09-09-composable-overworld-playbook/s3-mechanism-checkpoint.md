# S3 授权、规则与时钟接线检查点

本切片基于产品接线提交 7a474da217071621930f9745ae3a700050fcddb3。S3 保持 Implementing，不能据此标记 S4–S6 完成。

已完成：明确 actor/system 执行种类及生命周期失效；稳定主体的持久来源合同；before/effective input/after 规则；独立只读 world Ruleset；实际 GameplayRuntime 的组合时钟和 V4 schedule frontier；恢复不重复 start；保存前有界排空队列并拒绝未完成 frontier。旧未组合宿主仍保持既有路径，默认 needs/combat 尚未注册迁移。物品食用逻辑归入既有库存模块，保留原行为并满足源码行数门禁。

验证（顺序执行）：

- pnpm verify:static：275 test files passed / 2 skipped；1380 tests passed / 4 skipped；覆盖率门槛通过，Svelte 0 errors / 0 warnings，core/Web/test/tools 类型检查通过。
- pnpm build：Pack 产物、Rust 指纹、SSG、类型和 Vite 构建通过；原有 PlayCanvas 大 chunk 提示仍保留，不作性能收益声明。
- pnpm test:composable-gameplay：4/4 passed（19.6 秒）。真实目录、键盘与飞行、安全切换、新世界模式、Worker Pack 与检查点往返、篡改 ESM 拒绝均通过。
- Browser console 唯一记录仍为 favicon.ico 404，与前一检查点相同；没有将其当作 Pack 或 Worker 失败。

失败与修复：首次 static 因 GameplayRuntime 超过 500 行拒绝，食用逻辑移至既有 owner；随后三个创造方块测试因 fixture 缺少新增 Ruleset read 授权失败。按真实模式读取规则的合同补 fixture，未降低生产授权、断言或门槛。最后全量 static 重新通过，再运行 build 和 Browser。

本地日志仅为本机证据定位（local-only）：`/tmp/seedlands-s3-mechanism-static.log`、`/tmp/seedlands-s3-mechanism-static-fixture-red.log`、`/tmp/seedlands-s3-mechanism-build.log`、`/tmp/seedlands-s3-mechanism-browser.log`。之前产品截图和视觉结论仍见 s3-product-checkpoint；此轮没有新增视觉设计。

长期 docs baseline：代码地图已补持久来源、Ruleset owner 与模块 schedule 的职责；产品定位和可组合架构不变，因为此切片执行既有获批责任划分。

仍缺：持久来源接入 Combat 当前/缓冲动作及实际宿主 subject policy；默认 needs/damage/place 注册规则；ECS/动作/掉落/WorldEditBatch 的统一预校验和无失败 apply；S4 实际工位与木石铁成长；S5 替代 provider/跨宿主；S6 完整生存旅程、独立冻结 diff 审阅和 PR/CI 准出。
