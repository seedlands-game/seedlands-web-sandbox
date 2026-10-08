# Cloudflare Pages 部署迁移

## 目标

将 Seedlands 网站从 GitHub Pages 迁移到 Cloudflare Pages。只有 `main` 更新正式站点；同仓库 PR 在合入前获得隔离预览部署。部署内容必须与通过 Chromium 回归的生产构建产物一致。

## 范围与非目标

- 将网站资源基路径固定为站点根路径，支持 Cloudflare Pages 的根域名部署。
- 在现有 CI 的静态检查、Headless 合同和 Chromium 回归成功后，用同一份已验收构建产物部署。
- `main` push 发布正式环境；同仓库 PR 发布到独立 `pr-<编号>` 预览别名。
- 使用 GitHub Actions secrets 注入 Cloudflare API Token 和 Account ID；凭据不进入仓库。
- 暂不迁移自定义域名、DNS、Cloudflare Access、Functions 或其他服务。正式站点暂按仓库 slug 命名为 `seedlands-web-sandbox.pages.dev`；创建项目时需确认名称仍可用，并将 `main` 设为 production branch。
- 不从 fork PR 获取或暴露 Cloudflare 凭据；fork PR 保留常规 CI，但不部署预览。

## 决策

- 使用 Wrangler Direct Upload，从 GitHub Actions 控制构建/测试顺序，并复用同一份已通过 Chromium 的 `apps/web/dist`。
- Cloudflare Pages 项目名为 `seedlands-web-sandbox`；`main` 是唯一生产分支，PR 使用 `pr-<编号>`。
- 保留 Pages 预览的 Cloudflare 自动 `noindex` 行为；GitHub Deployment 状态关联到对应 commit。
- 只有在 Cloudflare project 和 GitHub secrets 配置完成、正式部署读回成功后，才算线上切换完成。

## Given / When / Then

- Given 任一 PR 的静态检查、Headless 合同、Chromium 回归均成功，When PR 来自当前仓库，Then 将与 Chromium 回归相同的 artifact 部署到 `pr-<编号>` 预览分支，不触碰生产 `main` 部署。
- Given PR 来自 fork，When CI 执行，Then 运行常规 CI 但不把 Cloudflare secrets 暴露给预览任务。
- Given `main` push 的静态检查、Headless 合同和 Chromium 回归均成功，When 部署任务执行，Then 同一 artifact 部署到 Cloudflare Pages 的生产 `main` 环境。
- Given Vite 构建，When 部署到 Pages 根路径，Then HTML、Worker、Pack、图像和工作台资源均以 `/` 为基路径解析。
- Given Cloudflare 凭据或 Pages project 不存在/无权访问，When 部署任务运行，Then 任务失败并保留可诊断错误，不报告迁移完成。

## RED / 测试设计

- RED 基线：`.github/workflows/ci.yml` 只有生产构建和测试，没有 Cloudflare 部署 job；CI 将 `SEEDLANDS_BASE_PATH` 强制设为 GitHub 仓库子路径；`package.json` 和 `apps/web/index.html` 仍指向 GitHub Pages URL。
- 自动化设计：workflow YAML 检查触发事件、任务依赖、artifact 名称、Pages 项目名及 main/PR branch 选择；生产构建产物验收继续由既有唯一 Chromium 流程完成。
- 线上观察：使用 GitHub Deployments/Cloudflare 部署详情读回 PR 预览 URL 和 main production URL；HTTP 读回页面与关键资源响应。此项需平台凭据和 Pages 项目，当前不可自动执行。

## 验收证据

- [x] 部署 workflow YAML 被 Prettier 解析且格式检查通过；`git diff --check` 通过。
- [ ] CI 生成且 Chromium 验收唯一 `production-web-<run>-<attempt>` artifact。
- [ ] PR 部署详情绑定当前 PR head SHA，且 URL 属于 `seedlands-web-sandbox.pages.dev` 预览环境。
- [ ] main 部署详情绑定 main SHA，且 production URL 与资源返回成功。
- [ ] GitHub Pages 停止接收新生产发布；Cloudflare 生产站点已独立读回后再完成切换。

## 任务状态

- [x] 登记迁移合同和验收门禁。
- [x] 工作流、站点 URL 与根路径配置。
- [x] 本地格式与 diff 静态检查。
- [ ] Cloudflare project 与 GitHub Actions secrets 配置。
- [ ] PR 预览与正式环境真实部署、读回并完成 GitHub Pages 切换。

## Delivery Snapshot

- 当前分支：`feat/classic-beta173-playable`。
- 当前工作树已有 Classic gameplay/E2E 修改和其他未提交产物，均与本 change 无关，保留原状。
- 长期 docs baseline：不更新。此次变更只切换现有交付目标，不修改产品路线或跨 change 架构决策。
- 平台预检：GitHub Actions secret 名称列表为空；Cloudflare Pages project 列表读取返回 HTTP 401 / error code 10000。未输出或持久化任何凭据值。
- 线上读回：GitHub Pages 当前配置为生产来源且站点返回 HTTP 200；拟用的 `seedlands-web-sandbox.pages.dev` 当前 DNS 查询失败（INFRA_BLOCKED），没有 Cloudflare 部署可读回。
- 当前未验证：Cloudflare project 创建与 `main` production branch、有效 API token 权限、GitHub Actions secrets、真实 PR/production 部署、Pages 域名读回与 GitHub Pages 停用。
