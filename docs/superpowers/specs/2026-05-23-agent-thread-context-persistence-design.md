# Agent Thread Context Persistence Design

## Goal

Upgrade WebDroid Agent from a single in-memory run session to a lightweight thread/turn model that persists across page refreshes while keeping the browser-only WebADB architecture.

## Scope

The work stays inside the existing React/Vite frontend. There is no backend service and no server-side storage. The app will restore the latest active agent thread from browser storage, preserve structured turns and events, and continue sending strict JSON action requests to the configured OpenAI-compatible model.

## Architecture

- `AgentThread` replaces the loose `AgentSession` shape as the primary context object. It includes identity, title, status, user-visible messages, structured turns, typed events, context summary, latest device snapshot, and a redacted settings snapshot.
- `AgentTurn` records one model decision cycle: input context, screenshot/device snapshot, generated prompt context, raw model output, parsed action, mapped execution action, execution result, status, and timing.
- `ContextBuilder` owns all prompt-context selection. It combines the system action rules, latest user instruction, current device state, app card, installed apps, context summary, and recent turns.
- `ThreadStore` persists complete threads in IndexedDB and exposes a testable storage interface. The initial version automatically restores the most recently updated thread instead of adding a full thread list UI.
- Typed thread events record user input, device snapshots, assistant actions, action execution, status changes, and context compaction. The existing run-log UI can keep its current presentation while export and restored context use structured data.

## Context Compaction

The first compaction pass is deterministic. When a thread grows beyond the recent-turn window, older executed turns are summarized into `contextSummary` with step number, app, action, and result. Turns are not deleted; prompt construction simply prefers the summary plus recent turns. This avoids extra model calls and keeps recovery/debugging data intact.

## Persistence And Recovery

On startup, the app opens IndexedDB and restores the newest saved thread. If storage is unavailable, the app still works in memory and logs a warning. New chat/reset creates a new thread and saves it. Each user message, model turn, execution result, compaction, and settings snapshot update schedules a thread save. API keys are not stored inside thread settings snapshots.

## Compatibility

`AgentSession` can remain as a type alias during migration so existing call sites can move gradually. The action schema, OpenAI-compatible network client, model response parser, and WebADB command execution remain unchanged.

## Verification

Tests should cover thread creation, typed event recording, prompt context building with summaries and recent turns, deterministic compaction, thread-store save/load/latest behavior using the in-memory store, agent turn recording, and app-level auto-restore behavior where practical.
