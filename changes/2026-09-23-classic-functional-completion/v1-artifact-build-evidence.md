# V1 Production Artifact 构建证据

状态：`BLOCKED`。精确已推送源码的 production build 在真实 `ssg:check` 失败；未生成 `apps/web/dist/harness-artifact.json`，因此没有执行 `pnpm harness:artifact` 或浏览器。

## 源码与环境

- cwd：`/private/tmp/seedlands-v1-acceptance-edafd0c9`
- detached HEAD：`edafd0c9958d63b873e1818eca6732e072a732a8`
- 创建前目标路径不存在；创建后 tracked worktree 与 index 保持 clean。
- 本地、upstream 与 `git ls-remote origin refs/heads/feat/classic-beta173-playable` 在创建前均为同一 SHA。
- 未读取 `.env`/secret，未安装或升级工具，未修改全局配置。

依赖准备使用真实 `node_modules` 目录：第三方包逐项软链接到原工作区已有安装，根及 package 级 `@seedlands/kernel`、`@seedlands/stdlib`、`@seedlands/playbook-classic` 等 workspace 包明确链接到 detached 树自身源码。`realpath` 核验三处 `@seedlands/stdlib` 均为 `/private/tmp/seedlands-v1-acceptance-edafd0c9/packages/stdlib`。`node_modules` 被 source snapshot 排除，不改变源码身份。

构建前 `apps/web/dist` 不存在。`sourceIdentity()` 读回：

```json
{
  "sourceSha": "edafd0c9958d63b873e1818eca6732e072a732a8",
  "sourceDigest": "195cf42a27877728c3eeba13cf32078c9b293ec928e98fa11081f9862e665090",
  "lockDigest": "44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169"
}
```

## Attempt 1：依赖布局失败

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-edafd0c9-build.log'
```

结果：exit 1，未进入 `build:web` 实际构建。pnpm 拒绝软链接的 `node_modules/.pnpm-task-run-state-v1`：`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`。

- 日志已归档为 `evidence/v1-artifact-build-01/attempt-1.log`，933 bytes，SHA-256 `5af4463fccd8e8a086437e43448766829c732570f0ec99999ec0e5fdb82562f9`。
- benchmark receipt已逐字节归档为 `evidence/v1-artifact-build-01/attempt-1-receipt.json.log`，SHA-256 `ceb138da4bdb61b4476325da3861def0d18947c766309a6a85e2003f4b22da70`；`2026-09-24T20:45:59.097Z` 至 `20:46:02.016Z`，status FAIL，exit 1。`.json.log` 后缀防止格式化hook改写原始receipt。

授权范围允许修复一次已知本地依赖布局。确认无 dist 后，只删除上述临时树内状态软链接并创建同名真实目录；没有修改源码。

## Attempt 2：真实 Production 阻塞

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- /bin/bash -c 'set -o pipefail; pnpm build 2>&1 | tee /private/tmp/seedlands-v1-acceptance-edafd0c9-build-attempt2.log'
```

结果：exit 1。该次运行已经进入根 `pnpm build -> scripts/harness/artifact.mjs --build -> pnpm build:web`：

1. `pnpm packs:build` PASS，生成临时 Pack。
2. `pnpm wasm:rust:verify` PASS，输出 `Rust source/artifact fingerprints verified.`。
3. `pnpm ssg:check` FAIL：`apps/web/src/client/presentation/asset-catalog.ts:236` 抛出 `Missing builtin item material mapping: wooden-door`。
4. Web typecheck、Vite production build、artifact receipt 写入均未执行。

失败原因是已提交生产源码的 presentation catalog 闭包：`items` 包含 `wooden-door`，其 Classic 定义不走普通 `placesVoxel`，`nativeItemAssets` 没有对应模型，`itemMaterials` 又只声明 dirt/stone/wood/sand/berry/plank/glowstone/lantern，因此生成起始页加载完整 catalog 时 fail closed。这不是依赖布局、CI、浏览器或 MP3 错误；本阶段未获源码修复授权，未尝试第三次 build。

- 日志已归档为 `evidence/v1-artifact-build-01/attempt-2.log`，1909 bytes，SHA-256 `df7374f802934b08bdfe945e715077839696e0841d7e8f4d9ef2dcaf0aeadb64`。
- benchmark receipt已逐字节归档为 `evidence/v1-artifact-build-01/attempt-2-receipt.json.log`，SHA-256 `b97ec492d7495782423af360c19c5ff7b381f9e687234448f00abbf2017d892f`；`2026-09-24T20:46:46.266Z` 至 `20:46:49.717Z`，status FAIL，exit 1。`.json.log` 后缀防止格式化hook改写原始receipt。

## 部分 Pack 证据

Attempt 2 在失败前已生成 `apps/web/public/packs`，但它不是完整 production artifact。`packs.lock.json` 中的媒体条目与复制文件均匹配：

```text
path=playbooks/classic/assets/audio/to-far-shores.mp3
size=2976045
contentType=audio/mpeg
sha256=3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9
```

Pack 文件摘要：

```text
7259ae5ae2a3ba7ace583ec04b20e4ab27f784556156b491195cd53bfa2cd735  apps/web/public/packs/host-admissions.json
14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3  apps/web/public/packs/overworld.manifest.json
9539898fa836a80116774ffaed01345e08ab775ccb9930154557f596e4c824ea  apps/web/public/packs/overworld.mjs
954cb2be23eb5d8823efddf34eb5fcced75a32253af1feaef9d6e193cbe4e3a5  apps/web/public/packs/packs.lock.json
3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9  apps/web/public/packs/playbooks/classic/assets/audio/to-far-shores.mp3
a1e379e5e8a9d5f5d41ef7ce204863af0d0cfe41b9e3081e138d87d2517d9f5b  apps/web/public/packs/playbooks/classic/presentation.json
```

## 保留状态与下一步

- `/private/tmp/seedlands-v1-acceptance-edafd0c9` 暂时保留；两份日志与两份receipt已逐字节归档到本change的 `evidence/v1-artifact-build-01/`。无常驻 build/dev/browser进程，默认锁已释放。
- `apps/web/dist` 不存在，`harness-artifact.json` 不存在；所以 `pnpm harness:artifact` 没有合法输入，本阶段未运行。
- detached 树 tracked diff 和 index 均为空；只有被 gitignore 排除的依赖视图与部分 `apps/web/public/packs` 产物。原工作区 Lighting/transport/保护 dirty 没有进入该树。
- root已准出`V1-ASSET-DOOR-CLOSE-01`：显式复用现有door utility sprite注册native pixel model，不恢复`placesVoxel`、不加通用fallback。修复提交后从新远端SHA新建干净build树再运行一次build；不能在当前已失败源码树上手改后冒充`edafd0c9` artifact。
