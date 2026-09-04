# 开源仓库基础改造与 Pages 发布

**状态：** 本地实施与验收完成（Breaking flow）

## Context & Goal

Seedlands 是一个会自行演化、遵循统一世界规律并允许玩家跨人生影响历史的剑与魔法开放世界项目；体素是物质表现和自由改造世界的交互语言，不是整个项目的产品定义。当前仓库只是一个自包含、可玩的浏览器体素沙盒，也是 Seedlands 的早期技术验证。现有公开入口仍使用工程占位名 `voxel-sandbox-foundation`，且缺少许可证、素材授权边界、贡献与安全政策、GitHub 模板、依赖治理、CI 和可验证的线上试玩版本。

完成态是：访客能准确理解当前仓库与完整 Seedlands 项目的关系；代码、素材与品牌的授权边界明确；贡献者有可执行的开发、报告和评审入口；Pull Request 自动验证质量，`main` 验证通过后自动部署可玩的 GitHub Pages 版本，且页面持续显示可追溯的 commit hash 与世界 `generatorVersion`。

## Scope & Non-goals

- 范围内：将当前仓库产品名确定为 `Seedlands Web Sandbox`、包名确定为 `seedlands-web-sandbox`，并保留 `private: true`，避免被误发布到 npm。
- 范围内：使用英文 `README.md` 作为 GitHub 国际入口，提供内容等价的 `README.zh-CN.md`；同步调整 `AGENTS.md`，只对公开社区入口文档开放本地化镜像，spec、设计评审和交付记录仍强制使用简体中文。
- 范围内：增加 Apache-2.0 代码许可证、CC BY 4.0 原创体素母图说明和独立商标政策；明确 `public/assets/voxel-atlas.webp` 的生成来源和授权范围。
- 范围内：增加贡献、安全、行为准则、CODEOWNERS、Issue/PR 模板、Dependabot 和最小权限 CI。
- 范围内：增加 Vite 仓库子路径配置，统一公共素材 URL，使 `https://seedlands-game.github.io/seedlands-web-sandbox/` 可正常加载。
- 范围内：在发布构建中注入完整 Git commit SHA，页面右下角显示 `commit <7 位短 SHA> · generator v<版本>` 水印，并保留完整 SHA 供 DOM 读取。
- 范围内：非代码治理文件通过格式检查、人工评审和后续 GitHub 真实读回验证，不为 README、许可证、模板文本编写 Vitest 断言。
- 范围外：不复制或公开仓库外的世界设计文档；不把当前实现宣称为完整 Seedlands 游戏、稳定 SDK 或通用体素引擎。
- 范围外：不修改世界生成算法、存档格式、客户端/服务端协议、素材像素或现有游戏规则。
- 范围外：本 spec 的批准不授权 `git push`、仓库转移、重命名、改为 public、启用 GitHub Pages、组织设置、分支 ruleset、GitHub 安全开关或任何其他外部写入；这些动作必须在本地验收后获得独立明确授权。
- 范围外：不注册域名、商标、社交媒体账号或 npm 包。

## Decisions

### 产品与仓库分层

- `Seedlands` 是完整游戏/IP/世界品牌。其核心是统一源质规律、自主世界、持久后果、无固定主线与有限转生。
- `Seedlands Web Sandbox` 是本仓库的独立名称。它验证确定性地形、Chunk streaming、权威世界状态、编辑、存档和浏览器 3D，但不代表完整游戏。
- GitHub 目标路径为 `seedlands-game/seedlands-web-sandbox`；预期试玩地址为 `https://seedlands-game.github.io/seedlands-web-sandbox/`，在真实部署读回前 README 不宣称已上线。
- 当前实现使用“playable browser voxel sandbox and technical foundation”表述，不使用“the Seedlands engine”或“complete Seedlands game”。

### 文档入口

- `README.md` 使用英文，以国际 GitHub 访客最短路径组织：定位与状态、能力、快速启动、操作、架构边界、Seedlands 关系、验证、限制、贡献、安全与授权。
- `README.zh-CN.md` 提供等价中文入口，两份 README 顶部互链。
- Harness、Midscene、TDD 和维护者命令集中到 `CONTRIBUTING.md`，README 只保留必要验证入口。
- README 明确列出尚未实现的完整游戏能力：源质/魔法、NPC 社会、持续历史事件、长生与转生、六界内容。

### 许可证与权利边界

- 源代码与项目文档使用 Apache License 2.0；`package.json#license` 设为 `Apache-2.0`。
- `public/assets/voxel-atlas.webp` 是本项目通过内置 Image Generation 生成并处理的原创风格资产；在项目拥有相关权利的范围内，以 CC BY 4.0 提供，归属名为 `Seedlands Project contributors`。`ASSETS.md` 必须说明生成与处理来源、文件范围和许可证链接。
- `Seedlands` 名称、未来徽标和品牌识别不因代码或素材许可证而获得商标使用许可；`TRADEMARKS.md` 说明允许进行准确的来源陈述，但不得暗示官方认可。
- 第三方依赖继续遵循各自许可证；本 change 不重许可任何第三方内容。

### 社区与安全

- `CONTRIBUTING.md` 说明环境、分支、TDD/SDD、验证命令、提交格式和单维护者时期的决策边界。
- `SECURITY.md` 只支持当前 `main`/最新版本，要求通过 GitHub Private Vulnerability Reporting 私下报告，不公开个人或公司邮箱。
- `CODE_OF_CONDUCT.md` 采用 Contributor Covenant 2.1；敏感行为问题使用仓库私密报告入口，普通内容治理可使用 GitHub 自带 abuse report。
- `.github/CODEOWNERS` 由 `@KiritoKing` 负责全部路径；独立维护者出现前不设置强制人工审批数。
- Issue forms 分离缺陷与功能建议，PR 模板要求说明范围、测试和授权影响，不收集凭据或私密日志。

### CI、Pages 与发布身份

- `.github/workflows/ci.yml` 在 Pull Request 与 `main` push 上运行 `static`、`build`、`e2e-regression` 三个稳定质量 job；对应命令分别为 `pnpm verify:static`、`pnpm build` 和 `pnpm test:e2e:regression`。
- 只有 `main` 的 push 在三个质量 job 全部通过后才可执行 `deploy`；PR 绝不部署。部署目标是 GitHub Pages `github-pages` environment，构建产物为 `dist/`。
- workflow 默认 `permissions: contents: read`；只有 `deploy` 使用 `pages: write` 和 `id-token: write`。所有 actions 固定到完整 40 位 commit SHA，注释保留版本标签。
- CI 使用 `package.json#packageManager` 锁定的 pnpm 与 `--frozen-lockfile`；Node.js 锁定到 22 系列；E2E 只安装 Chromium，不运行 benchmark 或 Midscene。
- Vite 的 `base` 由 `SEEDLANDS_BASE_PATH` 控制；本地默认 `/`，CI 使用 `/seedlands-web-sandbox/`。公共素材通过一个纯函数基于 `import.meta.env.BASE_URL` 解析，不保留会跳回域名根目录的硬编码 `/assets/...`。
- Pages 构建把 GitHub 提供的完整 `github.sha` 注入 `VITE_COMMIT_SHA`。水印的 generator 版本直接引用 `src/world/voxel.ts` 的 `GENERATOR_VERSION`，不在 workflow 或 UI 复制一份常量。
- 只当 `VITE_COMMIT_SHA` 是 7–40 位十六进制 Git SHA 时显示水印；本地开发未注入 SHA 时不伪造发布身份。可见文本使用 7 位短 SHA，`data-commit` 保留完整 SHA。
- Dependabot 每周检查 `npm` 与 `github-actions`，按生态分组，避免为每个非安全小版本制造独立 PR。

## Behaviour

- Given 访客首次打开仓库, When 阅读任一语言 README, Then 能在首屏附近理解这是可玩的 Web 体素沙盒和 Seedlands 技术原型，而不是完整游戏或整个项目的引擎定义。
- Given 访客希望运行项目, When 按 README 执行命令, Then 使用项目锁定的 Corepack/pnpm 安装和启动路径，不需要读取私密 `.env`。
- Given 使用者希望复用代码、体素母图或 Seedlands 品牌, When 查看授权文件, Then 能分别获得 Apache-2.0、CC BY 4.0 和商标限制，不会把三者混为一个宽泛许可证。
- Given 贡献者提交变更, When 阅读贡献指南与模板, Then 能说明变更范围、先写 spec/测试、运行相应证据，并避免上传凭据与无关产物。
- Given Pull Request 触发 CI, When 任一静态、构建或确定性浏览器检查失败, Then 对应稳定 job 失败且不执行部署。
- Given `main` 新 commit 的三个质量 job 全部通过, When `deploy` 运行, Then 只把该 commit 的 `dist/` 发布到 GitHub Pages，并让 deployment environment 记录页面 URL。
- Given 线上 Pages 版本已加载, When 访客仍在启动页或已进入世界, Then 右下角始终可见且不遮挡操作的水印，其短 SHA 对应本次 deployment commit，generator 版本对应运行时 `GENERATOR_VERSION`。
- Given 同一构建在 `/seedlands-web-sandbox/` 下运行, When 页面请求主模块、CSS 和体素母图, Then 所有资源从仓库子路径加载，不请求错误的域名根路径。
- Given 当前仓库仍为私有且位于个人账号, When 本 change 完成本地验收, Then 不自动 push、转移、重命名、公开或启用 Pages，等待用户对精确外部动作授权。

## Test Design

- 非代码文件：README、LICENSE、ASSETS、TRADEMARKS、社区模板、Dependabot 和 workflow 文本不创建 Vitest 内容断言；使用 Prettier/YAML 格式检查、diff 人工评审和后续 GitHub 平台读回。
- `RELEASE-01` 发布身份纯函数：`tests/client/release-build.test.ts` 要求合法完整 SHA 格式化为 `commit 0123456 · generator v2`，未注入或非法 SHA 返回 `null`。
- `RELEASE-02` 子路径素材纯函数：同一 Vitest 要求根路径与 `/seedlands-web-sandbox/` 都生成正确的 atlas URL。
- `RELEASE-03` Pages 浏览器行为：`changes/2026-09-04-open-source-foundation/e2e/pages-release.spec.ts` 在子路径构建中断言水印可见、短 SHA/generator 文本正确、DOM 保留完整 SHA。
- `RELEASE-04` 现有浏览器基线：使用 `SEEDLANDS_BASE_PATH=/seedlands-web-sandbox/` 运行 `pnpm test:e2e:regression`，验证启动、编辑、持久化和 Macro 地图在 Pages 子路径下仍通过。本 change 不把一次性水印用例提炼进长期基线。
- `RELEASE-05` 视觉语义：`changes/2026-09-04-open-source-foundation/midscene/pages-release.yaml` 验证水印细微但可读，且不遮挡启动表单。
- 预期 RED：在生产实现前运行 `CI=true pnpm exec vitest run tests/client/release-build.test.ts`，由于两个目标模块不存在而失败；浏览器用例由于水印节点不存在而失败。

## Acceptance & Evidence

- [x] 用户已批准实施前 spec SHA-256 `ecad8c4e769f59d834ee8a8829df27d9baa8a564b40605623b2fa58e995f93b4`；后续只写回了已预定验收项的实际结果和交付状态，未改变范围或行为合同。（Manual supplement）
- [x] 实施前单元 RED 已取得：`CI=true pnpm exec vitest run tests/client/release-build.test.ts` 因 `build-watermark` 模块未实现而失败，没有执行到用例断言。（Vitest）
- [x] 实施前浏览器 RED 已取得：注入固定 SHA 运行 Pages 变更用例，因 `#build-watermark` 节点不存在而失败。（Playwright-change）
- [x] `RELEASE-01` 与 `RELEASE-02` 先 RED 后 GREEN；定向 Vitest 最终 3/3 通过。（Vitest）
- [x] `RELEASE-03` 在注入固定 SHA 的子路径环境中 1/1 通过，水印文本、可见性和完整 SHA 均符合合同。（Playwright-change）
- [x] `RELEASE-04` 在 `/seedlands-web-sandbox/` 子路径下 8/8 通过。（Playwright-baseline）
- [x] `RELEASE-05` 通过；Midscene 1 个文件、1 个任务成功，确认启动页清晰可用、水印可读且不遮挡表单。（Midscene）
- [x] `CI=true pnpm verify:static` 通过；Prettier、ESLint、ls-lint 和 TypeScript 通过，Vitest 11 个文件、71 个用例通过，`src/world/**` 行覆盖率 97.27%。（Static）
- [x] `SEEDLANDS_BASE_PATH=/seedlands-web-sandbox/ VITE_COMMIT_SHA=0123456789abcdef0123456789abcdef01234567 pnpm build` 通过；构建产物的 CSS 与 JavaScript 都使用仓库子路径 atlas URL，没有错误的根路径。Vite 如实报告主 JavaScript chunk 约 1.98 MB 的非阻塞 warning。（Build）
- [x] 非代码治理文件已通过 Prettier 格式检查与 diff 评审，未使用 Vitest 文本断言冒充平台验收。GitHub 官方 Actions 的最新 release/tag 与固定 40 位 SHA 已在 2026-09-04 实时读回。（Static；Manual supplement）
- [ ] 首次远程 run `33863096075` 的三个质量 job 均在依赖安装阶段失败：Node.js 22.12.0 内置旧 Corepack 无法验证当前 pnpm 签名 key id。修复改用官方推荐的 `pnpm/setup` v2.1.0，固定 commit `703c52620218391530e48b9e8870d5c0082e1b9b`，由其校验自包含 pnpm、安装 Node.js 22.12.0 并以锁文件冻结模式安装。待新 SHA 的远程检查读回后更新为终态。（Static；Manual supplement）
- [x] 对所有可达 Git 历史执行了高置信凭据特征和可疑文件名扫描；未匹配高置信凭据，唯一命名命中为预期受控的 `.env.example`。体素母图的生成记录、处理来源和授权限定已写入 `ASSETS.md`；自动扫描不能证明不存在所有未知秘密。（Manual supplement）
- [x] 本地实施期间未 push、转移、重命名、公开、启用 Pages 或修改组织/仓库设置，未以本地 workflow 代替 GitHub 真实读回。（Manual supplement）

## Tasks & Current State

1. [done] 读取当前 Git、README、包元数据、素材生成记录和 GitHub 组织状态，确认工作树基线与目标仓库层级。
2. [done] 根据用户反馈移除非代码治理 Vitest，增加发布身份/子路径代码用例、Pages 变更级 Playwright 用例与 Midscene 语义验收。
3. [done] 取得新的实施前单元与浏览器 RED，并获得用户对精确 spec SHA-256 的批准。
4. [done] 实现双语入口、包元数据、授权边界、社区文件、GitHub 模板、CI/Pages 与 Dependabot。
5. [done] 实现 Vite 子路径、公共素材 URL 和可追溯水印，将预置用例跑至 GREEN。
6. [done] 运行定向单元、变更级浏览器、现有浏览器基线、Midscene、静态和构建验证，写回真实证据与 Delivery Snapshot。
7. [done] 仅暂存本 change 文件，创建语义化本地提交；不 push。
8. [pending] 获得独立外部授权后，才 push、转移/重命名/公开、启用 Pages、配置 ruleset 与安全开关，并通过 GitHub 与真实 URL 读回。

## Delivery Snapshot

本地改造已完成。旧版非代码治理测试及其 7/7 RED 已按用户意见作废；新合同只对发布身份、公共素材子路径和线上水印等代码/浏览器行为进行自动断言。

交付路径包括：英文/中文 README，Apache-2.0 源码许可，CC BY 4.0 体素母图边界，商标、贡献、安全和行为准则，CODEOWNERS、Issue/PR 模板、Dependabot、固定 action SHA 的 CI/Pages workflow，以及 Vite base、子路径素材、commit/generator 水印和所属测试。

已验证：定向 Vitest 3/3，静态基线 71/71，生产构建，Playwright-change 1/1，Pages 子路径浏览器基线 8/8，Midscene 1/1，以及可达历史的高置信凭据扫描。已知非阻塞限制是主 JavaScript chunk 约 1.98 MB；构建工具只报告 warning，本 change 不扩展到运行时拆包。

首次远程 PR run `33863096075` 暴露了 GitHub runner 上的旧 Corepack 签名 key 不兼容，三个 job 的共同根因均是依赖安装前的 `Cannot find matching keyid`，不是产品构建或测试回归。修复将 CI 安装面切换为官方 `pnpm/setup` v2.1.0 的固定 commit，保留锁定 pnpm、Node.js 和 frozen lockfile 的合同。

本 change 不包含远程写入。当前尚未 push，也尚未转移/重命名/公开仓库、启用 Pages、配置 ruleset 或 GitHub 安全开关；这些必须在获得独立授权后执行并真实读回。
