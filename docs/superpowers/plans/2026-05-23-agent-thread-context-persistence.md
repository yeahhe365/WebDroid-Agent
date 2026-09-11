# Agent Thread Context Persistence Implementation Plan

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

- [ ] Write failing tests for `createAgentThread`, user-message events, turn recording, execution updates, and `AgentSession` compatibility.
- [ ] Run `npm test -- src/lib/agentThread.test.ts src/lib/agent.test.ts` and confirm failures are for missing thread APIs.
- [ ] Implement thread types, event helpers, turn helpers, and update `agent.ts` to record turns without adding raw assistant JSON to visible conversation messages.
- [ ] Re-run `npm test -- src/lib/agentThread.test.ts src/lib/agent.test.ts` and confirm the tests pass.

### Task 2: Context Builder And Compaction

**Files:**
- Create: `src/lib/contextBuilder.ts`
- Modify: `src/lib/openAiTypes.ts`
- Modify: `src/lib/openAiPayload.ts`
- Test: `src/lib/contextBuilder.test.ts`
- Test: `src/lib/openAiPayload.test.ts`

- [ ] Write failing tests for prompt context containing context summary, latest user message, current device state, app card, installed apps, and only recent previous steps.
- [ ] Run `npm test -- src/lib/contextBuilder.test.ts src/lib/openAiPayload.test.ts` and confirm failures are for missing context-builder support.
- [ ] Implement `buildAgentPromptContext`, deterministic compaction helpers, and `promptContext` support in chat payload creation.
- [ ] Re-run `npm test -- src/lib/contextBuilder.test.ts src/lib/openAiPayload.test.ts` and confirm the tests pass.

### Task 3: Thread Persistence

**Files:**
- Create: `src/lib/threadStore.ts`
- Test: `src/lib/threadStore.test.ts`

- [ ] Write failing tests for save/load/latest/delete behavior using the in-memory store and for API-key redaction in settings snapshots.
- [ ] Run `npm test -- src/lib/threadStore.test.ts` and confirm failures are for missing storage APIs.
- [ ] Implement `createMemoryThreadStore`, `createIndexedDbThreadStore`, and shared redaction helpers.
- [ ] Re-run `npm test -- src/lib/threadStore.test.ts` and confirm the tests pass.

### Task 4: App Integration And Recovery

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/runLogEntries.ts`
- Test: `src/App.test.tsx`

- [ ] Write failing tests that startup restores the latest thread, new chat creates a new persisted thread, and exported logs include the structured thread.
- [ ] Run `npm test -- src/App.test.tsx` and confirm failures are for missing recovery integration.
- [ ] Wire `ThreadStore` into `App`, save after thread mutations, restore latest thread on startup, and update export payloads.
- [ ] Re-run `npm test -- src/App.test.tsx` and confirm the tests pass.

### Final Verification

- [ ] Run `npm test`
- [ ] Run `npm run lint`
- [ ] Run `npm run build`
- [ ] Review `git diff --stat` and call out existing user changes separately from this implementation.
