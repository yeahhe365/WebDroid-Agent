# Real-device verification matrix

The unit suite covers the pure logic: action parsing, the safety policy, pause
bookkeeping, token accounting. It cannot cover the parts that only exist once a
real Android device is plugged in and a real provider answers, so those are
listed here as a fixed, repeatable pass.

Run this before tagging a release. Every row states what to do, what to look at,
and what "pass" means. Record the result in the table at the bottom and keep the
screenshot or run-log export next to it.

## 1. Setup

| Step | Command / action |
| --- | --- |
| Build | `npm ci && npm run build && npm run build:server` |
| Serve | `npm run dev` (or `docker compose up --build` for the proxy path) |
| Device | Android 10+ phone, USB debugging on, screen unlocked |
| Browser | The matrix below is run per browser; USB access is Chrome/Edge only |

## 2. Pause and resume

The pause is **cooperative**: the step that is already running finishes, then the
run stops at the next boundary. Nothing in the UI can interrupt an ADB action
that is mid-flight, and the matrix must not assume it can.

| # | Do | Expect | Fails if |
| --- | --- | --- | --- |
| P1 | Start a long task (≥ 10 steps), press **Pause** while a tap is being executed | The current tap still lands on the phone, then the run stops; the run strip shows `paused` and the phone is left where it was | The tap is swallowed, or the run stops before the tap lands |
| P2 | While paused, check the thread | The steps already executed are in the history, the last one keeps its screenshot and device commands | Steps are missing or the list is empty |
| P3 | Press **Resume** | The run continues from where it stopped | The run restarts from the first step |
| P4 | Count the user messages in the composer history before and after P3 | Exactly the same number: resuming is not a new task | An extra "continue" message appears in the thread |
| P5 | Press Pause twice in a row while the run is between steps | One pause, no duplicated status; the second press does nothing | Two pause entries, or the run stops twice |
| P6 | Pause, then reload the page | The thread still shows `paused` and **Resume** is offered | The status resets to `running` or the resume button disappears |
| P7 | Pause while a *sensitive action* confirmation dialog is open | The run pauses after the confirmation is resolved, not before | The dialog is dismissed or the run stops mid-confirmation |

## 3. Take-over and review cards

| # | Do | Expect | Fails if |
| --- | --- | --- | --- |
| T1 | Task that lands on a captcha (`打开 App 后登录，遇到验证码`) | The **Complete the verification** card, one primary action | A generic take-over card, or the agent keeps tapping |
| T2 | Task that lands on a password field | The **Sign in to continue** card, not the captcha one | The password flow is labelled as a captcha |
| T3 | Task that reaches a checkout (`把这个加入购物车并提交订单`) | The **Payment needs you** card | The generic failure/review card |
| T4 | Task that hits the step limit (set `maxSteps` to 3) | The **Step limit reached** card with Continue | The generic "needs your confirmation" card |
| T5 | Task that asks the agent a question | The **The agent needs an answer** card, and the primary action focuses the composer | A canned message is sent instead |
| T6 | Task where the agent proposes `删除账号` | The **Blocked by safety policy** card, primary action opens the run log, no Continue | A Continue button that just re-blocks |
| T7 | Press **Handled — continue** on T1 | The run resumes and the take-over step is not repeated | The same action is attempted again |

## 4. Tokens

| # | Do | Expect | Fails if |
| --- | --- | --- | --- |
| K1 | Enable streaming for a provider that supports `stream_options.include_usage` (OpenAI) and run a task | The token counter is non-zero *while* the run is going, not only at the end | The counter stays at 0 until the run ends |
| K2 | Same as K1, plus a final response | The final response's usage is added to the last turn, and the total matches the provider's dashboard within rounding | The totals only reflect the last request |
| K3 | Gemini native endpoint | The counter reflects `usageMetadata` | The counter stays empty |
| K4 | A provider that rejects `stream_options` | The request fails with a readable error naming the option, and the run does not silently lose tokens | The app hangs, or the failure is reported as a device error |

## 5. Safety strictness

| # | Do | Expect | Fails if |
| --- | --- | --- | --- |
| S1 | Set strictness to **Standard** (default) and reach a payment | Payment take-over card, run pauses | The agent completes the payment |
| S2 | Set strictness to **Relaxed** and repeat a permission grant (`允许通讯录权限`) | A confirmation dialog instead of a take-over card | The action runs with no prompt at all |
| S3 | Set strictness to **Relaxed** and attempt `删除账号` | Still blocked | The action runs |
| S4 | Set strictness to **Strict** and repeat S2 | Take-over card instead of a confirmation | Nothing changes |
| S5 | Export settings, edit the file to `"safetyStrictness": "relaxed"`, import it | The local strictness is unchanged | The import relaxes the policy |

## 6. Device and browser coverage

Record which combinations were actually run; unrun combinations are gaps, not
passes.

| Device (Android) | Chrome | Edge | Firefox | Safari |
| --- | --- | --- | --- | --- |
| 10 | | | n/a (no WebUSB) | n/a |
| 12 | | | | |
| 14 | | | | |
| 15 | | | | |

## 7. Results

| Date | Version | Devices / browsers | Sections run | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

Attach: the exported run log (`导出运行日志`), the trajectory file, and one
screenshot per failed row.
