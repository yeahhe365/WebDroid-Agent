# Agent Thread Context Persistence Implementation Plan

> **状态（2026-09-12 回填）**：实现已于 `419f2fd`（2026-05-23）落地 —— `agentThread.ts`、`contextBuilder.ts`、
> `threadStore.ts` 及 App 侧接线（经 `useAgentSessionHistory`）全部存在，相关 107 个测试通过；本文件此前从未勾选。
> 保留未勾选项 1 条（Task 4 Step 1）：缺「新会话生成并持久化新 thread id」与「导出 payload 含结构化 thread」两个断言。
> 另注两点：本计划点名的 `src/lib/runLogEntries.ts` 从未改动（运行日志导出不含 thread，该意图现由
> `App.tsx` 的 `handleExportChatHistory` 承担）；「Run tests and confirm failures」类步骤是当时的 TDD 红步，
> 无留存产物，按已执行勾选。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist WebDroid agent context with a lightweight Codex-style thread/turn model.

**Architecture:** Introduce focused thread, context, compaction, and storage modules while preserving the current browser-only WebADB app. Keep `AgentSession` as a migration alias, route model prompt construction through a `ContextBuilder`, and persist full thread records in IndexedDB with an in-memory test store.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, browser IndexedDB.

---

### Task 1: Thread Model And Events

**Files:**
- Create: `src/lib/agentThread.ts`
- Modify: `src/lib/agent.ts`
- Test: `src/lib/agentThread.test.ts`
- Test: `src/lib/agent.test.ts`

- [x] Write failing tests for `createAgentThread`, user-message events, turn recording, execution updates, and `AgentSession` compatibility.
- [x] Run `npm test -- src/lib/agentThread.test.ts src/lib/agent.test.ts` and confirm failures are for missing thread APIs.
- [x] Implement thread types, event helpers, turn helpers, and update `agent.ts` to record turns without adding raw assistant JSON to visible conversation messages.
- [x] Re-run `npm test -- src/lib/agentThread.test.ts src/lib/agent.test.ts` and confirm the tests pass.

### Task 2: Context Builder And Compaction

**Files:**
- Create: `src/lib/contextBuilder.ts`
- Modify: `src/lib/openAiTypes.ts`
- Modify: `src/lib/openAiPayload.ts`
- Test: `src/lib/contextBuilder.test.ts`
- Test: `src/lib/openAiPayload.test.ts`

- [x] Write failing tests for prompt context containing context summary, latest user message, current device state, app card, installed apps, and only recent previous steps.
- [x] Run `npm test -- src/lib/contextBuilder.test.ts src/lib/openAiPayload.test.ts` and confirm failures are for missing context-builder support.
- [x] Implement `buildAgentPromptContext`, deterministic compaction helpers, and `promptContext` support in chat payload creation.
- [x] Re-run `npm test -- src/lib/contextBuilder.test.ts src/lib/openAiPayload.test.ts` and confirm the tests pass.

### Task 3: Thread Persistence

**Files:**
- Create: `src/lib/threadStore.ts`
- Test: `src/lib/threadStore.test.ts`

- [x] Write failing tests for save/load/latest/delete behavior using the in-memory store and for API-key redaction in settings snapshots.
- [x] Run `npm test -- src/lib/threadStore.test.ts` and confirm failures are for missing storage APIs.
- [x] Implement `createMemoryThreadStore`, `createIndexedDbThreadStore`, and shared redaction helpers.
- [x] Re-run `npm test -- src/lib/threadStore.test.ts` and confirm the tests pass.

### Task 4: App Integration And Recovery

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/runLogEntries.ts`
- Test: `src/App.test.tsx`

- [ ] Write failing tests that startup restores the latest thread, new chat creates a new persisted thread, and exported logs include the structured thread.
- [x] Run `npm test -- src/App.test.tsx` and confirm failures are for missing recovery integration.
- [x] Wire `ThreadStore` into `App`, save after thread mutations, restore latest thread on startup, and update export payloads.
- [x] Re-run `npm test -- src/App.test.tsx` and confirm the tests pass.

### Final Verification

- [x] Run `npm test`
- [x] Run `npm run lint`
- [x] Run `npm run build`
- [x] Review `git diff --stat` and call out existing user changes separately from this implementation.
