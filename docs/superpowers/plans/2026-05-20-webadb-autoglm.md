# WebDroid Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local pure frontend WebADB + OpenAI-compatible phone-agent app.

**Architecture:** Keep device control, model I/O, action parsing, and UI orchestration separate. Test pure logic first, then wire browser-only WebADB behavior behind a small backend interface.

**Tech Stack:** Vite, React, TypeScript, Vitest, Tango ADB packages, lucide-react.

---

### Task 1: Core Types And Action Validation

**Files:**
- Create: `src/lib/actions.ts`
- Test: `src/lib/actions.test.ts`

- [x] Write tests for JSON extraction, supported action parsing, coordinate validation, and unsafe inputs.
- [x] Implement strict action types and validators.
- [x] Run tests and confirm they pass after failing first.

### Task 2: OpenAI-Compatible Client

**Files:**
- Create: `src/lib/openAiClient.ts`
- Test: `src/lib/openAiClient.test.ts`

- [x] Write tests for request URL, headers, multimodal payload, and response extraction.
- [x] Implement request builder and completion caller.
- [x] Run tests and confirm they pass after failing first.

### Task 3: Device Backend

**Files:**
- Create: `src/adapters/deviceBackend.ts`
- Create: `src/adapters/webAdbBackend.ts`
- Test: `src/adapters/deviceBackend.test.ts`

- [x] Write tests for shell command generation and input text escaping.
- [x] Implement `DeviceBackend` interface and WebADB adapter.
- [x] Use browser-only feature detection for WebUSB support.

### Task 4: Agent Loop

**Files:**
- Create: `src/lib/agent.ts`
- Test: `src/lib/agent.test.ts`

- [x] Write tests for manual-review stop, max-step stop, and done action handling.
- [x] Implement one-step and loop orchestration.

### Task 5: UI

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/index.css`

- [x] Build the control console with model config, device connection, task input, action review, logs, screenshot preview, and stop controls.
- [x] Keep auto-run off by default.

### Task 6: Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [x] Add a test script.
- [x] Document requirements and manual device checklist.
- [x] Run `npm test`, `npm run lint`, and `npm run build`.

### Task 7: Open-AutoGLM Action Parity

**Files:**
- Modify: `src/lib/actions.ts`
- Modify: `src/adapters/deviceBackend.ts`
- Modify: `src/adapters/webAdbBackend.ts`
- Modify: `src/lib/openAiClient.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/App.tsx`
- Test: `src/lib/actions.test.ts`
- Test: `src/adapters/deviceBackend.test.ts`
- Test: `src/lib/agent.test.ts`

- [x] Add parser tests for Open-AutoGLM JSON and function-style action outputs.
- [x] Add normalized actions for launch, back, home, long press, double tap, take over, and note.
- [x] Add WebADB command generation for launch, long press, double tap, back, home, and ADB Keyboard text mode.
- [x] Add UI controls for ADB Keyboard and expose the supported action list.
- [x] Run `npm test`, `npm run lint`, and `npm run build`.
