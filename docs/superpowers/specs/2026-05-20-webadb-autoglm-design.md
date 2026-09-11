# WebDroid Agent Design

## Goal

Build a pure frontend app that connects to one Android device through WebADB, sends screenshots to a user-provided OpenAI-compatible vision model, parses a constrained JSON action, and executes that action in the browser.

## Scope

The app runs locally in Chromium through Vite. It has no application backend. Users provide `Base URL`, `API Key`, `Model`, and a natural-language task in the UI. API keys are kept in browser state/local storage only for local experimentation.

## Architecture

- `WebAdbDeviceBackend` owns WebUSB device selection, ADB authentication, screenshots, and shell-based input commands.
- `openAiClient` builds and sends `/v1/chat/completions` requests with screenshot data URLs and a strict action contract.
- `agent` coordinates screenshot -> model -> parse -> validate -> execute -> repeat.
- `App` provides configuration, device controls, task controls, action review, logs, and safety switches.

## Action Contract

The model must return one JSON object:

```json
{
  "action": "tap",
  "x": 540,
  "y": 1280,
  "reason": "Click the search field"
}
```

Supported actions are `launch`, `tap`, `swipe`, `input_text`, `key`, `back`, `home`, `long_press`, `double_tap`, `wait`, `take_over`, `note`, and `done`. The parser also accepts Open-AutoGLM names such as `Launch`, `Tap`, `Type`, `Swipe`, `Back`, `Home`, `Long Press`, `Double Tap`, `Wait`, and `Take_over`. Unknown actions, missing fields, malformed JSON, out-of-bounds coordinates, and unsafe shell strings are rejected before execution.

## Safety Boundaries

Auto-run is optional. Manual review shows the next action before execution. A stop button aborts the loop. A max step limit prevents runaway sessions. High-risk use remains out of scope for this app.

## Constraints

The browser must support WebUSB. The page must run on `localhost` or HTTPS. The OpenAI-compatible API must allow browser CORS requests. Android must have USB debugging enabled and the device must authorize the browser-generated ADB key.

## Verification

Unit tests cover action parsing, action validation, prompt/request construction, and shell command generation. Build verification covers TypeScript and Vite bundling. Real device behavior requires manual verification with an Android device.
