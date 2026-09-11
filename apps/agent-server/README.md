# 本机 NPC 认知服务

浏览器 Authority 持续执行每个角色唯一的行为树。此服务只保存人物文档、标准模型会话、事件游标和记忆；通过受限世界工具观察、说话及提议整棵树。关闭服务后身体仍执行当前树。

当前支持一个本机世界连接、最多三个活动角色。每个角色独立 PG namespace、Agent 与调度；真实供应商与凭据只进入模型网关。多租户、云部署与 World AI 不在此版。

## 启动

先准备本机 PostgreSQL（示例密码仅适用于本地开发）：

```sh
docker run --name seedlands-cognition-pg -d \
  -e POSTGRES_PASSWORD=local-development-only \
  -e POSTGRES_DB=seedlands \
  -p 127.0.0.1:54329:5432 \
  -v seedlands-cognition-pg:/var/lib/postgresql/data postgres:16-alpine
```

已有同名容器或端口时复用自己确认的实例，或选择其他名称/端口；不要覆盖现有数据库。PG volume 保存记忆，删除它会删除本地人物会话。

按[网关说明](../../scripts/model-gateway/README.md)启动网关。它可以复用同一环境里的 `MIDSCENE_MODEL_API_KEY` 与 `MIDSCENE_MODEL_BASE_URL`；必须同时提供两者，不读取 `.env`。供应商密钥不传给浏览器或认知服务。

在另一个终端启动认知服务（下列网关凭据是你为本机网关设置的凭据）：

```sh
export SEEDLANDS_COGNITION_DATABASE_URL='postgresql://postgres:local-development-only@127.0.0.1:54329/seedlands'
export SEEDLANDS_MODEL_GATEWAY_URL='http://127.0.0.1:4000/v1'
export SEEDLANDS_MODEL_GATEWAY_TOKEN='<本机网关凭据>'
export SEEDLANDS_ALLOWED_ORIGINS='http://127.0.0.1:5173,http://localhost:5173'
pnpm agent:dev
```

默认服务监听 `127.0.0.1:8787`；`AGENT_SERVER_PORT` 可改端口。终端输出一次浏览器连接地址及临时配对码。进入游戏按 **T** 打开伙伴面板，在“思考设置”填入地址、配对码并连接。页面来源须与 `SEEDLANDS_ALLOWED_ORIGINS` 精确一致。

如果暂不配置网关 URL/token，服务仍能提供 PG 工作区和保存恢复，认知状态明确显示缺少网关。不会悄悄退回另一模型。独立 REPL 仍使用 `pnpm server:headless -- --repl`；进入后可直接执行 `await world.clock({ kind: "advance", elapsedMs: 1000 })`。

## 玩家可以试什么

- 邀请默认伙伴，看它自行进食、白天巡视、晚上休息；这些不调用模型。
- 连接服务后和伙伴交谈。Flash 根据性格、当前树、受限观察与经过的事件调整整棵持续树。
- 在思考设置输入性格/经历标签，由 Pro 创作出生包并邀请新伙伴。
- 查看 `AGENT.md`、`SOUL.md`、`MEMORY.md`、生效行为树及执行状态。
- 从“世界与伙伴存档”导出配对文件。导入后创建新 timeline，世界保持暂停，确认后点“继续这个世界”。如果 PG 导入中断，重新连接并导入原文件，不能用新空白记忆替代。

## 边界与验证

每个角色最多一个在途认知回合，250ms 合并事件；兜底默认180秒（60–600秒）。新逻辑回合刷新时钟，工具修正、网关重试和 Pro 压缩不刷新。每回合最多8个模型步骤、3次树提案。Pro 只在压缩维护和出生包流程调用；压缩失败保留原记忆，硬限暂停认知，身体继续。

窗口总预算128000、软阈112000，当前以 UTF-8 字节的保守 token 上界预检；不把它当作供应商精确 token 数。MEMORY 同时受4000估计 tokens和16KiB约束。完整封存窗口仅供系统审计，人物和 Pro 都不能检索已遗忘的会话。

运行 `pnpm --filter @seedlands/agent-server test` 验证实际临时 PG/WS 与标准工具；`pnpm test:npc-behavior` 验证浏览器。真实模型和60分钟旅程需要显式选择，避免普通测试产生费用或长等待。实际交付证据见[当前 change](../../changes/2026-09-10-npc-composable-baseline/spec.md)。

旧 v1 单目标宿主/测试仍保留给未归档历史 change 复验。根入口不重导出旧宿主，启动命令也不运行它；但当前私有 workspace 包的通配子路径仍允许显式导入旧实现，因此不能把它称为已移除的接口。当前主产品使用 resident v2，其 PG/多角色/浏览器准出须单独核验，旧 v1 测试通过不能替代。旧子路径的收紧和历史归档留待明确的接口清理变更。
