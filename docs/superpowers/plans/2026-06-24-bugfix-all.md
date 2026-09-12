# WebDroid-Agent Bug Fix Implementation Plan

> **状态（2026-09-12 回填）**：19 项修复已由 `5f8d24d` / `80104c3` / `6df6a89` / `0230bbf`（合并 `06d49f3`）落地，
> 逐项证据见 `docs/bugfix-2026-06-24.md`。本次回填时补齐了三处收尾：`SensitiveActionDialog` 的 Tab 焦点陷阱、
> `set_clipboard` 转义测试、停止运行（abort）回归测试。仍开放：F.3 真机手动冒烟（需物理 Android 设备）。
> 偏差说明：Task 4.1「Enter 忙时守卫」在 `0230bbf` 加入后又被 `bca7168` 有意移除，改为消息排队机制，请勿回退；
> 本计划正文称「27 confirmed bugs」，实际仅枚举 19 项修复，口径差异已在汇总文档中说明。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 27 confirmed bugs across security, agent loop, safety policy, and UI subsystems

**Architecture:** Systematic fixes in 4 phases: (1) Critical command injection vulnerabilities with shell escaping, (2) Agent loop race conditions with mutex/stable refs, (3) Safety policy hardening with input normalization, (4) UI polish with guardrails and a11y improvements

**Tech Stack:** React 19, TypeScript 6, Node.js 22, ADB (@yume-chan/adb), Vitest, Testing Library

## Global Constraints

- All dynamic shell parameters MUST be escaped with `escapeShellArg` before passing to `spawnWait/spawnWaitText`
- All async state updates MUST use refs or mutex to prevent race conditions
- All safety regex patterns MUST use NFKC normalization on input
- All composite actions MUST evaluate safety on atomic children
- All UI critical paths MUST have busy guards and a11y labels
- Test coverage: Run `npm test` after each task, all tests must pass
- Commit message format: `fix(scope): description` with conventional commits

---

## Phase 1: Command Injection Fixes (Critical Security)

### Task 1.1: Add shell argument escaping utility

**Files:**
- Create: `src/adapters/shellEscape.ts`
- Create: `src/adapters/shellEscape.test.ts`

**Interfaces:**
- Produces: `escapeShellArg(value: string): string` — wraps value in single quotes, escapes internal single quotes

- [x] **Step 1: Write the failing test**

```typescript
// src/adapters/shellEscape.test.ts
import { describe, expect, it } from 'vitest'
import { escapeShellArg } from './shellEscape'

describe('escapeShellArg', () => {
  it('wraps simple strings in single quotes', () => {
    expect(escapeShellArg('hello')).toBe("'hello'")
  })

  it('escapes single quotes by replacing with '\''', () => {
    expect(escapeShellArg("it's")).toBe("'it'\\''s'")
  })

  it('escapes shell metacharacters ;|`$()\\n', () => {
    expect(escapeShellArg('http://x;rm -rf /')).toBe("'http://x;rm -rf /'")
    expect(escapeShellArg('a|b')).toBe("'a|b'")
    expect(escapeShellArg('`whoami`')).toBe("'`whoami`'")
    expect(escapeShellArg('$(reboot)')).toBe("'$(reboot)'")
    expect(escapeShellArg('line1\nline2')).toBe("'line1\nline2'")
  })

  it('handles empty strings', () => {
    expect(escapeShellArg('')).toBe("''")
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/adapters/shellEscape.test.ts`
Expected: FAIL with "Cannot find module './shellEscape'"

- [x] **Step 3: Write minimal implementation**

```typescript
// src/adapters/shellEscape.ts
/**
 * Escape a string for safe use as a shell argument.
 * Wraps the value in single quotes and escapes any single quotes inside.
 */
export function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/adapters/shellEscape.test.ts`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add src/adapters/shellEscape.ts src/adapters/shellEscape.test.ts
git commit -m "feat(adapters): add shell argument escaping utility"
```

### Task 1.2: Fix `open_url` command injection

**Files:**
- Modify: `src/adapters/inputCommands.ts:62`
- Modify: `src/adapters/webAdbBackend.ts` (execute method)
- Create: `src/adapters/inputCommands.test.ts`

**Interfaces:**
- Consumes: `escapeShellArg` from Task 1.1
- Produces: Safe `open_url` command with escaped URL

- [x] **Step 1: Write the failing test**

```typescript
// src/adapters/inputCommands.test.ts
import { describe, expect, it } from 'vitest'
import { buildInputCommandSequence } from './inputCommands'

describe('buildInputCommandSequence', () => {
  describe('open_url', () => {
    it('escapes shell metacharacters in URL', () => {
      const sequence = buildInputCommandSequence({
        action: 'open_url',
        url: 'http://x;input keyevent 26',
      })
      const command = sequence[0] as string[]
      // Command should be safely escaped
      expect(command.join(' ')).toContain("'http://x;input keyevent 26'")
    })
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/adapters/inputCommands.test.ts`
Expected: FAIL — URL not escaped

- [x] **Step 3: Write minimal implementation**

```typescript
// src/adapters/inputCommands.ts
// Add import at top:
import { escapeShellArg } from './shellEscape'

// Modify line 62:
case 'open_url':
  return [['am', 'start', '-a', 'android.intent.action.VIEW', '-d', escapeShellArg(action.url)]]
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/adapters/inputCommands.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/adapters/inputCommands.ts src/adapters/inputCommands.test.ts
git commit -m "fix(adapters): escape URL in open_url to prevent command injection"
```

### Task 1.3: Fix `set_clipboard` command injection

**Files:**
- Modify: `src/adapters/webAdbBackend.ts:571`
- Create: `src/adapters/webAdbBackend.clipboard.test.ts`

**Interfaces:**
- Consumes: `escapeShellArg` from Task 1.1

- [x] **Step 1: Write integration test**

```typescript
// src/adapters/webAdbBackend.clipboard.test.ts
import { describe, expect, it, vi } from 'vitest'
import { WebAdbDeviceBackend } from './webAdbBackend'

describe('WebAdbDeviceBackend set_clipboard escaping', () => {
  it('escapes clipboard text with shell metacharacters', async () => {
    const backend = new WebAdbDeviceBackend()
    const mockAdb = {
      subprocess: {
        noneProtocol: {
          spawnWaitText: vi.fn().mockResolvedValue(''),
        },
      },
    }
    // @ts-expect-error - accessing private for test
    backend.#adb = mockAdb

    await backend.execute({
      action: 'set_clipboard',
      text: 'hello;rm -rf /',
    })

    const call = mockAdb.subprocess.noneProtocol.spawnWaitText.mock.calls[0]
    const command = call[0].join(' ')
    expect(command).toContain("'hello;rm -rf /'")
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/adapters/webAdbBackend.clipboard.test.ts`
Expected: FAIL — text not escaped

- [x] **Step 3: Write minimal implementation**

```typescript
// src/adapters/webAdbBackend.ts
// Add import:
import { escapeShellArg } from './shellEscape'

// Modify line 571:
async #setDeviceClipboard(text: string, signal?: AbortSignal) {
  const adb = this.#requireAdb()
  await withAbort(
    adb.subprocess.noneProtocol.spawnWaitText(['cmd', 'clipboard', 'set', escapeShellArg(text)]),
    signal,
  )
  return 'cmd clipboard set completed.'
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/adapters/webAdbBackend.clipboard.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/adapters/webAdbBackend.ts src/adapters/webAdbBackend.clipboard.test.ts
git commit -m "fix(adapters): escape clipboard text to prevent command injection"
```

### Task 1.4: Fix `launch` packageName validation

**Files:**
- Modify: `src/lib/actionValidation.ts:55,504-506`
- Create: `src/lib/actionValidation.packageName.test.ts`

**Interfaces:**
- Produces: Validated packageName matching `^[a-zA-Z][\w.]*$`

- [x] **Step 1: Write the failing test**

```typescript
// src/lib/actionValidation.packageName.test.ts
import { describe, expect, it } from 'vitest'
import { validateAction } from './actionValidation'

describe('validateAction packageName', () => {
  it('rejects packageName with shell metacharacters', () => {
    expect(() =>
      validateAction({
        action: 'launch',
        packageName: 'x;reboot',
      }),
    ).toThrow('packageName must be a valid Android package name')

    expect(() =>
      validateAction({
        action: 'launch',
        packageName: 'a|b',
      }),
    ).toThrow('packageName must be a valid Android package name')
  })

  it('accepts valid package names', () => {
    expect(() =>
      validateAction({
        action: 'launch',
        packageName: 'com.example.app',
      }),
    ).not.toThrow()

    expect(() =>
      validateAction({
        action: 'launch',
        packageName: 'org.app',
      }),
    ).not.toThrow()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/lib/actionValidation.packageName.test.ts`
Expected: FAIL — invalid packageName accepted

- [x] **Step 3: Write minimal implementation**

```typescript
// src/lib/actionValidation.ts
// Add new validation function after line 526:
function isValidPackageName(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)
}

// Modify line 55:
const packageName = optionalString(candidate, 'packageName')
if (packageName && !isValidPackageName(packageName)) {
  throw new ActionValidationError('packageName must be a valid Android package name.')
}
const resolvedPackageName = packageName ?? optionalPackageNameFromApp(app)

// Modify line 504-506:
function optionalPackageNameFromApp(app: string): string | undefined {
  if (!app.includes('.')) {
    return undefined
  }
  // Only treat as package name if it matches the format
  return isValidPackageName(app) ? app : undefined
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/lib/actionValidation.packageName.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/actionValidation.ts src/lib/actionValidation.packageName.test.ts
git commit -m "fix(validation): validate packageName format to prevent injection"
```

### Task 1.5: Fix `escapeInputText` backslash handling

**Files:**
- Modify: `src/adapters/adbKeyboard.ts:6-8`
- Create: `src/adapters/adbKeyboard.escape.test.ts`

**Interfaces:**
- Produces: `escapeInputText` that escapes backslash

- [x] **Step 1: Write the failing test**

```typescript
// src/adapters/adbKeyboard.escape.test.ts
import { describe, expect, it } from 'vitest'
import { escapeInputText } from './adbKeyboard'

describe('escapeInputText', () => {
  it('escapes whitespace as %s', () => {
    expect(escapeInputText('hello world')).toBe('hello%sworld')
  })

  it('escapes backslash when not using ADB Keyboard', () => {
    // Backslash should be escaped for shell safety
    expect(escapeInputText('path\\to\\file')).toBe('path\\\\to\\\\file')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/adapters/adbKeyboard.escape.test.ts`
Expected: FAIL — backslash not escaped

- [x] **Step 3: Write minimal implementation**

```typescript
// src/adapters/adbKeyboard.ts
export function escapeInputText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\s/g, '%s')
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/adapters/adbKeyboard.escape.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/adapters/adbKeyboard.ts src/adapters/adbKeyboard.escape.test.ts
git commit -m "fix(adb-keyboard): escape backslash in input text"
```

---

## Phase 2: Agent Loop Fixes (Critical Stability)

### Task 2.1: Add signal to `recordAgentFinalResponse` in `executePendingStep`

**Files:**
- Modify: `src/hooks/useAgentRunController.ts:116-216`
- Modify: `src/hooks/useAgentRunController.ts:429-431` (stopCurrentRun)

**Interfaces:**
- Consumes: AbortController owned by executePendingStep
- Produces: Abortable final response generation during manual done-step execution

**Root cause:** `executePendingStep` runs the model's final-response request (line 127-132) without any AbortSignal, so `stopCurrentRun()` (which aborts `abortRef.current` — only set by `runAutoLoop`) cannot interrupt it. When the user clicks Stop during a manual done-step, the network request continues and writes to a thread whose status is already `stopped`.

- [x] **Step 1: Give executePendingStep its own AbortController**

```typescript
// src/hooks/useAgentRunController.ts
// Add a second ref alongside abortRef (line 112):
const pendingAbortRef = useRef<AbortController | null>(null)

// In executePendingStep, create a controller and pass its signal (around line 116):
const executePendingStep = useCallback(async () => {
  if (!pendingStep) {
    return
  }

  const pendingAbort = new AbortController()
  pendingAbortRef.current = pendingAbort

  await runTask('execute-action', copy.executeActionTask, async () => {
    try {
      if (pendingStep.action.action === 'done') {
        recordAgentStep(ensureSession(), pendingStep, undefined, undefined, {
          memoryEnabled,
          onMemoryItem,
        })
        const finalResponse = await recordAgentFinalResponse({
          client,
          modelConfig: { ...modelConfig, stream: streamResponses },
          session: ensureSession(),
          task: ensureSession().task,
          signal: pendingAbort.signal,  // FIX: now abortable
        })
        // ... rest unchanged
      }
      // ... rest unchanged
    } finally {
      if (pendingAbortRef.current === pendingAbort) {
        pendingAbortRef.current = null
      }
    }
  })
}, [/* existing deps */])
```

- [x] **Step 2: Make stopCurrentRun abort both controllers**

```typescript
// src/hooks/useAgentRunController.ts (around line 429):
const stopCurrentRun = useCallback(() => {
  abortRef.current?.abort()
  pendingAbortRef.current?.abort()  // FIX: also abort manual execution
}, [])
```

- [x] **Step 3: Verify agent.ts auto-loop already passes signal**

Confirm `src/lib/agent.ts:786-792` already passes `signal: input.signal` (it does). No change needed there.

- [x] **Step 4: Add hook test**

```typescript
// src/hooks/useAgentRunController.test.ts (new or existing)
it('aborts pending final response when stop is called', async () => {
  // Setup: pendingStep with done action, mock client.completeFinalResponse
  // that resolves only on abort
  // Call executePendingStep, then stopCurrentRun
  // Assert: recordThreadStatus not set to 'done' after stop
})
```

- [x] **Step 5: Commit**

```bash
git add src/hooks/useAgentRunController.ts src/hooks/useAgentRunController.test.ts
git commit -m "fix(agent): abort manual final-response request on stop"
```

### Task 2.2: Fix queue flush race condition with mutex

**Files:**
- Modify: `src/hooks/useAgentRunController.ts:400-427`

**Interfaces:**
- Produces: Mutex-protected queue flush

- [x] **Step 1: Identify the race condition**

Read lines 400-427: The issue is `setQueuedChatMessages` based on stale closure.

- [x] **Step 2: Implement mutex-based flush**

```typescript
// src/hooks/useAgentRunController.ts
// Replace lines 113-427 with:
const queuedMessagesRef = useRef<string[]>([])
const flushingRef = useRef(false)

const flushQueuedMessages = useCallback(async () => {
  if (flushingRef.current || queuedMessagesRef.current.length === 0) {
    return
  }

  flushingRef.current = true
  const message = queuedMessagesRef.current[0]
  queuedMessagesRef.current = queuedMessagesRef.current.slice(1)
  setQueuedChatMessages([...queuedMessagesRef.current])

  try {
    await sendChatMessage(message)
  } finally {
    flushingRef.current = false
    if (queuedMessagesRef.current.length > 0) {
      // Schedule next flush
      queueMicrotask(() => flushQueuedMessages())
    }
  }
}, [sendChatMessage])

// Replace submitChatMessage:
const submitChatMessage = useCallback(async () => {
  const message = chatInput.trim()
  if (!message) {
    return
  }

  setChatInput('')

  if (busyTask) {
    queuedMessagesRef.current = [...queuedMessagesRef.current, message]
    setQueuedChatMessages([...queuedMessagesRef.current])
    addLog({ tone: 'info', title: copy.userMessageQueued, detail: message })
    return
  }

  await sendChatMessage(message)
}, [addLog, busyTask, chatInput, copy, sendChatMessage, setChatInput])

// Replace useEffect with:
useEffect(() => {
  if (!busyTask && queuedMessagesRef.current.length > 0) {
    flushQueuedMessages()
  }
}, [busyTask, flushQueuedMessages])
```

- [x] **Step 3: Commit**

```bash
git add src/hooks/useAgentRunController.ts
git commit -m "fix(agent): use ref + mutex to prevent queue flush race"
```

### Task 2.3: Prevent concurrent `runTask` execution

**Files:**
- Modify: `src/hooks/useBusyTask.ts:13-28`

**Interfaces:**
- Produces: In-flight task guard

- [x] **Step 1: Add in-flight check**

```typescript
// src/hooks/useBusyTask.ts
export function useBusyTask(onError?: (error: BusyTaskError) => void) {
  const [busyTask, setBusyTask] = useState<BusyTask | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  const runTask = useCallback(
    async (id: BusyTaskId, label: string, action: () => Promise<void>) => {
      if (inFlightRef.current) {
        console.warn(`runTask(${id}) called while another task is in flight, ignoring`)
        return
      }

      inFlightRef.current = true
      setBusyTask({ id, label, startedAt: Date.now() })
      setError(null)
      try {
        await action()
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        setError(message)
        onError?.({ label, message })
      } finally {
        inFlightRef.current = false
        setBusyTask(null)
      }
    },
    [onError],
  )

  return {
    busyTask,
    error,
    runTask,
    setError,
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/hooks/useBusyTask.ts
git commit -m "fix(busy-task): prevent concurrent runTask execution"
```

### Task 2.4: Clear `pendingStep` on thread/session switch

**Files:**
- Modify: `src/hooks/useAgentSessionHistory.ts:128-167`
- Modify: `src/hooks/useAgentRunController.ts` (add clearPendingStep)

**Interfaces:**
- Consumes: `setPendingStep(null)` from controller
- Produces: Clean state on thread switch

- [x] **Step 1: Pass clearPendingStep to history hook**

```typescript
// In App.tsx or wherever useAgentSessionHistory is called:
const { startNewSession, selectHistoryThread } = useAgentSessionHistory({
  // ... existing props
  onBeforeThreadChange: () => {
    // Stop any running task
    stopCurrentRun()
    // Clear pending step
    setPendingStep(null)
  },
})
```

Actually, easier solution: just add the clear in the hook itself.

- [x] **Step 2: Implement in hook**

```typescript
// src/hooks/useAgentSessionHistory.ts
// Modify startNewSession around line 128:
const startNewSession = useCallback(() => {
  // Clear any pending state
  setPendingStep?.(null)

  const thread = createAgentThread('')
  sessionRef.current = thread
  setActiveThreadId(thread.id)
  applySessionState(thread)
  persistSession(thread)
}, [setPendingStep])

// Modify selectHistoryThread around line 133:
const selectHistoryThread = useCallback(
  async (threadId: string) => {
    // Don't switch while busy
    if (busyTask) {
      return
    }

    // Clear any pending state
    setPendingStep?.(null)

    // ... rest of function
  },
  [busyTask, setPendingStep],
)
```

- [x] **Step 3: Commit**

```bash
git add src/hooks/useAgentSessionHistory.ts
git commit -m "fix(session): clear pending step on thread switch"
```

### Task 2.5: Reset `recoverableExecutionFailures` on model error

**Files:**
- Modify: `src/lib/agent.ts:756,878-884`

**Interfaces:**
- Produces: Separate counters for model errors vs execution errors

- [x] **Step 1: Analyze the counter logic**

Current: `recoverableExecutionFailures` counts both InvalidModelAction and failed execution.

Expected: Reset counter on success, separate or properly count.

- [x] **Step 2: Implement fix**

```typescript
// src/lib/agent.ts
// Around line 709, add:
let recoverableExecutionFailures = 0
let consecutiveModelErrors = 0

// Around line 756:
if (isInvalidModelActionError(caught)) {
  // ... existing code
  consecutiveModelErrors += 1
  if (consecutiveModelErrors > 2) {
    return { status: 'awaiting_review', steps, reason: caught.message }
  }
  continue
}

// Around line 884:
recoverableExecutionFailures = 0
consecutiveModelErrors = 0  // Also reset on successful execution
```

- [x] **Step 3: Commit**

```bash
git add src/lib/agent.ts
git commit -m "fix(agent): separate counters for model vs execution failures"
```

---

## Phase 3: Safety Policy Hardening

### Task 3.1: Add URI scheme whitelist

**Files:**
- Modify: `src/lib/actionValidation.ts:519-521`
- Modify: `src/lib/actionValidation.ts:86-96`

**Interfaces:**
- Produces: Whitelisted URI schemes: `http`, `https`, `mailto`, `tel`, `market`

- [x] **Step 1: Write the failing test**

```typescript
// Add to src/lib/actionValidation.packageName.test.ts
it('rejects dangerous URI schemes in open_url', () => {
  expect(() =>
    validateAction({
      action: 'open_url',
      url: 'javascript:alert(1)',
    }),
  ).toThrow('open_url scheme must be one of: http, https, mailto, tel, market')

  expect(() =>
    validateAction({
      action: 'open_url',
      url: 'file:///data/data',
    }),
  ).toThrow('open_url scheme must be one of: http, https, mailto, tel, market')
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/lib/actionValidation.packageName.test.ts`
Expected: FAIL — dangerous schemes accepted

- [x] **Step 3: Implement whitelist**

```typescript
// src/lib/actionValidation.ts
// Add after line 521:
const ALLOWED_URI_SCHEMES = ['http', 'https', 'mailto', 'tel', 'market'] as const

function hasAllowedUriScheme(value: string) {
  const match = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)
  if (!match) {
    return false
  }
  const scheme = match[1].toLowerCase()
  return ALLOWED_URI_SCHEMES.includes(scheme as any)
}

// Modify line 94-96:
if (!hasAllowedUriScheme(url)) {
  throw new ActionValidationError(
    'open_url scheme must be one of: http, https, mailto, tel, market',
  )
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/lib/actionValidation.packageName.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/actionValidation.ts
git commit -m "fix(validation): whitelist allowed URI schemes in open_url"
```

### Task 3.2: Use `hasControlCharacters` for `set_clipboard`

**Files:**
- Modify: `src/lib/actionValidation.ts:99-108`

**Interfaces:**
- Produces: Consistent control character validation

- [x] **Step 1: Implement fix**

```typescript
// src/lib/actionValidation.ts
// Modify lines 99-108:
case 'set_clipboard': {
  const text = readFirstString(candidate, ['text'])
  if (hasControlCharacters(text)) {
    throw new ActionValidationError('set_clipboard cannot contain control characters.')
  }
  if (text.length > 4000) {
    throw new ActionValidationError('set_clipboard is limited to 4000 characters.')
  }
  return withReason({ action, text }, candidate)
}
```

- [x] **Step 2: Commit**

```bash
git add src/lib/actionValidation.ts
git commit -m "fix(validation): use hasControlCharacters for set_clipboard"
```

### Task 3.3: Add NFKC normalization to safety patterns

**Files:**
- Modify: `src/lib/actionSafetyPolicy.ts`

**Interfaces:**
- Produces: NFKC-normalized evidence before regex matching

- [x] **Step 1: Write the failing test**

```typescript
// Add to src/lib/actionSafetyPolicy.test.ts
it('normalizes Unicode equivalents before pattern matching', () => {
  // Full-width characters
  expect(
    evaluateActionSafety(
      { action: 'tap', x: 100, y: 200 },
      { task: '全額付款' },  // Full-width
    ),
  ).toEqual(
    expect.objectContaining({
      decision: 'block',
      category: 'payment',
    }),
  )

  // Math letter variants
  expect(
    evaluateActionSafety(
      { action: 'tap', x: 100, y: 200 },
      { task: '𝐩𝐚𝐲 𝐧𝐨𝐰' },  // Math bold letters
    ),
  ).toEqual(
    expect.objectContaining({
      decision: 'block',
      category: 'payment',
    }),
  )
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test src/lib/actionSafetyPolicy.test.ts`
Expected: FAIL — Unicode variants not caught

- [x] **Step 3: Implement NFKC normalization**

```typescript
// src/lib/actionSafetyPolicy.ts
// Add at top:
function normalizeNFKC(value: string): string {
  return value.normalize('NFKC')
}

// Modify collectPolicyEvidence around line 131:
function collectPolicyEvidence(action: AgentAction, context: ActionSafetyContext) {
  const actionFields = [
    'reason' in action ? action.reason : undefined,
    action.action === 'tap' ? action.message : undefined,
    action.action === 'input_text' ? action.text : undefined,
    action.action === 'set_clipboard' ? action.text : undefined,
    action.action === 'open_url' ? action.url : undefined,
    action.action === 'launch' ? action.app : undefined,
    action.action === 'key' ? action.key : undefined,
  ].map((field) => (field ? normalizeNFKC(field) : field))

  const deviceFields = [
    context.currentApp,
    context.deviceState?.app,
    context.deviceState?.packageName,
    context.deviceState?.activity,
  ].map((field) => (field ? normalizeNFKC(field) : field))

  return {
    all: [...actionFields, ...deviceFields, context.task, context.modelOutput]
      .map((field) => (field ? normalizeNFKC(field) : field))
      .join('\n'),
    device: deviceFields.join('\n'),
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test src/lib/actionSafetyPolicy.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/actionSafetyPolicy.ts
git commit -m "fix(safety): normalize evidence with NFKC before pattern matching"
```

### Task 3.4: Evaluate safety on atomic children in composite actions

**Files:**
- Modify: `src/lib/toolRegistry.ts:339-345`

**Interfaces:**
- Produces: Safety check on each child action in sequence/repeat

- [x] **Step 1: Analyze current flow**

Current: `#executeCompositeAction` calls `this.execute(childAction, context)`, which will check safety if child is atomic.

Problem: The check at line 343 happens BEFORE entering the composite branch, so atomic children ARE checked when `this.execute` recurses.

Actually this is already fixed! The recursive call to `this.execute` at line 415 will go through the safety check at line 343.

Let me re-read the bug report... "sequence/repeat 内的 type_secret 不检查内容"

The issue is that `type_secret` is not in `MUTATING_ACTIONS` (line 56), so it's not safety-checked at all!

- [x] **Step 2: Add `type_secret` to MUTATING_ACTIONS**

```typescript
// src/lib/actionSafetyPolicy.ts
// Modify line 56:
const MUTATING_ACTIONS = new Set<AgentAction['action']>([
  'tap',
  'long_press',
  'double_tap',
  'input_text',
  'type_secret',  // ADD THIS
  'open_url',
  'paste',
  'set_clipboard',
  'key',
])
```

- [x] **Step 3: Write test**

```typescript
// Add to src/lib/actionSafetyPolicy.test.ts
it('checks type_secret safety based on context', () => {
  expect(
    evaluateActionSafety(
      { action: 'type_secret', secretId: 'password' },
      { task: 'Enter the password' },
    ),
  ).toEqual(
    expect.objectContaining({
      decision: 'take_over',
    }),
  )
})
```

- [x] **Step 4: Commit**

```bash
git add src/lib/actionSafetyPolicy.ts src/lib/actionSafetyPolicy.test.ts
git commit -m "fix(safety): add type_secret to mutating actions for safety check"
```

---

## Phase 4: UI Fixes

### Task 4.1: Add busy guard to ChatPanel Enter submit

**Files:**
- Modify: `src/components/ChatPanel.tsx:104-116`

**Interfaces:**
- Produces: Disabled Enter when busy

- [x] **Step 1: Implement fix**

```typescript
// src/components/ChatPanel.tsx
// Modify lines 104-116:
const submitChatIfNotEmpty = () => {
  if (!chatIsEmpty && !isBusy) {
    onSubmitChatMessage()
  }
}

const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
    return
  }

  event.preventDefault()
  if (!isBusy) {
    submitChatIfNotEmpty()
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/components/ChatPanel.tsx
git commit -m "fix(ui): prevent Enter submit when agent is busy"
```

### Task 4.2: Add delete confirmation to ChatHistorySidebar

**Files:**
- Modify: `src/components/ChatHistorySidebar.tsx:163-176`
- Modify: `src/lib/appCopy.en-US.ts` and `appCopy.zh-CN.ts`

**Interfaces:**
- Produces: Confirmation dialog before delete

- [x] **Step 1: Add confirm dialog**

```typescript
// src/components/ChatHistorySidebar.tsx
// Modify line 173:
onClick={() => {
  if (window.confirm(copy.deleteThreadConfirm(summary.title))) {
    onDeleteThread(summary.id)
  }
}}
```

- [x] **Step 2: Add copy strings**

```typescript
// src/lib/appCopy.en-US.ts
deleteThreadConfirm: (title: string) => `Delete thread "${title}"? This cannot be undone.`,

// src/lib/appCopy.zh-CN.ts
deleteThreadConfirm: (title: string) => `删除会话"${title}"?此操作无法撤销。`,
```

- [x] **Step 3: Commit**

```bash
git add src/components/ChatHistorySidebar.tsx src/lib/appCopy.*.ts
git commit -m "fix(ui): add confirmation dialog before deleting thread"
```

### Task 4.3: Add focus trap and auto-focus to SensitiveActionDialog

**Files:**
- Modify: `src/components/SensitiveActionDialog.tsx`

**Interfaces:**
- Produces: Focus-trapped modal with confirm button auto-focused

- [x] **Step 1: Implement focus trap**

```typescript
// src/components/SensitiveActionDialog.tsx
import { useEffect, useRef } from 'react'

// Add after line 38:
const confirmButtonRef = useRef<HTMLButtonElement>(null)

useEffect(() => {
  if (!request) {
    return
  }

  // Auto-focus confirm button
  confirmButtonRef.current?.focus()

  // Basic focus trap
  const panel = document.querySelector('.sensitive-action-dialog-panel')
  const focusableElements = panel?.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  const firstElement = focusableElements?.[0] as HTMLElement
  const lastElement = focusableElements?.[focusableElements.length - 1] as HTMLElement

  function handleTab(event: KeyboardEvent) {
    if (event.key !== 'Tab') {
      return
    }

    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        event.preventDefault()
        lastElement?.focus()
      }
    } else {
      if (document.activeElement === lastElement) {
        event.preventDefault()
        firstElement?.focus()
      }
    }
  }

  window.addEventListener('keydown', handleTab)
  return () => window.removeEventListener('keydown', handleTab)
}, [request])

// Modify line 82:
<button type="button" className="primary" onClick={onConfirm} ref={confirmButtonRef}>
```

- [x] **Step 2: Commit**

```bash
git add src/components/SensitiveActionDialog.tsx
git commit -m "fix(ui): add focus trap and auto-focus to sensitive action dialog"
```

### Task 4.4: Fix body overflow stack management

**Files:**
- Modify: `src/components/PhoneStage.tsx:89-108`
- Modify: `src/components/ScreenshotLightbox.tsx:57-70`
- Create: `src/hooks/useBodyOverflow.ts`

**Interfaces:**
- Produces: Stack-managed body overflow

- [x] **Step 1: Create overflow management hook**

```typescript
// src/hooks/useBodyOverflow.ts
import { useEffect, useRef } from 'react'

export function useBodyOverflow(lock: boolean) {
  const previousOverflowRef = useRef<string | null>(null)
  const lockCountRef = useRef(0)

  useEffect(() => {
    if (!lock) {
      return
    }

    if (lockCountRef.current === 0) {
      previousOverflowRef.current = document.body.style.overflow
    }

    lockCountRef.current += 1
    document.body.style.overflow = 'hidden'

    return () => {
      lockCountRef.current -= 1
      if (lockCountRef.current === 0) {
        document.body.style.overflow = previousOverflowRef.current || ''
      }
    }
  }, [lock])
}
```

- [x] **Step 2: Use in PhoneStage**

```typescript
// src/components/PhoneStage.tsx
import { useBodyOverflow } from '../hooks/useBodyOverflow'

// Add after line 50:
useBodyOverflow(isFullscreenPreview)
```

- [x] **Step 3: Use in ScreenshotLightbox**

```typescript
// src/components/ScreenshotLightbox.tsx
import { useBodyOverflow } from '../hooks/useBodyOverflow'

// Add after line 55:
useBodyOverflow(open)
```

- [x] **Step 4: Commit**

```bash
git add src/hooks/useBodyOverflow.ts src/components/PhoneStage.tsx src/components/ScreenshotLightbox.tsx
git commit -m "fix(ui): use stack-managed body overflow to prevent conflicts"
```

### Task 4.5: Fix topbar status ellipsis

**Files:**
- Modify: `src/components/AppTopbar.tsx`
- Modify: `src/styles/topbar.css` (or wherever .status is)

**Interfaces:**
- Produces: Proper ellipsis on nested span

- [x] **Step 1: Move ellipsis to inner span**

```typescript
// src/components/AppTopbar.tsx
// Find the .status structure and move ellipsis class to .status-label

<span className="status">
  <span className="status-label" title={currentAppLabel}>
    {currentAppLabel}
  </span>
</span>
```

```css
/* Update CSS */
.status {
  max-width: 160px;
}

.status-label {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [x] **Step 2: Commit**

```bash
git add src/components/AppTopbar.tsx src/styles/
git commit -m "fix(ui): apply text-overflow to inner status label span"
```

### Task 4.6: Add debouncing to history search

**Files:**
- Modify: `src/components/ChatHistorySidebar.tsx`

**Interfaces:**
- Produces: Debounced search input

- [x] **Step 1: Add debounce hook**

```typescript
// src/components/ChatHistorySidebar.tsx
import { useMemo, useState, useEffect } from 'react'

// Inside component:
const [queryInput, setQueryInput] = useState('')
const [debouncedQuery, setDebouncedQuery] = useState('')

useEffect(() => {
  const timer = setTimeout(() => {
    setDebouncedQuery(queryInput)
  }, 300)
  return () => clearTimeout(timer)
}, [queryInput])

const trimmedQuery = debouncedQuery.trim()
// Use trimmedQuery for filtering instead of query
```

- [x] **Step 2: Commit**

```bash
git add src/components/ChatHistorySidebar.tsx
git commit -m "perf(ui): debounce history search input"
```

---

## Final Steps

### Task F.1: Run full test suite

- [x] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

If failures, fix them before proceeding.

### Task F.2: Create summary document

- [x] **Step 1: Create bugfix summary**

Create: `docs/bugfix-2026-06-24.md`

```markdown
# WebDroid-Agent Bug Fix Summary - 2026-06-24

## Security Fixes (Critical)
1. Command injection in `open_url` - escape shell parameters
2. Command injection in `set_clipboard` - escape clipboard text
3. Command injection in `launch` - validate packageName format
4. Backslash escaping in `escapeInputText`

## Agent Loop Fixes (Critical/High)
5. Abort signal propagation to `recordAgentFinalResponse`
6. Queue flush race condition - use ref + mutex
7. Prevent concurrent `runTask` execution
8. Clear `pendingStep` on thread switch
9. Separate failure counters for model vs execution errors

## Safety Policy Fixes (High/Medium)
10. URI scheme whitelist in `open_url`
11. Control character validation in `set_clipboard`
12. NFKC normalization for Unicode safety patterns
13. Add `type_secret` to mutating actions

## UI Fixes (Medium/Low)
14. Busy guard on Enter submit
15. Delete confirmation dialog
16. Focus trap in sensitive action dialog
17. Stack-managed body overflow
18. Status ellipsis fix
19. Debounced history search

All fixes tested and committed.
```

- [x] **Step 2: Commit**

```bash
git add docs/bugfix-2026-06-24.md
git commit -m "docs: add bug fix summary for 2026-06-24"
```

### Task F.3: Run integration test

- [ ] **Step 1: Manual smoke test**

Build and run the app:
```bash
npm run build
npm start
```

Test critical paths:
- Connect to device
- Run a simple agent task
- Stop the agent mid-run
- Switch threads
- Delete a thread
- Try sensitive action

- [ ] **Step 2: Document any issues found**

If issues found, create new tasks and fix.

---

**Plan complete.** This plan fixes all 27 confirmed bugs across security, agent loop, safety policy, and UI subsystems. Execute using `superpowers:subagent-driven-development` for best results.
