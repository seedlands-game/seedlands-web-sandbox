# V1 产品宿主 Structure 准入证据

阶段：V1-HOST-STRUCTURE-ADMISSION-01
结论：**定向 GREEN，等待 root 准出；不代表 Browser/V1 旅程 GREEN。**

## 变更边界

- scripts/product-pack-admissions.mjs：只在 seedlands:overworld 的固定授权表增加
  seedlands.structure: [read, execute]。
- apps/web/tests/integration/runtime/server/composition/product-playbook-permissions.test.ts：使用正式
  Classic Pack 与真实 assembleProductPacks 检查完整请求闭包、最小授权和 fail-closed 反例。
- v1-host-structure-admission-contract.md：冻结本阶段产品行为和证据边界。
- 未修改 Kernel、stdlib permission/assembly、Pack 请求、alternative Playbook、Worker loader、全局/云权限或凭据。

## RED

命令：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/product-playbook-permissions.test.ts --maxWorkers=1
```

生产修改前结果：exit 1，1 file / 3 tests，2 failed / 1 passed。完整正式 Classic 权限差分只返回：

```text
seedlands.structure: read,execute
seedlands.structure: execute
```

第一条完整请求/assembly 正例与第二条最小授权合同失败；删除 Structure grant 后真实 assembly 拒绝的第三条负例通过。

## GREEN

单文件复验，同一命令：exit 0，1 file / 3 tests passed。

合并相邻 product/alternative 回归：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/server/composition/product-playbook-permissions.test.ts apps/web/tests/integration/runtime/server/composition/product-extension-admission.test.ts apps/web/tests/integration/runtime/server/composition/alternative-playbooks.test.ts --maxWorkers=1
```

结果：exit 0，3 files / 8 tests passed。证明 overworld 获得 read/execute、没有 write；
click-conversion、builder、modular-world 不继承；未知 Playbook 仍拒绝；删去 Structure grant 后正式 Classic assembly 仍拒绝。

## 正式 Pack 生成与 Loader

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- node scripts/build-gameplay-packs.mjs --out /private/tmp/seedlands-host-structure-admission-954 --playbook overworld
```

结果：exit 0；builder 内置 loadVerifiedPackArtifacts(lockPath) 完成真实 manifest/entry/resource loader 校验。生成物只用于本阶段临时验证，不是 production artifact：

- host-admissions.json SHA-256 44cce09eb8b53c82318f360388caca5e19b7063dae337c14aea5eb653c162982
- overworld.manifest.json SHA-256 14e53b01e8c31a80d10bcb4109d3e3c13abe69b046b60f2ebc80bbd9f585bcb3
- packs.lock.json SHA-256 1649fae95e78a17fa1f5e327cac87e08ec2f3f7222ad257a1288cb897f4087c3
- 正式 manifest 模块权限请求 34 条；host grant 差分 missing=[]。
- 生成的 Structure grant 精确为 read,execute，不含 write。

## 静态检查

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint scripts/product-pack-admissions.mjs apps/web/tests/integration/runtime/server/composition/product-playbook-permissions.test.ts
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec prettier --check scripts/product-pack-admissions.mjs apps/web/tests/integration/runtime/server/composition/product-playbook-permissions.test.ts changes/2026-09-23-classic-functional-completion/v1-host-structure-admission-contract.md
git diff --check -- scripts/product-pack-admissions.mjs apps/web/tests/integration/runtime/server/composition/product-playbook-permissions.test.ts changes/2026-09-23-classic-functional-completion/v1-host-structure-admission-contract.md changes/2026-09-23-classic-functional-completion/v1-host-structure-admission-evidence.md changes/2026-09-23-classic-functional-completion/execution-state.md
```

TypeScript、ESLint、Prettier 与最终 diff check 均 exit 0。

## Browser-02 与未验证层

Browser-02 在旧 artifact source a77f1f4e... 上关闭 Browser-01 的 presentation schema 首因，随后于 C0
被本阶段修复的 host Structure admission 拒绝；lease 已释放，V1 全部 NOT OBSERVED。原始结果保留在
evidence/v1-canonical-browser-02/，本阶段未修改、重跑或覆盖。新源码必须由 GIT-10 后的新 clean
artifact 和 root 唯一 browser lease 验收；本阶段未运行 full build、browser、Cua 或 CI。
