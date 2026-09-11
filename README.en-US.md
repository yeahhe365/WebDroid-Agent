<p align="center">
  <img src="./public/webdroid-agent-logo-128.png" alt="WebDroid Agent logo" width="96" />
</p>

# WebDroid Agent

<p align="center">
  <a href="./README.md">中文</a> | <a href="./README.en-US.md">English</a>
</p>

WebDroid Agent is a browser-first Android phone agent experiment. In static deployments, it runs entirely on the frontend. It connects to an Android device from the browser through WebUSB/WebADB, captures the device screen, sends it to an OpenAI-compatible vision model, then parses, validates, and executes the model's constrained action through ADB. Docker deployments add a local Node API proxy so model requests go through the container instead of directly from the browser.

The goal is not to replace long-running human supervision. It is a local browser environment for quickly validating the vision-model-plus-phone-control loop.

```text
Chromium WebUSB -> Tango/WebADB -> Android ADB
Static deployment:
  Official OpenAI: browser fetch -> /v1/responses -> vision model
  Other providers: browser fetch -> /v1/chat/completions or Gemini generateContent
Docker:
  browser fetch -> same-origin local proxy (/chat/completions or /responses) -> model API
```

## What It Can Do

- Run entirely on the frontend for static deployments such as Cloudflare Pages.
- Use the built-in same-origin local API proxy in Docker deployments to avoid model-provider browser CORS limits.
- Connect to an Android device with USB debugging enabled through WebADB in the browser.
- Capture the phone screen and send the screenshot, current app, device state, full installed-app list, and step history to the model.
- Use WebDroid JSON-family action protocols and canonical JSON action format: `webdroid_json` uses screenshot pixels, while `webdroid_normalized_json` uses Vision-Pointer-style 0-1000 normalized coordinates.
- Parse, normalize, and validate the next action returned by the model.
- Execute app launches, taps, swipes, text input, Back, Home, long press, double tap, and wait actions through ADB, including model-controlled wait duration.
- Support clear-before-type input, fixed post-action settle delay, transient model API and empty-model-response retries, and limited automatic recovery from non-sensitive execution failures.
- Support editable App Cards, local Custom Tools, and safe Secret typing that exposes only IDs/labels to the model.
- Support continuous auto-execution as well as step-by-step human confirmation.
- Send chat messages to run automatically, with one-step planning kept in advanced debug controls.
- Support sensitive-action confirmation, unrestricted mode, max-step limits, stop controls, and advanced reset/run-log export.
- Persist page settings in the local browser `localStorage`, and persist agent thread/turn history in IndexedDB.

## Good Fits

This project is a good fit for:

- Testing whether an OpenAI-compatible vision model can understand real Android UI.
- Debugging the phone-agent JSON action format, coordinate mapping, and auto-execution loops.
- Building Android UI automation prototypes in a local and controlled environment.

It is not a good fit for:

- Payments, checkout flows, deletions, authorization, or account settings.
- Login, captcha, password, or verification-code flows that need explicit human intervention.
- Production use cases that require a backend, long-running reliability, or multi-device orchestration.

## Flow

1. Open the app in a Chromium-based browser.
2. Connect an Android device with USB debugging enabled and authorize ADB on the phone.
3. Fill in the OpenAI-compatible `Base URL`, `API Key`, and `Model`.
4. Type a natural-language instruction in the chat, such as "Open Settings and go to Wi-Fi".
5. Sending the message captures the screen and asks the model for one action.
6. The frontend parses and validates the action, then executes safe actions automatically while sensitive actions ask for confirmation by default.
7. If a non-sensitive action execution fails, the failure feedback is added to the next model context and the model gets a small number of automatic recovery attempts.
8. The loop continues until the model returns `done`, requests `take_over`, the max step count is reached, or the user stops execution; unrestricted mode does not stop on `take_over`.

## Requirements

- A Chromium-based browser with WebUSB support, such as Chrome or Edge.
- An Android device with USB debugging enabled.
- A USB data cable.
- A vision model API: **Official OpenAI** (`/v1/responses`, default model `gpt-5.6`), **OpenAI-compatible** `/v1/chat/completions`, **Qwen** compatible endpoint, or **Gemini** native `generateContent`.
- A vision model that accepts screenshot/image input.
- For static deployments, an API service configured to allow browser cross-origin requests. Docker deployments can avoid this for OpenAI official and compatible providers through the same-origin local proxy (Gemini still calls Google directly).
- A `localhost` or HTTPS environment so WebUSB can work.

## Quick Start

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite in Chrome or Edge.

Common commands:

```bash
npm test
npm run lint
npm run build
npm run build:server   # required for Docker / npm start proxy
npm run preview
```

## Configuration

The app stores these values in the current browser's `localStorage`:

- `Provider`: provider preset. `OpenAI` uses the Responses API; `OpenAI Compatible` / `Qwen` use chat completions; `Gemini` uses native generateContent.
- `Base URL`: model API endpoint. Official OpenAI defaults to `https://api.openai.com/v1`; Qwen/Gemini have their own presets.
- `API Key`: model API key.
- `Model`: model name. Official OpenAI defaults to `gpt-5.6`; the compatible fallback default remains `gpt-5.5`.
- `Thinking depth` / reasoning options: `reasoning_effort` for compatible endpoints; official OpenAI also supports reasoning mode (standard/pro) and reasoning summary; Qwen/Gemini use their own thinking budget or thinking level.
- `Action protocol`: model action protocol. `webdroid_json` uses screenshot pixel coordinates; `webdroid_normalized_json` uses 0-1000 normalized coordinates.
- `Max steps`: maximum auto-execution steps, default `150`.
- `Confirm sensitive actions`: whether sensitive taps require human confirmation, default on.
- `Unrestricted mode`: bypass local safety policy and sensitive confirmations, and prompt the model not to request human takeover.
- `Stream responses`: whether to use streaming responses, default off.
- `Use ADB Keyboard for text`: whether to prefer ADB Keyboard input, default off.
- `Action settle`, `Double tap interval`, `Keyboard step`: timing controls for action execution and text input.
- `App Cards`: package-name keyed editable app context cards; Chrome, Gmail, and Settings are built in by default.
- `Secrets`: local secret records; the model sees only `id` and `label`, and `type_secret` resolves the value locally at execution time.
- `Custom Tools`: local tool definitions; the model sees only tool names/descriptions, and local results are returned into later context.

The API key stays in the browser only for static deployments. Docker deployments send model requests to the same-origin local proxy first, then the container's Node service forwards them to the configured model API so the browser does not need CORS access to the model provider.

## Docker Deployment

The Docker image builds the same frontend app and enables a small local Node service (TypeScript compiled to `dist-server/`):

- WebUSB/WebADB still runs in the browser.
- The frontend posts through the same-origin `/api/openai/chat/completions` proxy envelope. Official OpenAI sets the upstream path to `/responses` inside that envelope; compatible providers use `/chat/completions`.
- The Node service reads the request `Base URL`, `API Key`, and payload, then forwards them to the model API.
- The Gemini preset bypasses this proxy and calls Google directly from the browser.
- Cloudflare Pages does not use this Node service and does not set the proxy build variable, so the hosted static app still calls the configured model API directly from the browser.

Build and run:

```bash
npm run docker:build
docker run --rm -p 8080:8080 webdroid-agent
```

Then open this URL in Chrome or Edge:

```text
http://localhost:8080/
```

If you use the repository Docker Compose config:

```bash
docker compose up -d --build
```

Then open:

```text
http://localhost:8083/
```

You do not need to pass the API key as an environment variable. Continue entering it in the model settings panel. Do not expose this container proxy directly to an untrusted public network because it forwards arbitrary OpenAI-compatible `Base URL` values submitted by the browser.

### Proxy hardening (optional)

The defaults are deliberately conservative: the published port binds to `127.0.0.1` on the host, the process inside the container listens on `0.0.0.0` so the port mapping works, and the server itself defaults to a loopback bind. For shared networks or stricter setups:

| Variable | Effect |
| --- | --- |
| `PROXY_TOKEN` | When set, proxy requests must carry `x-proxy-token: <token>` or `Authorization: Bearer <token>`; otherwise the proxy answers 401. |
| `PROXY_ALLOW_HOSTS` | Comma-separated upstream host allowlist (e.g. `api.openai.com,dashscope.aliyuncs.com`; supports `host:port` and `*.example.com`). Non-matching `Base URL` hosts receive 403. |
| `CSP_CONNECT_SRC` | Extra space-separated origins appended to the frontend `Content-Security-Policy` `connect-src`, for custom OpenAI-compatible provider endpoints. |
| `HOST` | Server listen address, default `127.0.0.1`; the Docker image sets `0.0.0.0`. |

Example:

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  -e PROXY_TOKEN=change-me \
  -e PROXY_ALLOW_HOSTS=api.openai.com,dashscope.aliyuncs.com \
  webdroid-agent
```

It is still recommended not to expose the proxy to an untrusted public network.

## Action Protocol

The model should return a single JSON object and avoid Markdown or explanatory prose:

```json
{ "action": "tap", "x": 540, "y": 1280, "reason": "Click the search box" }
```

Only WebDroid JSON-family protocols are currently available:

- `webdroid_json`: touch coordinates are pixels in the attached screenshot.
- `webdroid_normalized_json`: touch coordinates are Vision-Pointer-style 0-1000 normalized coordinates with the top-left origin. They are mapped back to model screenshot pixels, then to native device pixels before execution.

Recommended canonical JSON actions:

| Action | Meaning |
| --- | --- |
| `launch` | Launch an app by common app name or package name |
| `tap` | Tap a screen coordinate |
| `swipe` | Swipe from one point to another |
| `input_text` | Type text; `clear:true` clears the currently focused field first |
| `type_secret` | Type a local secret; the model sends only `secretId` and never sees the value |
| `open_url` | Open a web URL or app deep link with Android `ACTION_VIEW` |
| `set_clipboard` | Set WebDroid clipboard text and best-effort sync it to the device clipboard |
| `paste` | Paste/type WebDroid clipboard text into the current focus |
| `custom_tool` | Run a locally configured Custom Tool |
| `key` | Send an Android key such as `BACK`, `HOME`, or `ENTER` |
| `back` | Navigate back |
| `home` | Return to the home screen |
| `long_press` | Long-press a coordinate |
| `double_tap` | Double-tap a coordinate |
| `wait` | Wait for a duration, preferably with `duration` in seconds |
| `take_over` | Request human takeover |
| `note` | Record an observation without touching the device |
| `done` | Mark the task as complete |

Examples:

```json
{ "action": "launch", "app": "Settings", "reason": "Open system settings" }
```

```json
{ "action": "swipe", "fromX": 540, "fromY": 1700, "toX": 540, "toY": 500, "durationMs": 400, "reason": "Scroll the list down" }
```

```json
{ "action": "take_over", "message": "The user needs to enter a verification code" }
```

```json
{ "action": "type_secret", "secretId": "gmail_password", "clear": true, "reason": "Type the configured local password" }
```

```json
{ "action": "open_url", "url": "https://example.com/search?q=webdroid", "reason": "Open the target page directly" }
```

The legacy compatibility layer still accepts `interact` and `call_api`, but they are not recommended real execution actions. `interact` is converted to `take_over`; `call_api` is converted to `take_over` with an unsupported-second-API-call message.

## Device Control Details

- Launching apps: prefer the device's installed-app list, and also support built-in common app-name mappings or direct Android package names.
- Tap and swipe: coordinates are validated against the screen bounds before execution.
- Screen tree: each step best-effort reads `uiautomator dump --compressed` and injects visible text, descriptions, resource ids, clickable state, and bounds into the model context.
- Opening URLs: uses Android `am start -a android.intent.action.VIEW -d <url>` for web URLs and registered deep links.
- Long press: simulated with Android `input swipe x y x y duration`.
- Double tap: two taps with a configurable delay in between.
- Text input: simple ASCII text uses Android `input text`.
- Clear-before-type, Chinese, and complex text: use ADB Keyboard or AutoGLM Keyboard broadcast input.
- Clipboard: `set_clipboard` stores a local WebDroid clipboard and tries `cmd clipboard set`; `paste` prefers the local clipboard through the current text-input channel.
- ADB Keyboard mode requires `com.android.adbkeyboard/.AdbIME` to be installed and enabled on the device; the device panel provides install and enable controls.
- After every device action, the app waits according to the `Action settle` setting so the next step is less likely to run during animation or page loading.

## Safety Boundaries

The frontend tries to constrain and confirm actions before execution:

- Model output must parse into a supported action.
- Coordinates are checked against the screen bounds.
- Text input is length-limited and control characters are rejected.
- `type_secret` receives only a local secret ID from the model; real secret values are not sent to model requests or result summaries.
- Auto-execution has a maximum step count.
- The user can stop the run at any time.
- Sensitive taps can require human confirmation; unrestricted mode skips those confirmations.
- `take_over`, `note`, and `done` do not directly control the device; legacy `interact` and `call_api` are converted to human takeover unless unrestricted mode is enabled.
- In Docker/Node deployments the server binds to loopback by default and can be further restricted with `PROXY_TOKEN` and `PROXY_ALLOW_HOSTS` (see "Docker Deployment · Proxy hardening").
- Server responses carry CSP, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`; the CSP `connect-src` list can be extended with `CSP_CONNECT_SRC`.

It is still strongly recommended to avoid letting the agent handle account login, payments, checkout, deletions, authorization, verification codes, or privacy-sensitive pages. By default, when the model returns `take_over`, auto-execution stops and waits for a human; unrestricted mode does not stop on takeover requests.

## Project Structure

```text
src/
  adapters/
    adbKeyboard.ts            # ADB Keyboard install, detection, and encoding helpers
    appPackages.ts            # common app-name to package-name mappings
    deviceParsers.ts          # dumpsys and screenshot byte parsing
    deviceRetry.ts            # device-read retry and delay helpers
    deviceTiming.ts           # device execution timing defaults
    deviceTypes.ts            # shared device backend types and errors
    inputCommands.ts          # ADB input command building
    installedApps.ts          # installed-app parsing, search, and display names
    sensitiveActions.ts       # sensitive action confirmation
    screenshotPreprocess.ts   # screenshot preprocessing
    stayAwakeCommands.ts      # stay-awake commands while ADB is connected
    webAdbBackend.ts          # WebADB/WebUSB implementation
  components/
    AgentStepCard.tsx         # agent step card
    AppTopbar.tsx             # brand and status topbar
    ChatHistorySidebar.tsx    # chat-history sidebar
    ChatPanel.tsx             # chat transcript and composer shell
    ConfigRail.tsx            # collapsed configuration shortcuts
    ConfigSidebar.tsx         # device and model configuration sidebar composition
    ConversationPanel.tsx     # chat, history, and pending action view
    DeviceOptionsSection.tsx  # device input, confirmation, and timing options
    DevicePanel.tsx           # device connection and execution settings panel
    DirectCommandsSection.tsx # direct ADB action panel
    InstalledAppsSection.tsx  # installed-app search and launch controls
    LazyDetails.tsx           # lazily rendered collapsible sections
    MarkdownContent.tsx       # chat message Markdown rendering
    ModelPanel.tsx            # model configuration panel
    PendingActionCard.tsx     # pending action confirmation card
    PhoneStage.tsx            # phone screenshot and action overlay
    RunLog.tsx                # run log view
    ScreenshotLightbox.tsx    # screenshot preview modal
    SettingsDialog.tsx        # app settings, repository info, and editable resources
    SetupHome.tsx             # first-run device/model setup onboarding
    TutorialPanel.tsx         # quick-start tutorial expanded from the topbar
  hooks/
    useAgentRunController.ts        # auto-run and pending-action control
    useAgentSessionHistory.ts       # session restore, persistence, and history state
    useBusyTask.ts                  # busy-task and error state management
    useConfigTargetScroll.ts        # config sidebar target scrolling
    useDeviceBackendPreferences.ts  # device backend preference sync
    useDeviceController.ts          # device connection, screenshot, and direct action state
    useDisplayImageUrl.ts           # screenshot blob URL lifecycle
    useDocumentPreferences.ts       # document theme and language attribute sync
    useLatestValue.ts               # ref for reading latest values inside async callbacks
    usePersistedSettings.ts         # settings persistence on changes
    useRepositoryStats.ts           # GitHub repository stats loading for settings
    useRunLog.ts                    # run-log state management
    useStorageEstimate.ts           # local storage quota estimate
    useVirtualWindow.ts             # virtual window for long lists
  lib/
    actionDefaults.ts         # common screenshot action defaults
    actionParser.ts           # action parsing, normalization, and validation
    actionPreview.ts          # action preview text formatting
    actionProtocol.ts         # explicit action protocol enum
    actionSafetyPolicy.ts     # local action safety policy
    actionTypes.ts            # action types and validation error definitions
    agentResources.ts         # local Secret and Custom Tool resources
    agent.ts                  # agent loop orchestration
    agentThread.ts            # persistent agent thread/turn/event model
    appCards.ts               # editable app context cards
    appCopy.ts                # localized copy aggregation and locale resolution
    appCopy.en-US.ts          # English UI copy
    appCopy.zh-CN.ts          # Chinese UI copy
    busyTask.ts               # in-page busy task identifiers
    contextBuilder.ts         # model context building and compaction
    deviceDoctor.ts           # device and model configuration diagnostics
    deviceState.ts            # device state display formatting
    interactionStream.ts      # combined chat message and agent step display stream
    openAiClient.ts           # OpenAI-compatible chat completions client
    openAiErrors.ts           # OpenAI client error types
    openAiPayload.ts          # OpenAI-compatible request payload building
    openAiResponse.ts         # OpenAI-compatible response reading and error formatting
    openAiResponsesClient.ts  # official OpenAI Responses API client
    openAiResponsesTypes.ts   # Responses API request/response types
    openAiRuntimeConfig.ts    # OpenAI request runtime configuration
    openAiTypes.ts            # OpenAI client and message types
    modelProviders.ts         # provider presets (OpenAI / Qwen / Gemini)
    promptContextFormatting.ts # model context formatting helpers
    prompts.ts                # prompts and action rules
    repository.ts             # repository links and GitHub stats parsing
    runLogEntries.ts          # run-log entry and screenshot-view formatting
    screenshot/               # screenshot coordinates, context, and retention policy
      coordinates.ts
      index.ts
      retention.ts
    settings.ts               # local settings persistence
    threadStore.ts            # agent thread persistent storage
    toolRegistry.ts           # agent action tool registration and execution
  styles/                    # styles split by page area
    agent-step-card.css      # agent step-card styles
    chat-composer.css        # chat composer styles
    chat-history.css         # chat-history sidebar styles
    chat-panel.css           # chat panel styles
    compact-section.css      # collapsible tool-section styles
    config-panel.css         # device and model configuration panel styles
    config-rail.css          # collapsed config rail styles
    controls.css             # forms, buttons, and shared control styles
    conversation-panel.css   # conversation-panel shell and pending-action styles
    device-doctor.css        # device doctor result styles
    device-options.css       # device execution option styles
    device-panel.css         # device connection section styles
    direct-commands.css      # direct command panel styles
    index.css                # global style entrypoint
    installed-apps.css       # installed-app list styles
    layout.css               # page layout and panel frames
    markdown-content.css     # Markdown content styles
    model-panel.css          # model configuration section styles
    phone-stage.css          # phone preview and action-overlay styles
    responsive.css           # responsive layout adjustments
    run-log.css              # run-log styles
    screenshot-lightbox.css  # screenshot preview modal styles
    settings-dialog.css      # settings dialog styles
    setup-home.css           # setup onboarding styles
    theme.css                # theme tokens and base reset
    tutorial-panel.css       # tutorial panel styles
  App.tsx                     # page state, workflow logic, and component composition
  main.tsx                    # React entrypoint and global style loading
server/
  index.ts                    # static-file and API proxy server for Docker (builds to dist-server/)
  openAiProxy.ts              # local OpenAI-compatible / Responses proxy handler
```

## Verification

```bash
npm test
npm run lint
npm run build
npm run build:server
```

The current tests mainly cover:

- Action parsing and action safety validation.
- OpenAI-compatible and Responses API request payload construction, response parsing, and network client errors.
- Docker local proxy forwarding constraints for `/chat/completions` and `/responses`.
- Single-step and continuous agent execution.
- Failure feedback, transient model API and empty-model-response retries, and limited automatic recovery.
- Settings persistence and compatibility migration.
- Agent thread/turn persistence.
- Installed-app parsing, matching, and full context injection.
- Screenshot coordinate mapping.
- The run-log, screenshot preview, and main layout components.

Real-device control still needs manual verification with an Android device.

## Deploying to Cloudflare Pages

The project is already set up on Cloudflare Pages:

- Historical live site (legacy Pages hostname): https://webadb-autoglm.pages.dev/
- Deployment method: automatic deployment from GitHub

Redeploy:

```bash
git push origin main
```

You can also verify the build locally first:

```bash
npm run build
```

Cloudflare Pages should keep using plain `npm run build` without `VITE_OPENAI_PROXY_URL`. That keeps the hosted static app on browser-direct model API requests and avoids depending on the Docker-only local Node proxy.

## License

This project is open source under the [MIT License](./LICENSE). You may use, copy, modify, distribute, and build on the code, provided that the original copyright notice and license text are retained.

Third-party dependencies remain subject to their own licenses. Please review dependency license terms before redistribution or commercial use.

## Related Projects and Community

- [Tango / WebADB](https://github.com/yume-chan/ya-webadb): the browser-side ADB/WebUSB foundation.
- Linux.do: an active Chinese tech community centered on AI, software development, resource sharing, and current industry discussion.
