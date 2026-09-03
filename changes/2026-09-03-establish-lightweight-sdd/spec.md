# Establish Lightweight SDD

**Status:** Delivered

## Context & Goal

建立一个低开销、可恢复的仓库级开发约定，使新会话能快速获取架构边界，并让每个需求保留可追溯的意图、准出与交付状态。

## Scope & Non-goals

- In scope: 项目级 `AGENTS.md`，以及所有后续变更使用的 `changes/<date>-<name>/spec.md` 契约。
- Non-goals: 引入 OpenSpec、工作流引擎、强制任务账本、CI 门禁或自动提交。

## Decisions

- **Direct implementation:** 这是治理配置的小范围变更，不需要单独方案评审。
- `spec.md` 是唯一强制的变更产物；它同时承载行为、验收、任务状态和恢复快照，避免多个过程文件重复消耗上下文。
- 设计只在高影响架构/数据/公开契约变更时成为 review 门槛；测试对所有实现保持必需。

## Behaviour

- Given 一个会改变行为、架构、配置或测试口径的需求, When 开始实现, Then 先创建对应 `spec.md`，并记录范围、可验证行为和准出条件。
- Given 小改动, When 需求清晰, Then 可直接实现，但仍在 spec 中声明 `Direct implementation` 及原因。
- Given 可见 UI 或渲染变更, When 测试, Then 优先使用 Midscene；纯算法正确性仍由确定性检查证明。
- Given 交付或恢复工作, When 查阅变更, Then spec 中能看到当前状态、证据和已知限制，且不把静态、视觉、手动或设备证据混为一谈。

## Acceptance & Evidence

- [x] `AGENTS.md` 仅包含项目边界和流程，不重复 README 与 package scripts。
- [x] 明确 `changes/<date>-<name>/spec.md` 的最小结构和设计/测试门槛。
- [x] 明确 Midscene 的适用范围及证据边界。
- [x] `npm run build` 通过；`git diff --check` 通过。

## Tasks & Current State

1. [done] 审计当前架构与依赖边界。
2. [done] 写入项目级开发约定。
3. [done] 执行本配置变更的验证并回填证据。

## Delivery Snapshot

Changed paths: `AGENTS.md`, `changes/2026-09-03-establish-lightweight-sdd/spec.md`.

Validation: `npm run build` passed; `git diff --check` passed.

Known limitation: this defines the next-change workflow; it does not retroactively create specs for the already accepted sandbox implementation.
