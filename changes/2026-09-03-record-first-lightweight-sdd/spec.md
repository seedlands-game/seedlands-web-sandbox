# Record-first Lightweight SDD

**Status:** Delivered

## Context & Goal

让小型、范围明确的改动保持快速交付，同时保留可恢复的需求、准出与验证记录；避免把 `change` 误解为每次都需要先审的计划。

## Scope & Non-goals

- In scope: 明确小 change 的直接交付与事后同交付记录模式。
- Non-goals: 降低测试或准出门槛；移除高影响改动的设计与 review 门槛。

## Decisions

**Direct implementation:** 小 change 采用“判断 → 实现 → 测试 → 准出 → 记录”。`changes/` 是交付记录；只在需求、授权或高影响边界不明确时才前置设计与用户 review。

## Behaviour

- Given 范围清晰且低风险的小改动, When 接到用户请求, Then 智能体直接实施、测试和准出，不先把 SDD 流程暴露为用户阻塞步骤。
- Given 小改动已完成, When 交付, Then 同一交付包含其简短 `spec.md`，记录真实证据和限制。
- Given 高影响或边界不清的变更, When 进入实现, Then 先形成必要设计并等待用户 review。

## Acceptance & Evidence

- [x] `AGENTS.md` 明确 change 是记录而非默认前置审批。
- [x] 小 change 与高影响变更的分流条件已写明。
- [x] `npm run build` 通过；`git diff --check` 通过。

## Tasks & Current State

1. [done] 固化记录优先的轻量 SDD 模式。
2. [done] 执行文档变更验证。

## Delivery Snapshot

已在 `AGENTS.md` 固化 record-first 规则。验证：`npm run build`、`git diff --check`。
