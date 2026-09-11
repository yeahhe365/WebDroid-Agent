# Reference Alignment Audit: Open-AutoGLM and mobilerun

Date: 2026-05-25

## Scope

This audit treats the two reference projects as Open-AutoGLM and mobilerun because WebDroid-Agent explicitly documents compatibility with Open-AutoGLM-style and mobilerun-style actions.

Reference snapshots inspected:

- WebDroid-Agent current worktree on base commit `b43be48`
- Open-AutoGLM `zai-org/Open-AutoGLM` at `86f5538`
- mobilerun `droidrun/droidrun` at `bbb4048`

## Where WebDroid-Agent Is Already Close

- It already has the same core phone-agent loop shape: screenshot, current app/device state, model call, parsed action, device execution, then the next screenshot.
- It supports Open-AutoGLM function-style actions such as `do(action="Launch")`, `do(action="Tap", element=[x,y])`, `finish(message=...)`, `Type`, `Back`, `Home`, `Long Press`, `Double Tap`, `Take_over`, `Interact`, `Note`, and `Call_API`.
- It supports several mobilerun aliases: `click_at`, `click_area`, `long_press_at`, `type_text`, `system_button`, `open_app`, `remember`, `complete`, and mobilerun `swipe(coordinate, coordinate2, duration)`.
- Its screenshot-only coordinate model is already closer to mobilerun visual-remote mode than to the older Open-AutoGLM relative-coordinate prompt: model coordinates are screenshot pixels and are mapped back to native device pixels before execution.
- It has useful WebDroid-native strengths that neither reference project has in the same form: browser-first WebUSB/WebADB, no local Python install, a visual React control surface, IndexedDB thread persistence, and a local Docker proxy for OpenAI-compatible model calls.

## Highest-Value Alignment Opportunities

### 1. Make action protocol mode explicit

Open-AutoGLM's prompt asks for `<think>...</think><answer>...</answer>` with `do(...)` and `finish(...)`, and its `Tap`/`Swipe` coordinates are relative `0..999`. WebDroid currently prefers canonical JSON and even asks the OpenAI API for `response_format: { type: "json_object" }`, while the parser quietly accepts Open-AutoGLM as a fallback.

Recommendation: add an explicit `actionProtocol` setting with at least `webdroid_json`, `open_autoglm_function`, and later `mobilerun_xml`. Keep JSON as the default, but let users select Open-AutoGLM mode when they use AutoGLM-Phone models.

Why it matters: this is the smallest change that makes compatibility intentional instead of accidental.

### 2. Add mobilerun XML tool-call parsing

mobilerun FastAgent uses XML-style tool calls such as `<function_calls><invoke name="click_at">...</invoke></function_calls>` and feeds tool results back as `<function_results>`. WebDroid currently accepts function-like aliases but not mobilerun's native XML shape.

Recommendation: add a small XML parser for mobilerun tool calls and map parsed calls through the existing `ActionToolRegistry`. Add fixtures based on mobilerun's `tests/test_fast_agent_xml_parser.py`.

Why it matters: WebDroid already advertises mobilerun-compatible aliases; XML parsing would close the next visible gap.

### 3. Add an optional UI hierarchy state layer

mobilerun's strongest structural difference is not just screenshots. It can inspect accessibility trees, format indexed UI elements, and execute `click(index)`/`type(index)` against resolved elements. WebDroid currently has screenshot pixels plus app/package/activity/keyboard state.

Recommendation: add a WebADB-friendly state provider using `uiautomator dump` and XML parsing. Start read-only: capture tree, assign stable indices, include concise element text/bounds in prompt. Then add `click(index)` and `type_text(index)` aliases.

Why it matters: this would improve reliability more than another prompt tweak. It also brings WebDroid closer to mobilerun without requiring the Mobilerun Portal app.

### 4. Promote app cards from hard-coded data to user-editable assets

mobilerun treats app cards as package-name mapped instruction files. WebDroid has the idea already, but the cards are hard-coded in `src/lib/appCards.ts` and limited to Chrome, Gmail, and Settings.

Recommendation: move built-in cards to data files and add import/export or an IndexedDB-backed editor. Keep `resolveAppCard(packageName)` as the runtime API.

Why it matters: this is a clean, low-risk path toward mobilerun's app-specific guidance while staying browser-native.

### 5. Add trajectory export and replay artifacts

mobilerun can save trajectories with screenshots, UI state, action metadata, and optional GIFs. WebDroid persists compact thread/turn/event history, but this is optimized for in-app resume, not offline debugging, dataset building, or replay.

Recommendation: add "Export trajectory" for a thread as JSON plus retained screenshots, then add optional replay/import. Keep screenshots compact by default and make full media export explicit.

Why it matters: this makes failures inspectable and gives WebDroid a practical debugging loop comparable to mobilerun tracing/trajectory tools.

### 6. Implement real `note` / `call_api` semantics

Open-AutoGLM distinguishes `Note` for recording page content and `Call_API` for summarizing or commenting on recorded content. WebDroid currently supports `note`, but maps `call_api` to takeover/unsupported.

Recommendation: let `note` append to thread memory with a typed event, and implement `call_api` as an internal summarization/extraction step that does not touch the device. This can reuse the existing final-response model path.

Why it matters: it moves compatibility from "we do not crash on legacy action names" to "the action has equivalent behavior."

### 7. Add optional Manager/Executor reasoning mode

mobilerun has Direct/Fast mode and Reasoning mode. WebDroid has a single runner that chooses one next action per step and has useful recovery guards, but no separate planner/executor split.

Recommendation: keep the current runner as "direct mode"; add a second mode where a manager produces a compact plan/subgoal and the executor returns the next action. Persist plan, subgoal, and progress summary in `AgentThread`.

Why it matters: this is a larger feature, but it is the architectural difference users will notice on long tasks.

### 8. Add custom tools and safe secret typing as separate concepts

mobilerun supports custom tools, credentials, and `type_secret`. WebDroid has a generic `ActionToolRegistry`, but the registry is static and all actions are phone actions. API keys are stored in browser settings, and app credentials are not modeled.

Recommendation: first split phone tools from non-device tools in the registry. Then add local-only secret records and a `type_secret` action that never sends secret values to the model.

Why it matters: this brings WebDroid closer to mobilerun's extensibility without exposing secrets in prompts.

### 9. Treat observability events as a public schema

mobilerun streams typed manager, executor, screenshot, tool, and result events. WebDroid has `AgentThreadEvent`, run logs, and step timelines, but they are not positioned as an external event stream or export schema.

Recommendation: name and document a stable `WebDroidEvent` schema. Map current thread events and run-log entries into it, then use the same schema for trajectory export and future WebSocket/automation hooks.

Why it matters: it makes the UI, persistence, and diagnostics all speak one language.

### 10. Clean up small structure and naming issues before the next feature wave

The current refactor improved separation a lot, but several tiny readability issues will compound if the project moves toward the reference projects:

- `src/lib/actions.ts` is now mostly a compatibility re-export. Consider replacing it with `src/lib/actions/index.ts` or importing directly from `actionParser`, `actionPreview`, and `actionTypes`.
- `src/lib/actions.test.ts` tests parser, validation, and preview behavior. Consider splitting into `actionParser.test.ts` and `actionPreview.test.ts`.
- `src/lib/agent.ts` still owns runner orchestration, final-response generation, loop guards, and prompt/model plumbing. If Manager/Executor is added, move this into `src/lib/agent/runner.ts`, `src/lib/agent/finalResponse.ts`, and `src/lib/agent/loopGuard.ts`.
- `src/lib/appCards.ts` mixes data and lookup logic. Split data from resolver before adding custom cards.
- README structure references compatibility-export files such as `deviceBackend.ts`; the current worktree no longer contains that file. Sync docs with the actual file tree.

## Suggested Order

1. Documentation and naming hygiene: sync README tree, split action tests, clarify protocol terminology.
2. Protocol parity: add explicit protocol mode and mobilerun XML parser.
3. State quality: add optional `uiautomator dump` UI hierarchy and indexed actions.
4. Debuggability: add trajectory export/import using the existing thread event model.
5. Advanced parity: add real `call_api`, structured output, custom tools, safe secrets, and Manager/Executor mode.

## Non-Goals For Now

- Full iOS parity. Both reference projects support iOS paths, but WebDroid's browser-first WebUSB premise is Android-centered.
- HarmonyOS HDC support. Open-AutoGLM has HDC paths, but WebDroid's current dependency stack is WebADB.
- Replacing WebADB with a Portal app. A Portal-like mode could be optional later, but the current project's distinct advantage is no companion app beyond ADB Keyboard.
