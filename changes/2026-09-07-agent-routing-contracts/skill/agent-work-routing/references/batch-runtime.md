# 批处理 runtime

配置要求 Node 22+、绝对或相对配置文件的本地 ESM adapter，以及正整数 `concurrency`、`maxAttempts`。`idempotency` 为 `required` 或 `none`。adapter 导出：

```js
export async function prepare({ config, runDir }) {}
export async function write(item, { config, idempotencyKey, signal }) {}
export async function read(item, { config, idempotencyKey, signal }) {}
export async function verify(item, remote, context) {
  return true;
}
```

命令：

```text
node scripts/batch-runtime.mjs prepare --config config.json --input items.json --run-dir run
node scripts/batch-runtime.mjs run --run-dir run
node scripts/batch-runtime.mjs start --run-dir run
node scripts/batch-runtime.mjs status --run-dir run
node scripts/batch-runtime.mjs wait --run-dir run --timeout-ms 30000
node scripts/batch-runtime.mjs stop --run-dir run
node scripts/batch-runtime.mjs audit --run-dir run
```

prepare 固定配置、输入和 adapter hash，并只调用一次 adapter prepare。run 采用有限并发与稳定 item id/幂等键，写后真实读回验证；原子状态让成功项跳过，写入已完成但读回或验证失败的项只重做 read/verify。配置、输入或 adapter 字节漂移会拒绝恢复。

非幂等写入一旦已经开始且结果不明，就进入 `needs-reconciliation`，不自动重写。只有 adapter 明确以 `NOT_SENT` 表示请求未发出才可重试。用户 adapter 仍需自行保证其错误分类和远端幂等语义；runtime 无法自动撤销远端写入。

stop 是协作式取消，不能证明在途请求未执行，也不能撤销已执行写入。再次 run 可续跑取消项。审计只保存时间、item id、阶段、状态和错误码，不保存 payload、原始响应、异常正文、幂等键或密钥；输入 snapshot 是恢复数据，应放在受控目录。
