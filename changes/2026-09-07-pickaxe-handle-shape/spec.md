# 石镐直柄轮廓修正

## 状态与范围

Agile，Delivered（本地验收完成，远端 CI 待读回）。用户指出石镐柄下段突然变粗；仅调整石镐像素轮廓，保留镐头、握持点、厚度、木斧、动作和游戏规则。不更改历史交付证据。

## Behaviour 与测试设计

- Given 石镐像素定义，When 从镐头下的裸露柄扫描至末端，Then 柄保持同一横向边界，末端不形成加宽尾块。
- 当前 RED：柄上端列 6–7，行 8–14 扩到列 6–9，因此下段有明显台阶。
- 修改目标：裸露柄列 6–7，保留明暗木柄配色，末端同宽封口；镐头不改。
- 这是低风险资产轮廓修改，不新增镜像实现的单元测试。实施前后运行同一只读轮廓测量，保存 RED/GREEN；运行已有网格测试和浏览器观察。
- Playwright 当前需求证据：生产入口给石镐、选择快捷栏、读回实际网格、手持及世界掉落截图。输入路径与资产共享有断言；图像通过人工式目视检查补充，不宣称人类已验收。

## Acceptance

- [x] RED/GREEN 轮廓测量。
- [x] 定向网格测试、`pnpm verify:static`、`pnpm build`。
- [x] 浏览器手持/掉落新截图与实际 mesh 一致性。
- [ ] 明确分支语义提交和 PR 最新 HEAD 的必要 CI。

## Delivery Snapshot

证据：`evidence/shape.json` 保存 RED/GREEN；定向网格 2 tests passed；`pnpm verify:static` 和 `pnpm build` passed；当前 change Playwright 1 test passed（5.5s），实际手持与掉落共用同一 GPU mesh，pageerror 为空；`evidence/manifest.json` 对应本次源文件与原始 PNG。目视可见直柄，无扩大末端；未声称人类手工验收。构建保留既有大 chunk 警告。

长期 docs baseline 不更新：只涉及石镐资产局部形状，资产工坊另有 Proposed 合同。
