# 运行 trajectory 与失败分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单次 agent run 投影成带版本、可脱敏、可提交的 trajectory 产物，在源头给失败分类，并由 trajectory 生成确定性 fixture 让设备链路首次获得离线 CI 覆盖。

**Architecture:** trajectory 是 `AgentThread.turns` 的**允许列表投影**（不是黑名单擦洗），带 `schemaVersion`；失败分类在抛出点/返回点标注，不在事后猜字符串；fixture 由 trajectory 派生（事实）加人工确认的期望值（不自动覆写）；Layer 2 用 fake `DeviceBackend` + 离线 client 重放设备时序。

**Tech Stack:** React 19 · TypeScript 6 · Vite 8 · Vitest 4 + jsdom + Testing Library · 原生 CSS 变量（本计划不引入任何新依赖）

**Spec:** `docs/superpowers/specs/2026-09-13-trajectory-failure-taxonomy-design.md`

## Global Constraints

- **不引入任何新依赖**（无 Tailwind / shadcn / Radix / canvas / sharp / tsx / vite-node）。
- 现有 **61 个测试文件 / 544 个用例必须全绿**；`npm run lint`、`npm run build` 保持干净。
- 新字段**一律可选**，已持久化的旧 thread 与旧 chat-history dump 必须仍可解析。
- `promptContext` 默认只存 `{ chars, digest }` 摘要；全文仅在 `includeContext: true` 时写入。
- trajectory 与提交进仓库的 fixture **不得包含**：`device.serial`、`model.baseUrl`、`model.apiKey`、secret 值、截图像素（`data:image/`）、`promptContext` 全文。
- 摘要算法固定为 **FNV-1a 32 位**（`fnv1a32:xxxxxxxx`），不引入加密级哈希（浏览器 `crypto.subtle` 是异步，会让投影变异步）。
- 失败分类**只允许在源头判定**；禁止对 `summary` 文案做正则/字符串匹配来推断失败种类。
- `AUTO_RECOVERABLE_FAILURES` 固定为 `{ device_io, device_timeout }`。
- 唯一允许的运行时行为改动：`isAutoRecoverableExecutionFailure()` 由 `!safetyDecision` 改为按上述白名单判定。
- 提交信息使用仓库既有的 conventional commits 风格（`feat:` / `fix:` / `test:` / `chore:` / `docs:`）。

---

## 实现前必读：已核实的事实锚点

这些都已在本仓库核对过，直接照用，不要重新推导：

| 锚点 | 值 |
| --- | --- |
| **turn = 一步**（不是一次 run） | `startThreadTurn()` 在 `runAgentStep()` 内每步调用：`src/lib/agent.ts:517`、`:588` |
| `runAgentStep()` 的生产调用方**只有 1 个** | `src/lib/agent.ts:720`（`createAgentRunner().run()` 内部） |
| runner 循环执行动作的唯一位置 | `src/lib/agent.ts:832` `toolRegistry.execute(step.executionAction, {...})` |
| 控制器单步补执行的位置 | `src/hooks/useAgentRunController.ts:156` `actionToolRegistry.execute(pendingStep.executionAction, {...})` |
| `recordAgentStep()` 把 step 落到 turn | `src/lib/agent.ts:200` → 调 `recordThreadTurnExecution`（`agentThread.ts:333`） |
| `isAutoRecoverableExecutionFailure()` 现状 | `src/lib/agent.ts:900`，实现是 `!result.safetyDecision` |
| 重试预算 | `MAX_AUTO_RECOVERABLE_EXECUTION_FAILURES = 2`（`agent.ts:59`）；`> 2` 才 `awaiting_review`，即最多 3 次执行 |
| `loop_guard` 判定 | `detectLoopGuard()`（`agent.ts:980`），使用点 `agent.ts:812-818` |
| `withTimeout()` 抛错点 | `src/adapters/deviceRetry.ts:21` |
| 命令真正下发处（唯一漏斗） | `src/adapters/webAdbBackend.ts:503` `#executeCommandStep`，仅 3 个调用点：`:395`、`:623`、`:636` |
| `toolRegistry` 调 `device.execute` 的位置 | 仅 2 处：`src/lib/toolRegistry.ts:488`、`:514` |
| 工具执行异常兜底 catch（设备错误落点） | `src/lib/toolRegistry.ts:414-424`，返回 `success:false` 且**无** `failureKind` |
| `call_api` 不支持分支 | `src/lib/toolRegistry.ts:312-318` |
| `InvalidModelActionError` 是**私有类** | `src/lib/agent.ts:165`（外部模块无法 `instanceof`） |
| `isAgentThread()` 是**浅校验** | `src/lib/agentThread.ts:772`，无需为新字段改动 |
| `startThreadTurn()` 会去掉 turn 上的截图 | `omitSnapshotScreenshot()`，故截图引用只能来自 `thread.screenshotReferences`（`agentThread.ts:52`） |
| `createId()` **未导出** | `src/lib/agentThread.ts:768` 是模块私有函数 |
| `mapActionCoordinates(action, fromScreen, toScreen)` | `src/lib/screenshot/coordinates.ts:85` 起（3 个重载） |
| `parseModelAction(raw, screen, actionProtocol)` | `src/lib/actionParser.ts:7`，失败抛错 |
| `OpenAiClient` 形状 | `src/lib/openAiTypes.ts:190`：`{ completeAction(req): Promise<string> }`（其余可选） |
| `__APP_VERSION__` 全局可用 | `src/vite-env.d.ts`，由 `vite.config.ts` 的 `define` 注入（vitest 同样生效） |
| fixture 目录不会被当测试收集 | vitest 默认只收 `*.test.*` / `*.spec.*`；`exclude` 仅 node_modules/dist/dist-server |

**相机式（characterization）夹具的纪律**：坐标类 fixture 的 `expected` 是「实现当前行为」的快照。写入时必须在 fixture 的 `note` 字段里抄下 `coordinates.ts` 里 `mapPoint` 的实际公式，并**同时**加不变量断言（单调性 / 恒等 / 边界不越界），避免把 bug 焊死成期望值。

---

## 任务总览

| # | 任务 | 交付物 | 依赖 |
| --- | --- | --- | --- |
| 1 | 给超时错误加类型标记 | `DeviceBackendError.kind` | — |
| 2 | 失败分类模块 | `src/lib/failureTaxonomy.ts` | 1 |
| 3 | 工具结果携带失败种类 | `ActionToolResult.failureKind` | 2 |
| 4 | 接线分类 + 重试白名单（唯一行为改动） | agent 循环改造 | 3 |
| 5 | `runId` 端到端贯通 | run → step → turn | 4 |
| 6 | `deviceCommands` 采集 | backend + 2 个执行点 | 5 |
| 7 | trajectory 投影与脱敏 | `src/lib/trajectory.ts` | 5, 6 |
| 8 | 导出入口（UI + 文案） | SettingsDialog 按钮 | 7 |
| 9 | fixture 生成器 | `trajectoryFixture.ts` + `scripts/*.mjs` | 7 |
| 10 | Layer 1 重放用例 | `test/fixtureReplay/{actions,coordinates}.test.ts` | 9 |
| 11 | CI 守卫 + README 同步 | repo-hardening + 文档 | 10 |
| 12 | fake `DeviceBackend` | `test/helpers/fakeDeviceBackend.ts` | 6 |
| 13 | Layer 2 重放用例 | `test/fixtureReplay/deviceLoop.test.ts` | 4, 12 |

**范围提示**：Task 1–11 即 Layer 1，Task 12–13 为 Layer 2。若需缩减范围，Task 1–11 结束时已是一套可独立工作的成果（trajectory 可导出、可生成夹具、纯函数面进 CI），Task 12–13 可整体推迟而不影响前面的交付。

---

# Part 1 — 失败分类基建

### Task 1: 给超时错误加类型标记

**Files:**
- Modify: `src/adapters/deviceTypes.ts:79-84`
- Modify: `src/adapters/deviceRetry.ts:19-34`
- Test: `src/adapters/deviceRetry.test.ts`（已存在，追加用例）

**Interfaces:**
- Consumes: 无
- Produces: `DeviceBackendErrorKind = 'io' | 'timeout'`；`new DeviceBackendError(message, kind?)`，`kind` 默认 `'io'`；`withTimeout()` 以 `kind: 'timeout'` 抛错

- [ ] **Step 1: 写失败测试**

追加到 `src/adapters/deviceRetry.test.ts`（沿用该文件既有的 import 风格）：

```ts
import { DeviceBackendError } from './deviceTypes'
import { withTimeout } from './deviceRetry'

describe('DeviceBackendError.kind', () => {
  it('defaults to io so existing call sites keep their meaning', () => {
    expect(new DeviceBackendError('boom').kind).toBe('io')
  })

  it('marks a withTimeout rejection as timeout', async () => {
    const never = () => new Promise<string>(() => {})
    const error = await withTimeout(never, 5, 'device command').catch((caught) => caught)
    expect(error).toBeInstanceOf(DeviceBackendError)
    expect((error as DeviceBackendError).kind).toBe('timeout')
  })

  it('keeps the timeout message unchanged', async () => {
    const never = () => new Promise<string>(() => {})
    const error = await withTimeout(never, 5, 'device command').catch((caught) => caught)
    expect((error as Error).message).toBe('device command timed out after 5ms.')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/adapters/deviceRetry.test.ts -t "DeviceBackendError.kind"`
Expected: FAIL —— `kind` 为 `undefined`，`expected undefined to be 'io'`

- [ ] **Step 3: 实现**

`src/adapters/deviceTypes.ts`，把 `DeviceBackendError` 替换为：

```ts
export type DeviceBackendErrorKind = 'io' | 'timeout'

export class DeviceBackendError extends Error {
  readonly kind: DeviceBackendErrorKind

  constructor(message: string, kind: DeviceBackendErrorKind = 'io') {
    super(message)
    this.name = 'DeviceBackendError'
    this.kind = kind
  }
}
```

`src/adapters/deviceRetry.ts:21`，改成：

```ts
      reject(new DeviceBackendError(`${label} timed out after ${timeoutMs}ms.`, 'timeout'))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/adapters/deviceRetry.test.ts`
Expected: PASS（含该文件原有的全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/adapters/deviceTypes.ts src/adapters/deviceRetry.ts src/adapters/deviceRetry.test.ts
git commit -m "feat(device): tag DeviceBackendError with an io/timeout kind"
```

---

### Task 2: 失败分类模块

**Files:**
- Create: `src/lib/failureTaxonomy.ts`
- Test: `src/lib/failureTaxonomy.test.ts`

**Interfaces:**
- Consumes: `DeviceBackendError`、`kind`（Task 1）；`ActionValidationError`（`./actionTypes`）；`OpenAiClientError`（`./openAiErrors`）；`isAbortError`（`./abortSignal`）；`ActionToolResult`（`./toolRegistry`，**type-only**）
- Produces:
  - `type FailureClass`
  - `isFailureClass(value: unknown): value is FailureClass`
  - `classifyThrownFailure(error: unknown, hints?: { force?: FailureClass }): FailureClass`
  - `AUTO_RECOVERABLE_FAILURES: ReadonlySet<FailureClass>`
  - `isAutoRecoverableFailureClass(value: FailureClass): boolean`
  - `isAutoRecoverableExecutionFailure(result: ActionToolResult): boolean` ← Task 4 用它替换 `agent.ts:900` 的同名私有函数

- [ ] **Step 1: 写失败测试**

Create `src/lib/failureTaxonomy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ActionValidationError } from './actionTypes'
import { DeviceBackendError } from '../adapters/deviceTypes'
import { OpenAiClientError } from './openAiErrors'
import {
  AUTO_RECOVERABLE_FAILURES,
  classifyThrownFailure,
  isAutoRecoverableExecutionFailure,
  isFailureClass,
} from './failureTaxonomy'

describe('classifyThrownFailure', () => {
  it('splits device errors by kind', () => {
    expect(classifyThrownFailure(new DeviceBackendError('adb failed'))).toBe('device_io')
    expect(classifyThrownFailure(new DeviceBackendError('slow', 'timeout'))).toBe('device_timeout')
  })

  it('classifies transport, validation and abort failures', () => {
    expect(classifyThrownFailure(new OpenAiClientError('429'))).toBe('model_transport')
    expect(classifyThrownFailure(new ActionValidationError('bad package'))).toBe('action_invalid')
    expect(classifyThrownFailure(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('aborted')
  })

  it('honours an explicit force hint, because some error classes are module-private', () => {
    expect(classifyThrownFailure(new Error('not json'), { force: 'model_output' })).toBe('model_output')
  })

  it('lets the hint win over the error’s own type, not merely over unknown', () => {
    // Without a hint this classifies as device_timeout; if someone moves the
    // force check last, this assertion is what catches it.
    expect(classifyThrownFailure(new DeviceBackendError('slow', 'timeout'))).toBe('device_timeout')
    expect(
      classifyThrownFailure(new DeviceBackendError('slow', 'timeout'), { force: 'model_output' }),
    ).toBe('model_output')
  })

  it('falls back to unknown instead of guessing', () => {
    expect(classifyThrownFailure(new Error('mystery'))).toBe('unknown')
    expect(classifyThrownFailure('a string')).toBe('unknown')
  })
})

describe('auto-recoverable whitelist', () => {
  it('contains exactly the two transient device classes', () => {
    expect([...AUTO_RECOVERABLE_FAILURES].sort()).toEqual(['device_io', 'device_timeout'])
  })

  it('retries device failures but not unsupported or unknown ones', () => {
    expect(isAutoRecoverableExecutionFailure({ toolName: 'tap', success: false, summary: 'x', failureKind: 'device_timeout' })).toBe(true)
    expect(isAutoRecoverableExecutionFailure({ toolName: 'tap', success: false, summary: 'x', failureKind: 'device_io' })).toBe(true)
    expect(isAutoRecoverableExecutionFailure({ toolName: 'call_api', success: false, summary: 'x', failureKind: 'unsupported_action' })).toBe(false)
    expect(isAutoRecoverableExecutionFailure({ toolName: 'tap', success: false, summary: 'x' })).toBe(false)
  })
})

describe('isFailureClass', () => {
  it('accepts known classes and rejects everything else', () => {
    expect(isFailureClass('device_timeout')).toBe(true)
    expect(isFailureClass('device_unavailable')).toBe(false)
    expect(isFailureClass(42)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/failureTaxonomy.test.ts`
Expected: FAIL —— `Failed to resolve import "./failureTaxonomy"`

- [ ] **Step 3: 实现**

Create `src/lib/failureTaxonomy.ts`:

```ts
import { DeviceBackendError } from '../adapters/deviceTypes'
import { isAbortError } from './abortSignal'
import { ActionValidationError } from './actionTypes'
import { OpenAiClientError } from './openAiErrors'
import type { ActionToolResult } from './toolRegistry'

/**
 * Failure classes are decided where the failure happens, never inferred by
 * pattern-matching human-readable summaries.
 *
 * There is deliberately no `device_unavailable` class: the codebase has no
 * distinct connection-loss error signal today, so such a class could only ever
 * be guessed. Connection-time failures classify as `device_io` for now.
 */
export const FAILURE_CLASSES = [
  'model_transport',
  'model_output',
  'action_invalid',
  'unsupported_action',
  'device_io',
  'device_timeout',
  'loop_guard',
  'aborted',
  'unknown',
] as const

export type FailureClass = (typeof FAILURE_CLASSES)[number]

export function isFailureClass(value: unknown): value is FailureClass {
  return typeof value === 'string' && FAILURE_CLASSES.includes(value as FailureClass)
}

export type FailureClassificationHints = {
  /**
   * Some error classes are module-private (e.g. InvalidModelActionError lives
   * inside agent.ts), so the throw site must be able to name the class itself.
   */
  force?: FailureClass
}

export function classifyThrownFailure(
  error: unknown,
  hints: FailureClassificationHints = {},
): FailureClass {
  if (hints.force) {
    return hints.force
  }
  if (isAbortError(error)) {
    return 'aborted'
  }
  if (error instanceof DeviceBackendError) {
    return error.kind === 'timeout' ? 'device_timeout' : 'device_io'
  }
  if (error instanceof OpenAiClientError) {
    return 'model_transport'
  }
  if (error instanceof ActionValidationError) {
    return 'action_invalid'
  }
  return 'unknown'
}

/** Transient device hiccups are worth one more attempt; nothing else is. */
export const AUTO_RECOVERABLE_FAILURES: ReadonlySet<FailureClass> = new Set([
  'device_io',
  'device_timeout',
])

export function isAutoRecoverableFailureClass(value: FailureClass) {
  return AUTO_RECOVERABLE_FAILURES.has(value)
}

export function isAutoRecoverableExecutionFailure(result: ActionToolResult) {
  return result.failureKind !== undefined && isAutoRecoverableFailureClass(result.failureKind)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/failureTaxonomy.test.ts`
Expected: PASS（11 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/failureTaxonomy.ts src/lib/failureTaxonomy.test.ts
git commit -m "feat(agent): add a source-side failure classification module"
```

---

### Task 3: 工具结果携带失败种类

**Files:**
- Modify: `src/lib/toolRegistry.ts:30-35`（`ActionToolResult`）、`:312-318`（`call_api`）、`:414-424`（兜底 catch）、`:443-455`（composite 传播）、`:37-45`（`ActionToolContext` 加 `onDeviceCommand`，供 Task 6 用）
- Test: `src/lib/toolRegistry.test.ts`（已存在，追加用例）

**Interfaces:**
- Consumes: `classifyThrownFailure`（Task 2）
- Produces: `ActionToolResult.failureKind?: FailureClass`；`ActionToolContext.onDeviceCommand?: (argv: readonly string[]) => void`

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/toolRegistry.test.ts`（沿用该文件既有的 registry 构造方式；若它已有 helper 创建 registry，直接复用）：

```ts
import { createDefaultActionToolRegistry } from './toolRegistry'
import { DeviceBackendError } from '../adapters/deviceTypes'

describe('ActionToolResult.failureKind', () => {
  it('marks an unsupported action instead of leaving the caller to guess', async () => {
    const registry = createDefaultActionToolRegistry()
    const result = await registry.execute(
      { action: 'call_api', instruction: 'summarise' } as never,
      { device: fakeDevice(), unrestrictedMode: true } as never,
    )
    expect(result.success).toBe(false)
    expect(result.failureKind).toBe('unsupported_action')
  })

  it('classifies a thrown device timeout as device_timeout', async () => {
    const registry = createDefaultActionToolRegistry()
    const result = await registry.execute(
      { action: 'tap', x: 1, y: 2 } as never,
      {
        device: fakeDevice(() => {
          throw new DeviceBackendError('device command timed out after 30000ms.', 'timeout')
        }),
      } as never,
    )
    expect(result.success).toBe(false)
    expect(result.failureKind).toBe('device_timeout')
  })

  it('leaves safety refusals without a failure kind, because they are not failures', async () => {
    const registry = createDefaultActionToolRegistry()
    const result = await registry.execute(
      { action: 'tap', x: 1, y: 2 } as never,
      { device: fakeDevice(), safetyContext: { task: 'x', currentApp: 'Settings', deviceState: { app: 'Settings' } } } as never,
    )
    if (!result.success && result.safetyDecision) {
      expect(result.failureKind).toBeUndefined()
    }
  })
})
```

`fakeDevice` 用最小 stub（若该文件已有等价 helper 则复用）：

```ts
function fakeDevice(execute?: () => Promise<string>) {
  return {
    execute: execute ?? (async () => 'ok'),
    screenshot: async () => ({ dataUrl: '', screen: { width: 1080, height: 2316 } }),
    getCurrentApp: async () => 'Settings',
    getDeviceState: async () => ({ app: 'Settings' }),
  }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/toolRegistry.test.ts -t "failureKind"`
Expected: FAIL —— `expected undefined to be 'unsupported_action'`

- [ ] **Step 3: 实现**

`src/lib/toolRegistry.ts` 顶部 —— **合并到已有的那一行，不要新增第二条 import**。Task 2 的前向声明已经在 `:17` 放了：

```ts
import type { FailureClass } from './failureTaxonomy'
```

把它**整行替换**为（值导入 `classifyThrownFailure` + 保留 type-only 的 `FailureClass`，仍是一条语句）：

```ts
import { classifyThrownFailure, type FailureClass } from './failureTaxonomy'
```

> 两条语句导入同一个模块的同一符号会触发 lint 的 `no-duplicate-imports` 类规则（本仓库 CI 跑 `npm run lint`）。

`src/lib/toolRegistry.ts` —— **`ActionToolResult.failureKind` 已由 Task 2 的提交（`06d4fee`）前向声明完毕**（2 行：type-only `import type { FailureClass }` + `failureKind?: FailureClass`）。本任务**不要重复添加该字段**，只需：① 在失败分支**填充**它；② 加 `ActionToolContext.onDeviceCommand`。若发现字段不存在，说明基线不对，停下来报告而不是自行补声明 —— 本任务原本的 RED 之所以仍然成立，是因为还没有任何代码**填充**该字段。

`ActionToolContext`（`:37`）加一个可选字段（Task 6 使用，本任务只是把类型放好）：

```ts
  onDeviceCommand?: (argv: readonly string[]) => void
```

`call_api` 分支（`:312`）—— **`failureKind` 与 `safetyDecision` 必须二选一**，因为安全拒绝不是失败（spec §5.1）。受限模式下这是"请用户接管"的拒绝路径，不得带 `failureKind`；只有非受限模式（动作确实是被当作不受支持而失败）才带：

```ts
    if (action.action === 'call_api') {
      return {
        toolName,
        success: false,
        summary: `Unsupported call_api action: ${action.instruction}`,
        ...(context.unrestrictedMode
          ? { failureKind: 'unsupported_action' as const }
          : { safetyDecision: 'take_over' as const }),
      }
    }
```

> 这个形状同时满足三件事：① 约束「安全拒绝不得带 `failureKind`」；② Task 4 的用例（用 `unrestrictedMode: true`，期望 `unsupported_action` 走到 `awaiting_review`）；③ `toolRegistry.test.ts` 里那条既有 `take_over` 精确断言**无需修改**。原计划写成无条件 `failureKind` + 条件 `safetyDecision`，会让拒绝路径同时带上两者 —— 该缺陷由 Task 3 评审发现（I1）。

兜底 catch（`:414` 的 `catch (caught)` 分支）——设备异常在这里落地：

```ts
      return {
        toolName,
        success: false,
        summary: caught instanceof Error ? caught.message : String(caught),
        failureKind: classifyThrownFailure(caught),
      }
```

composite 传播失败种类（`:443` 附近，`#executeCompositeAction` 里 `if (!result.success)` 的返回）：

```ts
        return {
          toolName: action.action,
          success: false,
          summary: [`${action.action} stopped at ${stepLabel}.`, ...summaries].join('\n'),
          ...(result.failureKind ? { failureKind: result.failureKind } : {}),
          ...(result.safetyDecision ? { safetyDecision: result.safetyDecision } : {}),
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/toolRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全量测试确认没有破坏既有断言**

Run: `npm test`
Expected: PASS —— 当前基线 62 文件 / 556+ 用例。`ActionToolContext.onDeviceCommand` 是新增可选字段，`failureKind` 只是被填充，都不应破坏既有断言。

- [ ] **Step 6: 提交**

```bash
git add src/lib/toolRegistry.ts src/lib/toolRegistry.test.ts
git commit -m "feat(agent): tag tool results with a machine-readable failure kind"
```

---

### Task 4: 接线分类 + 重试白名单（唯一行为改动）

**Files:**
- Modify: `src/lib/agent.ts:59`（常量旁加 import）、`:900-902`（删除旧判断）、`:832-846`（执行上下文）、`:877-893`（失败分支）、`:812-818`（loop_guard 分支）
- Modify: `src/lib/agentThread.ts:96`（`status_change` 事件加 `failureClass`）、`:519-546`（`recordThreadStatus` 选项）
- Modify: `src/hooks/useAgentRunController.ts:302-317`（run 结局映射）
- Test: `src/lib/agent.test.ts`、`src/lib/agentThread.test.ts`（均已存在，追加用例）

**Interfaces:**
- Consumes: `classifyThrownFailure`、`isAutoRecoverableExecutionFailure`（Task 2/3）
- Produces: `AgentStep.failureClass?: FailureClass`（Task 7 依赖）；`AgentThreadEvent` 的 `status_change` 变体新增 `failureClass?: FailureClass`；`recordThreadStatus(thread, status, message?, options?: { now?: number; failureClass?: FailureClass })`

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/agent.test.ts` —— **复用该文件已有的 `fakeDevice()`**（`src/lib/agent.test.ts:15`，其 `execute` 是 `vi.fn` 且记录 `executed: string[]`）；client 与 modelConfig 沿用该文件既有内联写法：

```ts
import { DeviceBackendError } from '../adapters/deviceTypes'

function sequentialClient(outputs: readonly string[]): OpenAiClient {
  let index = 0
  return {
    completeAction: vi.fn(async () => {
      const output = outputs[Math.min(index, outputs.length - 1)]
      index += 1
      return output ?? '{"action":"done","summary":"ok"}'
    }),
  }
}

function deviceFailingWith(makeError: () => Error) {
  const device = fakeDevice()
  let calls = 0
  device.execute = vi.fn(async () => {
    calls += 1
    throw makeError()
  })
  return { device, callCount: () => calls }
}

const MODEL_CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: 'key', model: 'm' }

describe('failure classification and retry budget', () => {
  it('retries a device timeout up to the budget and then asks for review', async () => {
    const { device, callCount } = deviceFailingWith(
      () => new DeviceBackendError('device command timed out after 30000ms.', 'timeout'),
    )
    const result = await createAgentRunner({
      device,
      client: sequentialClient(['{"action":"tap","x":1,"y":2}']),
    }).run({ modelConfig: MODEL_CONFIG, task: 'tap something', autoExecute: true, maxSteps: 5 })

    expect(result.status).toBe('awaiting_review')
    expect(callCount()).toBe(3)
    expect(result.steps.map((step) => step.failureClass)).toEqual([
      'device_timeout',
      'device_timeout',
      'device_timeout',
    ])
  })

  it('does not burn the retry budget on a non-device failure', async () => {
    // NOTE: a model-emitted call_api never reaches the registry — validateAction
    // rewrites it to take_over (actionValidation.ts:160-170), so
    // 'unsupported_action' is not reachable through the runner. The reachable
    // non-device failure is a plain Error thrown by a tool, which classifies as
    // 'unknown' and is deliberately not retryable. 'unsupported_action' stays
    // covered at the registry/predicate level (Task 3).
    const { device, callCount } = deviceFailingWith(() => new Error('tool blew up'))
    const result = await createAgentRunner({
      device,
      client: sequentialClient(['{"action":"tap","x":1,"y":2}']),
    }).run({ modelConfig: MODEL_CONFIG, task: 'tap', autoExecute: true, maxSteps: 5 })

    expect(result.status).toBe('awaiting_review')
    expect(callCount()).toBe(1)
    expect(result.steps.at(-1)?.failureClass).toBe('unknown')
  })

  it('retries a device I/O failure too, because it is the other whitelisted class', async () => {
    const { device, callCount } = deviceFailingWith(
      () => new DeviceBackendError('adb command failed'),
    )
    const result = await createAgentRunner({
      device,
      client: sequentialClient(['{"action":"tap","x":1,"y":2}']),
    }).run({ modelConfig: MODEL_CONFIG, task: 'tap', autoExecute: true, maxSteps: 5 })

    expect(result.status).toBe('awaiting_review')
    expect(callCount()).toBe(3)
    expect(result.steps.every((step) => step.failureClass === 'device_io')).toBe(true)
  })

  it('reports loop_guard without marking a step as failed', async () => {
    const repeated = '{"action":"tap","x":1,"y":2}'
    const result = await createAgentRunner({
      device: fakeDevice(),
      client: sequentialClient([repeated]),
    }).run({ modelConfig: MODEL_CONFIG, task: 'loop', autoExecute: true, maxSteps: 6 })

    expect(result.status).toBe('loop_guard')
    expect(result.steps.every((step) => step.failureClass === undefined)).toBe(true)
  })
})
```

追加到 `src/lib/agentThread.test.ts`:

```ts
describe('run-level failure class', () => {
  it('records the failure class on the status change event', () => {
    const thread = createAgentThread('task')
    recordThreadStatus(thread, 'stopped', 'loop guard', { failureClass: 'loop_guard' })
    const event = [...thread.events].reverse().find((candidate) => candidate.type === 'status_change')
    expect(event && 'failureClass' in event ? event.failureClass : undefined).toBe('loop_guard')
  })
})
```

> `unrestrictedMode: true` 是必需的：受限模式下 `call_api` 会带 `safetyDecision: 'take_over'`，走到 `awaiting_takeover` 分支而不是 `awaiting_review`（`call_api` 分支在 `toolRegistry.ts:312`，先于安全检查返回）。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/agent.test.ts -t "failure classification and retry budget"`
Expected: FAIL —— `step.failureClass` 为 `undefined`

- [ ] **Step 3: 实现**

`src/lib/agent.ts` 加 import：

```ts
import {
  classifyThrownFailure,
  isAutoRecoverableExecutionFailure,
  type FailureClass,
} from './failureTaxonomy'
```

`AgentStep`（`:73`）加字段：

```ts
export type AgentStep = {
  // …既有字段保持不变…
  failureClass?: FailureClass
  safetyDecision?: ActionSafetyDecision
}
```

（`ActionSafetyDecision` 已在 `agent.ts` 可见范围内 —— 它来自 `./actionSafetyPolicy`；若尚未 import 则加 type-only import。）

**分类必须同时落到 `AgentTurn` 上** —— Task 7 的 trajectory 投影**只从 `thread.turns` 读取**，如果只标在 `AgentStep` 上，投影拿不到任何分类。`AgentTurn`（`agentThread.ts:75`）加两个字段，并在 `recordThreadTurnExecution`（`:333`）写透：

```ts
// AgentTurn 新增
  failureClass?: FailureClass
  safetyDecision?: ActionSafetyDecision

// recordThreadTurnExecution 的 input 新增同名可选项，函数体内按可选项赋值：
  if (input.failureClass) {
    turn.failureClass = input.failureClass
  }
  if (input.safetyDecision) {
    turn.safetyDecision = input.safetyDecision
  }
```

`recordAgentStep`（`agent.ts:200`）把它已经拿到的那次 `recordThreadTurnExecution` 调用补上透传（该调用在 `:216`）：

```ts
    const turn = recordThreadTurnExecution(session, step.turnId, {
      executionResult,
      toolName: step.toolName,
      memoryEnabled: options.memoryEnabled,
      timing: step.timing,
      success,
      ...(step.failureClass ? { failureClass: step.failureClass } : {}),
      ...(step.safetyDecision ? { safetyDecision: step.safetyDecision } : {}),
    })
```

配套一条断言「分类确实落到 turn 上」的用例（Task 7 依赖它）：

```ts
it('persists the failure class onto the turn, not just the step', async () => {
  const { device } = deviceFailingWith(() => new DeviceBackendError('adb command failed'))
  const session = createAgentSession('tap')
  const result = await createAgentRunner({
    device,
    client: sequentialClient(['{"action":"tap","x":1,"y":2}']),
  }).run({ modelConfig: MODEL_CONFIG, task: 'tap', autoExecute: true, maxSteps: 1, session })

  expect(result.steps[0]?.failureClass).toBe('device_io')
  expect(session.turns[0]?.failureClass).toBe('device_io')
})
```

**补掉两处"静默无分类"的失败路径**（spec §5.1 要求判不了的一律进 `unknown`，且 `unknown` 必须被统计、不允许静默吞掉）：

1. `toolRegistry.ts` 的两个**提前返回**不经过兜底 catch，因此永远拿不到分类，而它们是**生产可达**的（`App.tsx` 的 `disabledActionTools` → 控制器建注册表）：
   - `unknown tool`（`:330-336`）与 `disabled tool`（`:347-353`）各加 `failureKind: 'unknown' as const`。
   - 这两处属于 Task 3 的文件，但 Task 3 已完成 —— 由 Task 4 的修复轮统一补，所有权归"接线分类"的 Task 4。
2. 控制器最外层的 `catch`（`useAgentRunController.ts:325-330`）在 `recordThreadStatus(session, 'error', message)` 时**不带分类**，于是 `model_transport` 这类 run 级抛出错误（网络/HTTP/限流）在 trajectory 里完全没有分类：

```ts
        recordThreadStatus(session, 'error', message, {
          failureClass: classifyThrownFailure(caught),
        })
```

另需在已有的 take-over 用例里补一条 `expect(session.turns[i]?.safetyDecision).toBe('take_over')` —— `safetyDecision` 是本次一并落地到 `AgentTurn` 的接口，只测一半等于没钉住。

**删除** `agent.ts:900-902` 的私有 `isAutoRecoverableExecutionFailure`（现在由 `failureTaxonomy.ts` 提供；注意 import 名字相同，删除后无需改调用点）。

执行上下文（`:832`）加设备命令回调之外的分类前置——执行失败的结果本身已带 `failureKind`，无需在此处分类；只需在拿到 `result` 后落到 step 上：

```ts
        step.toolName = result.toolName
        if (result.failureKind) {
          step.failureClass = result.failureKind
        }
        if (result.safetyDecision) {
          step.safetyDecision = result.safetyDecision
        }
        recordAgentStepExecutionDuration(step, elapsed(executionStartedAt))
```

模型侧失败（`:438`、`:480` 附近的 `catch`）：用 `force` 明确点名，因为解析失败与私有错误类在外部不可判别：

```ts
        const failureClass = classifyThrownFailure(caught, {
          force: isInvalidModelActionError(caught) ? 'model_output' : undefined,
        })
```

解析层失败（`parseActionOrError` 的调用方，紧接解析之后的失败处理）统一标 `model_output`；`ActionValidationError` 走 `action_invalid`（默认行为，无需 `force`）。

loop_guard（`:812-818`）—— **不要给 step 标 `failureClass`**：那一步从未执行，而前一步是成功的，标上去会污染语义。`loop_guard` 属于 run 级结局：

```ts
        const loopSignal = detectLoopGuard(session, step)
        if (loopSignal) {
          return { status: 'loop_guard', steps, reason: loopSignal }
        }
```

`src/lib/agentThread.ts` —— `AgentThreadEvent` 的 `status_change` 变体（`:96` 起）加字段（用 **type-only import**，保持 `agentThread.ts` 与 `failureTaxonomy.ts` 之间无运行时依赖）：

```ts
import type { FailureClass } from './failureTaxonomy'
// …
  | {
      id: string
      type: 'status_change'
      status: AgentThreadStatus
      message?: string
      failureClass?: FailureClass
      createdAt: number
    }
```

`recordThreadStatus`（`:519`）选项加 `failureClass` 并写入事件：

```ts
export function recordThreadStatus(
  thread: AgentThread,
  status: AgentThreadStatus,
  message?: string,
  options: { now?: number; failureClass?: FailureClass } = {},
) {
  // …去重逻辑保持不变…
  return addThreadEvent(
    thread,
    {
      type: 'status_change',
      status,
      ...(message ? { message } : {}),
      ...(options.failureClass ? { failureClass: options.failureClass } : {}),
    },
    options,
  )
}
```

`src/hooks/useAgentRunController.ts:311-317` —— 两处补 run 级分类：

```ts
        if (result.status === 'stopped') {
          addLog({ tone: 'warn', title: copy.runStopped })
          recordThreadStatus(session, 'stopped', copy.runStopped, { failureClass: 'aborted' })
        }
        // …
        if (result.status === 'loop_guard') {
          addLog({ tone: 'warn', title: copy.loopGuardStopped, detail: result.reason })
          recordThreadStatus(session, 'stopped', result.reason ?? copy.loopGuardStopped, {
            failureClass: 'loop_guard',
          })
        }
```

其余分支（`done` / `max_steps` / `awaiting_review` / `awaiting_takeover`）**不加** run 级分类 —— 它们的失败信息已经由 step 级 `failureClass` 承载，`max_steps` 是预算耗尽而非失败。

失败分支（`:877-893`）保持不变 —— 它调用的 `isAutoRecoverableExecutionFailure` 现在来自新模块，语义已按白名单收窄。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/agent.test.ts src/lib/agentThread.test.ts`
Expected: PASS（含两个文件原有的全部用例）

- [ ] **Step 5: 跑全量测试，确认行为改动的影响面**

Run: `npm test`
Expected: PASS。**若有既有用例断言「执行失败会被自动重试 2 次」，它们会失败 —— 这正是预期的行为改动**。逐个检查失败用例：若它测的是 `device_io`/`device_timeout`，应仍然通过；若它测的是其它种类（如不支持的动作、自定义工具失败），则该用例的期望值需要更新为「一次即 `awaiting_review`」，并在提交信息里说明。

- [ ] **Step 6: 提交**

```bash
git add src/lib/agent.ts src/lib/agent.test.ts
git commit -m "feat(agent): classify step failures and retry only transient device errors"
```

---

# Part 2 — runId 与 trajectory

### Task 5: `runId` 端到端贯通

**Files:**
- Modify: `src/lib/agent.ts`（`AgentStep`、`RunAgentStepInput`、`createAgentRunner().run()`、`runAgentStep()` 的两个 return 点 `:546`/`:618`）
- Modify: `src/lib/agentThread.ts`（`AgentTurn:75`、`StartThreadTurnInput:274`、`startThreadTurn():290`、`recordThreadTurnExecution():333`）
- Test: `src/lib/agent.test.ts`、`src/lib/agentThread.test.ts`

**Interfaces:**
- Consumes: `AgentStep`（Task 4）
- Produces: `AgentStep.runId?: string`；`AgentTurn.runId?: string`；`startThreadTurn` 接受 `runId`；`createAgentRunner().run()` 内铸造一次

- [ ] **Step 1: 写失败测试**

追加到 `src/lib/agentThread.test.ts`:

```ts
describe('turn runId', () => {
  it('persists the run id handed to startThreadTurn', () => {
    const thread = createAgentThread('task')
    const turn = startThreadTurn(thread, {
      index: 1,
      task: 'task',
      promptContext: 'ctx',
      deviceSnapshot: { index: 1, currentApp: 'Chrome', deviceState: { app: 'Chrome' }, screenshot: { dataUrl: '', screen: { width: 1, height: 1 } } },
      modelOutput: '{}',
      action: { action: 'wait', ms: 1 },
      executionAction: { action: 'wait', ms: 1 },
      preview: 'wait 1ms',
      timing: { captureMs: 0, currentAppMs: 0, modelMs: 0, parseMs: 0, totalMs: 0 },
      runId: 'run_test',
    })
    expect(turn.runId).toBe('run_test')
  })

  it('still validates old threads that have no runId', () => {
    const legacy = { id: 't1', status: 'idle', turns: [], messages: [], createdAt: 1, updatedAt: 1 }
    expect(isAgentThread(legacy)).toBe(true)
  })
})
```

追加到 `src/lib/agent.test.ts`（复用 Task 4 已在同文件建立的 `sequentialClient()`、`MODEL_CONFIG` 与既有 `fakeDevice()`）：

```ts
it('stamps every step of one run with the same runId, and a new run with a new one', async () => {
  const client = sequentialClient(['{"action":"wait","ms":1}'])
  const runner = createAgentRunner({ device: fakeDevice(), client })

  const first = await runner.run({
    modelConfig: MODEL_CONFIG,
    task: 'a',
    autoExecute: true,
    maxSteps: 2,
  })
  const second = await runner.run({
    modelConfig: MODEL_CONFIG,
    task: 'b',
    autoExecute: true,
    maxSteps: 1,
  })

  const firstIds = new Set(first.steps.map((step) => step.runId))
  expect(firstIds.size).toBe(1)
  const [firstRunId] = [...firstIds]
  expect(firstRunId).toBeTruthy()
  expect(second.steps[0]?.runId).toBeTruthy()
  expect(second.steps[0]?.runId).not.toBe(firstRunId)
})
```

> `maxSteps: 2` 配 `sequentialClient` 的单元素输出会得到两个 `wait` 步骤（`sequentialClient` 在越界后重复最后一个输出）—— 这正是本用例需要的「一次 run 内多个 step」。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/agentThread.test.ts src/lib/agent.test.ts -t "runId"`
Expected: FAIL —— `expected undefined to be 'run_test'`

- [ ] **Step 3: 实现**

`src/lib/agentThread.ts` —— `AgentTurn`（`:75`）加 `runId?: string`；`StartThreadTurnInput`（`:274`）加 `runId?: string`；`startThreadTurn()`（`:290`）在构造 turn 时写入：

```ts
  const turn: AgentTurn = {
    id: input.id ?? createId('turn'),
    ...(input.runId ? { runId: input.runId } : {}),
    // …其余字段不变…
  }
```

`src/lib/agent.ts` —— `AgentStep`（`:73`）加 `runId?: string`；`RunAgentStepInput`（`:96`）加 `runId?: string`；`runAgentStep` 解构参数加 `runId`，并在**两个** return 点（`:546`、`:618`）写入：

```ts
    turnId: turn?.id,
    ...(runId ? { runId } : {}),
```

`startThreadTurn` 调用处（`:517`）透传：

```ts
      const turn = session
        ? startThreadTurn(session, {
            index,
            runId,
            // …其余字段不变…
          })
```

`createAgentRunner().run()`（`:704` 之后）铸造一次并透传：

```ts
    async run(input: AgentRunnerInput): Promise<AgentRunResult> {
      const steps: AgentStep[] = []
      const session = input.session ?? createAgentSession(input.task)
      const startIndex = nextAgentStepIndex(session)
      const runId = createRunId()
      // …原有计数器不变…
```

在 `:720` 的 `runAgentStep({...})` 调用里加 `runId,`。

文件末尾加私有助手（`createId` 在 `agentThread.ts` 未导出，故本文件自带一个）：

```ts
function createRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/agent.test.ts src/lib/agentThread.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/agent.ts src/lib/agentThread.ts src/lib/agent.test.ts src/lib/agentThread.test.ts
git commit -m "feat(agent): give each run a stable runId so a run can be sliced out of a thread"
```

---

### Task 6: `deviceCommands` 采集

**Files:**
- Modify: `src/adapters/deviceTypes.ts`（`ExecuteActionOptions`）
- Modify: `src/adapters/webAdbBackend.ts:315`（`execute` 拆成 wrapper + `#executeAction`）、`:503`（`#executeCommandStep` 回调）
- Modify: `src/lib/toolRegistry.ts:488`、`:514`（透传 `context.onDeviceCommand`）
- Modify: `src/lib/agent.ts:832`（runner 循环收集）、`src/hooks/useAgentRunController.ts:156`（pending step 收集）
- Modify: `src/lib/agent.ts`（`AgentStep.deviceCommands?: string[][]`）
- Test: `src/adapters/deviceCommandRecording.test.ts`（新建）

**Interfaces:**
- Consumes: `ActionToolContext.onDeviceCommand`（Task 3）
- Produces: `ExecuteActionOptions.onDeviceCommand?: (argv: readonly string[]) => void`；`AgentStep.deviceCommands?: string[][]`

**为什么把「哪些步骤可上报」抽成纯函数**：`#executeCommandStep` 是 `#` 私有方法，测试无法直接调用，而任何能走到它的公开路径都要先 `#requireAdb()`（需要真机）。因此把判定规则抽成可导出的纯函数，让「`{ waitMs }` 定时项不上报」这条规则获得**离线可测**的落点。

- [ ] **Step 1: 写失败测试**

Create `src/adapters/deviceCommandRecording.test.ts`（新文件，纯函数 + 转发行为，全部离线）：

```ts
import { describe, expect, it } from 'vitest'
import { toReportableDeviceCommand } from './deviceTypes'
import { createDefaultActionToolRegistry } from '../lib/toolRegistry'

describe('toReportableDeviceCommand', () => {
  it('reports an argv step as a copy', () => {
    const step = ['input', 'keyevent', 'KEYCODE_HOME']
    const reported = toReportableDeviceCommand(step)
    expect(reported).toEqual(step)
    expect(reported).not.toBe(step)
  })

  it('reports nothing for a timer step, because a wait is not a command', () => {
    expect(toReportableDeviceCommand({ waitMs: 250 })).toBeNull()
  })
})

describe('tool registry command forwarding', () => {
  it('forwards onDeviceCommand to the device backend', async () => {
    const recorded: string[][] = []
    const registry = createDefaultActionToolRegistry()
    const device = {
      execute: async (_action: unknown, options?: { onDeviceCommand?: (argv: readonly string[]) => void }) => {
        options?.onDeviceCommand?.(['input', 'tap', '1', '2'])
        return 'tapped'
      },
      screenshot: async () => ({ dataUrl: '', screen: { width: 1080, height: 2316 } }),
      getCurrentApp: async () => 'Chrome',
      getDeviceState: async () => ({ app: 'Chrome' }),
    }

    const result = await registry.execute(
      { action: 'tap', x: 1, y: 2 } as never,
      { device, onDeviceCommand: (argv) => recorded.push([...argv]) } as never,
    )

    expect(result.success).toBe(true)
    expect(recorded).toEqual([['input', 'tap', '1', '2']])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/adapters/deviceCommandRecording.test.ts`
Expected: FAIL —— `toReportableDeviceCommand` 不是导出成员，且 `recorded` 为空

- [ ] **Step 3: 实现**

`src/adapters/deviceTypes.ts` —— 加纯函数（`DeviceCommandStep` 已在本文件定义）：

```ts
/**
 * The argv a backend should report for a command step, or null for timer
 * steps. Kept pure so the "waits are not commands" rule is testable without a
 * device.
 */
export function toReportableDeviceCommand(step: DeviceCommandStep): readonly string[] | null {
  return Array.isArray(step) ? [...step] : null
}
```

同文件 `ExecuteActionOptions` 加：

```ts
export type ExecuteActionOptions = {
  confirmSensitiveAction?: (message: string, action: AgentAction) => boolean | Promise<boolean>
  signal?: AbortSignal
  /** Reports each argv the backend is about to send, in order. */
  onDeviceCommand?: (argv: readonly string[]) => void
}
```

`src/adapters/webAdbBackend.ts` —— 把现有 `execute()`（`:315`）改名为 `#executeAction()`，并加一个包装方法。**必须 save/restore**，因为 `#executeCompositeAction` 会递归调用 `execute()`：

```ts
  #onDeviceCommand: ((argv: readonly string[]) => void) | undefined

  async execute(action: AgentAction, options?: ExecuteActionOptions): Promise<string> {
    const previous = this.#onDeviceCommand
    if (options?.onDeviceCommand) {
      this.#onDeviceCommand = options.onDeviceCommand
    }
    try {
      return await this.#executeAction(action, options)
    } finally {
      this.#onDeviceCommand = previous
    }
  }

  async #executeAction(action: AgentAction, options?: ExecuteActionOptions): Promise<string> {
    // …原 execute() 的完整体保持不变…
  }
```

`#executeCommandStep`（`:503`）—— 回调必须放在 `#requireAdb()` **之前**，这样记录发生在需要真机之前：

```ts
  async #executeCommandStep(step: DeviceCommandStep, signal?: AbortSignal) {
    throwIfAborted(signal)
    const reported = toReportableDeviceCommand(step)
    if (!reported) {
      await delayWithAbort((step as { waitMs: number }).waitMs, signal)
      return
    }

    this.#onDeviceCommand?.(reported)
    const adb = this.#requireAdb()
    // …其余不变（spawnWait 仍然传原始的 step）…
  }
```

> 注意：原实现用 `isWaitStep(step)` 做类型收窄。改成上面的写法后，`isWaitStep` 仍可保留给别处使用；若因此变成未使用符号，`tsconfig` 的 `noUnusedLocals` 会让 `npm run build` 失败 —— 此时删掉 `isWaitStep`（`:689`）并确认无其他引用。

`src/lib/toolRegistry.ts` —— 两处 `context.device.execute(...)`（`:488`、`:514`）在 options 里加透传：

```ts
  return context.device.execute(action, {
    signal: context.signal,
    ...(context.confirmSensitiveAction ? { confirmSensitiveAction: context.confirmSensitiveAction } : {}),
    ...(context.onDeviceCommand ? { onDeviceCommand: context.onDeviceCommand } : {}),
  })
```

（按两处调用点现有的 options 组装方式插入 `onDeviceCommand`，不要改动其它键。）

`src/lib/agent.ts` —— `AgentStep` 加 `deviceCommands?: string[][]`；runner 循环（`:832`）收集：

```ts
        const deviceCommands: string[][] = []
        try {
          result = await toolRegistry.execute(step.executionAction, {
            device,
            // …其余字段不变…
            onDeviceCommand: (argv) => deviceCommands.push([...argv]),
            signal: input.signal,
          })
        } catch (caught) {
          // …不变…
        }
        if (deviceCommands.length > 0) {
          step.deviceCommands = deviceCommands
        }
```

`src/hooks/useAgentRunController.ts:156` —— pending step 路径同理：

```ts
      const deviceCommands: string[][] = []
      const result = await actionToolRegistry.execute(pendingStep.executionAction, {
        // …其余字段不变…
        onDeviceCommand: (argv) => deviceCommands.push([...argv]),
      })
      if (deviceCommands.length > 0) {
        pendingStep.deviceCommands = deviceCommands
      }
```

并在该文件稍后的 `recordAgentStep(ensureSession(), pendingStep, ...)` 之前完成赋值（即必须在 `:174` 的 `recordAgentStep` 调用之前）。

**顺带补上手动批准路径的分类**（Task 4 复审的越界发现，其形状与 Task 4 修掉的 F1/F2 完全一致，而本任务正在改同一个函数）：`executePendingStep` 目前只把 `result.toolName` 拷回 `pendingStep`，不拷 `result.failureKind` / `result.safetyDecision`，并且 `:190-194` 记录 `awaiting_review` / `awaiting_takeover` 时**不带分类**。该路径生产可达（`PendingActionCard` 对任何待确认动作都给按钮），于是用户在界面上确认的那一步，其设备失败或安全拒绝在 step、turn 与 status 事件上全都没有标签：

```ts
      pendingStep.toolName = result.toolName
      if (result.failureKind) {
        pendingStep.failureClass = result.failureKind
      }
      if (result.safetyDecision) {
        pendingStep.safetyDecision = result.safetyDecision
      }
```

并在该函数记录 `awaiting_review` / `awaiting_takeover` 的 `recordThreadStatus` 调用里带上 `{ failureClass: pendingStep.failureClass }`（无分类时可省略）。

**`deviceCommands` 也要落到 `AgentTurn` 上**（Task 7 的投影只从 `thread.turns` 读）：`AgentTurn`（`agentThread.ts:75`）加 `deviceCommands?: string[][]`，`recordThreadTurnExecution` 的 input 加同名可选项并赋值，`recordAgentStep` 把 `step.deviceCommands` 透传过去 —— 与 Task 4 为 `failureClass` / `safetyDecision` 建立的同一条通道完全一致：

```ts
// AgentTurn 新增
  deviceCommands?: string[][]

// recordThreadTurnExecution 内
  if (input.deviceCommands && input.deviceCommands.length > 0) {
    turn.deviceCommands = input.deviceCommands
  }

// recordAgentStep 的 recordThreadTurnExecution 调用里
      ...(step.deviceCommands ? { deviceCommands: step.deviceCommands } : {}),
```

**再补一条循环接线的离线用例**（追加到 `src/adapters/deviceCommandRecording.test.ts`）：用一个会主动回调 `onDeviceCommand` 的 fake device 跑 `createAgentRunner().run()`，断言 `step.deviceCommands` 被填上、且 `{ waitMs }` 不会进入数组：

```ts
it('collects forwarded commands onto the executed step', async () => {
  const device = {
    connect: async () => ({ serial: 'fake', name: 'Fake' }),
    disconnect: async () => {},
    screenshot: async () => ({ dataUrl: '', screen: { width: 1080, height: 2316 } }),
    getCurrentApp: async () => 'Chrome',
    getDeviceState: async () => ({ app: 'Chrome' }),
    execute: async (
      _action: unknown,
      options?: { onDeviceCommand?: (argv: readonly string[]) => void },
    ) => {
      options?.onDeviceCommand?.(['input', 'tap', '5', '6'])
      return 'tapped'
    },
  }
  const client = { completeAction: async () => '{"action":"tap","x":5,"y":6}' }
  const runner = createAgentRunner({ device: device as never, client })
  const result = await runner.run({
    modelConfig: { baseUrl: 'http://localhost', apiKey: 't', model: 'm' },
    task: 'tap',
    autoExecute: true,
    maxSteps: 1,
  })

  expect(result.steps[0]?.deviceCommands).toEqual([['input', 'tap', '5', '6']])
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/adapters/deviceCommandRecording.test.ts src/lib/toolRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: 跑全量测试**

Run: `npm test && npm run build`
Expected: PASS —— 注意 `npm run build` 会因 `noUnusedLocals` 暴露 `isWaitStep` 是否已成死代码。

- [ ] **Step 6: 提交**

```bash
git add src/adapters/deviceTypes.ts src/adapters/webAdbBackend.ts src/lib/toolRegistry.ts src/lib/agent.ts src/hooks/useAgentRunController.ts
git commit -m "feat(device): record the argv each step actually sends"
```

---

### Task 7: trajectory 投影与脱敏

**Files:**
- Create: `src/lib/trajectory.ts`
- Test: `src/lib/trajectory.test.ts`

**Interfaces:**
- Consumes: `AgentThread` / `AgentTurn` / `AgentScreenshotReference`（Task 5/6）、`FailureClass`（Task 2）
- Produces:
  - `TRAJECTORY_SCHEMA_VERSION = 1`
  - `fnv1a32(value: string): string`
  - `type TrajectoryArtifact`（及 `TrajectoryStep`）
  - `buildTrajectoryArtifact(input: BuildTrajectoryInput): TrajectoryArtifact`
  - `serializeTrajectory(artifact: TrajectoryArtifact): string`
  - `isTrajectoryArtifact(value: unknown): value is TrajectoryArtifact`

- [ ] **Step 1: 写失败测试**

Create `src/lib/trajectory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createAgentThread, recordThreadStatus, startThreadTurn } from './agentThread'
import { buildTrajectoryArtifact, fnv1a32, serializeTrajectory } from './trajectory'

const TIMING = { captureMs: 1, currentAppMs: 2, modelMs: 3, parseMs: 4, totalMs: 10 }

function buildThread() {
  const thread = createAgentThread('打开设置')
  const base = {
    task: '打开设置',
    promptContext: 'SECRET-CONTEXT-CONTENT',
    deviceSnapshot: {
      currentApp: 'Chrome',
      deviceState: { app: 'Chrome', packageName: 'com.android.chrome' },
      screenshot: { dataUrl: '', screen: { width: 1080, height: 2316 } },
    },
    modelOutput: '{"action":"wait","ms":1}',
    action: { action: 'wait' as const, ms: 1 },
    executionAction: { action: 'wait' as const, ms: 1 },
    preview: 'wait 1ms',
    timing: TIMING,
  }
  const first = startThreadTurn(thread, { ...base, index: 1, runId: 'run_a' })
  const second = startThreadTurn(thread, { ...base, index: 2, runId: 'run_a' })
  second.failureClass = 'device_timeout'
  second.executionResult = 'device command timed out after 30000ms.'
  recordThreadStatus(thread, 'awaiting_review', 'timeout')
  return { thread, first, second }
}

const MODEL = { provider: 'openai', model: 'gpt-4o', actionProtocol: 'webdroid_json' as const }

describe('buildTrajectoryArtifact', () => {
  it('projects only the turns of the requested run', () => {
    const { thread, second } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    expect(artifact.run.stepTurnIds).toEqual([expect.any(String), second.id])
    expect(artifact.steps).toHaveLength(2)
    expect(artifact.steps[1]?.failure?.class).toBe('device_timeout')
    expect(artifact.outcome.failureClass).toBe('device_timeout')
  })

  it('summarises prompt context instead of shipping it', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL })
    const serialized = serializeTrajectory(artifact)
    expect(serialized).not.toContain('SECRET-CONTEXT-CONTENT')
    expect(artifact.steps[0]?.context).toEqual({
      chars: 'SECRET-CONTEXT-CONTENT'.length,
      digest: fnv1a32('SECRET-CONTEXT-CONTENT'),
    })
  })

  it('includes the full context only when explicitly asked', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL, includeContext: true })
    expect(artifact.steps[0]?.context).toEqual({ text: 'SECRET-CONTEXT-CONTENT' })
  })

  it('never leaks credentials, serials or pixels through the allowlist projection', () => {
    const { thread } = buildThread()
    thread.screenshotReferences = [
      {
        id: 'screenshot-step-1',
        step: 1,
        title: 'Step #1',
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        screenshot: { dataUrl: 'data:image/png;base64,AAAA', screen: { width: 1080, height: 2316 } },
        createdAt: 1,
      },
    ]
    const serialized = serializeTrajectory(
      buildTrajectoryArtifact({ thread, runId: 'run_a', model: MODEL }),
    )
    expect(serialized).not.toContain('data:image')
    expect(serialized).not.toContain('baseUrl')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('serial')
    expect(serialized).toContain('screenshot-step-1')
  })

  it('marks a thread without a runId as partial and keeps an empty run id', () => {
    const { thread } = buildThread()
    const artifact = buildTrajectoryArtifact({ thread, runId: '', model: MODEL })
    expect(artifact.run.runId).toBe('')
    expect(artifact.run.partial).toBe(true)
    expect(artifact.steps).toHaveLength(0)
  })
})

describe('fnv1a32', () => {
  it('is stable and prefixed', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'))
    expect(fnv1a32('abc')).toMatch(/^fnv1a32:[0-9a-f]{8}$/)
    expect(fnv1a32('abc')).not.toBe(fnv1a32('abd'))
  })
})

describe('run-level outcome fallback', () => {
  it('uses the status change class when no step failed', () => {
    const thread = createAgentThread('打开设置')
    startThreadTurn(thread, {
      index: 1,
      runId: 'run_b',
      task: '打开设置',
      promptContext: 'ctx',
      deviceSnapshot: {
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        screenshot: { dataUrl: '', screen: { width: 1080, height: 2316 } },
      },
      modelOutput: '{"action":"wait","ms":1}',
      action: { action: 'wait', ms: 1 },
      executionAction: { action: 'wait', ms: 1 },
      preview: 'wait 1ms',
      timing: TIMING,
    })
    recordThreadStatus(thread, 'stopped', 'loop guard', { failureClass: 'loop_guard' })

    const artifact = buildTrajectoryArtifact({ thread, runId: 'run_b', model: MODEL })
    expect(artifact.steps.every((step) => step.failure === undefined)).toBe(true)
    expect(artifact.outcome.failureClass).toBe('loop_guard')
  })
})
```

> 上面的 `buildThread()` 内定义的 `base` 对象在 `buildTrajectoryArtifact` 的用例间复用；`run-level outcome` 这组用例自带完整 turn 输入，不依赖它。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/trajectory.test.ts`
Expected: FAIL —— `Failed to resolve import "./trajectory"`

- [ ] **Step 3: 实现**

Create `src/lib/trajectory.ts`。关键纪律：**用允许列表构造新对象，绝不 spread 原始 turn**，这样 `baseUrl`/`apiKey`/`serial`/`promptContext` 全文/像素在结构上不可能泄漏。

```ts
import type { AgentScreenshotReference, AgentThread, AgentTurn } from './agentThread'
import type { ActionProtocol, ActionCoordinateMode } from './actionProtocol'
import type { AgentAction, ScreenSize } from './actionTypes'
import type { FailureClass } from './failureTaxonomy'
import type { AgentRunStatus } from './agent'
import type { AgentTurnTiming } from './agentThread'
import type { ActionSafetyDecision } from './actionSafetyPolicy'
import type { DeviceState } from '../adapters/deviceTypes'

export const TRAJECTORY_SCHEMA_VERSION = 1

/** Portable, synchronous, dependency-free digest. Not a security hash. */
export function fnv1a32(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

export type TrajectoryStep = {
  index: number
  turnId: string
  timing: AgentTurnTiming
  currentApp: string
  deviceState: DeviceState
  context: { chars: number; digest: string } | { text: string }
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  toolName?: string
  executionResult: string
  success?: boolean
  failure?: { class: FailureClass; message: string }
  safetyDecision?: ActionSafetyDecision
  deviceCommands?: string[][]
  screenshot?: { id: string; step: number; screen: ScreenSize; modelScreen?: ScreenSize }
}

export type TrajectoryArtifact = {
  schemaVersion: typeof TRAJECTORY_SCHEMA_VERSION
  kind: 'webdroid.trajectory'
  exportedAt: string
  app: { version: string }
  run: {
    runId: string
    threadId: string
    task: string
    status: AgentRunStatus
    startedAt: number
    endedAt?: number
    partial: boolean
    stepTurnIds: string[]
  }
  model: {
    provider?: string
    model: string
    actionProtocol: ActionProtocol
    coordinateMode: ActionCoordinateMode
  }
  device: {
    name: string
    screen: ScreenSize
    modelScreen?: ScreenSize
    orientation?: string
  }
  steps: TrajectoryStep[]
  outcome: { failureClass?: FailureClass; reason?: string }
}

export type BuildTrajectoryInput = {
  thread: AgentThread
  runId: string
  includeContext?: boolean
  /** Opt-in: adds `outcome.reason`, unredacted provider error text. Off by default. */
  includeDiagnostics?: boolean
  model: { provider?: string; model: string; actionProtocol: ActionProtocol }
  coordinateMode?: ActionCoordinateMode
  now?: number
}
```

实现要点（按此顺序）：

1. `const turns = thread.turns.filter((turn) => turn.runId === input.runId)`；`input.runId === ''` 时 `turns = []`。
2. `status`：由 `thread.status` 映射到 `AgentRunStatus` —— `'awaiting_review'`/`'awaiting_takeover'`/`'done'` 原样；`'stopped'` → `'stopped'`；其余 → `'done'`。
3. `partial = input.runId === '' || thread.status === 'running' || turns.at(-1)?.completedAt === undefined`。
4. 截图引用按步号 join：`thread.screenshotReferences?.find((reference) => reference.step === turn.index)` → 只取 `{ id, step, screen, modelScreen }`（**不取 `screenshot.dataUrl`**）。
5. `context`：`includeContext ? { text: turn.promptContext } : { chars: turn.promptContext.length, digest: fnv1a32(turn.promptContext) }`。
6. `device`：取第一个 turn 的 `deviceSnapshot`；`screen` 来自该 turn 的 deviceState 对应截图引用（找不到则用 `{ width: 0, height: 0 }`）；`modelScreen` 取截图引用的 `modelScreen`；`orientation` 取 `deviceSnapshot.deviceState.orientation`；`name` 固定 `'android-device'`（**不记录真实 serial**，因为 `AgentTurn` 里也没有它 —— 这是结构性的脱敏，不是过滤）。
7. `outcome.failureClass`：**先**最后一个带 `failureClass` 的 turn → **否则**该 run 起点（`turns[0].createdAt`）之后最后一个带 `failureClass` 的 `status_change` 事件（覆盖 `loop_guard` / `aborted` 这两个 run 级结局，见 spec §5.4）→ 否则 `undefined`。
8. 每个 step 逐字段复制允许列表：`index`、`turnId`、`timing`、`currentApp`、`deviceState`、`context`、`modelOutput`、`action`、`executionAction`、`toolName`、`executionResult`（缺省 `''`）、`success`、`safetyDecision`、`deviceCommands`、`screenshot`；`failure` 仅在 `turn.failureClass` 存在时写入 `{ class, message: turn.executionResult ?? '' }`。
9. `app.version`：`typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'`。
10. `coordinateMode`：`input.coordinateMode ?? coordinateModeForActionProtocol(input.model.actionProtocol)` —— **从 `./coordinateSystems` 导入**（`src/lib/coordinateSystems.ts:5`），不是 `./actionProtocol`。
11. `isTrajectoryArtifact(value)`：校验 `schemaVersion === 1` 且 `kind === 'webdroid.trajectory'` 且 `steps` 是数组。
12. `serializeTrajectory`：`JSON.stringify(artifact, null, 2)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/trajectory.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/trajectory.ts src/lib/trajectory.test.ts
git commit -m "feat(agent): project a run into a versioned, sanitised trajectory artifact"
```

---

### Task 8: 导出入口

**Files:**
- Modify: `src/lib/appCopy.en-US.ts`、`src/lib/appCopy.zh-CN.ts`
- Modify: `src/components/SettingsDialog.tsx:347` 附近
- Modify: `src/App.tsx:520` 的 `handleExportChatHistory` 旁
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: `buildTrajectoryArtifact`（Task 7）、`downloadJsonFile`（`src/lib/fileExport.ts:8`）、`ensureSession()`（`useAgentSessionHistory` 暴露的当前线程访问器，`src/hooks/useAgentSessionHistory.ts:313`）、App 内部的 `addLog`（`useRunLog()`，`App.tsx:164`）与 `copy`
- Produces: 设置面板中的「导出最近一次运行的 trajectory」动作

> **真实标识符（已核实，勿凭印象改写）**：App.tsx 里**没有** `sessionRef`，当前线程通过 `ensureSession()` 取得；文案是局部变量 `copy`（不是 `copyRef.current`）；该文件的导出处理器是普通 `function`（不是 `useCallback`），照 `handleExportChatHistory`（`:520`）的风格写。

- [ ] **Step 1: 写失败测试**

追加到 `src/App.test.tsx`（沿用该文件既有的渲染与交互 helper）：

```tsx
it('exports the most recent run as a trajectory file', async () => {
  const download = vi.spyOn(fileExport, 'downloadJsonFile').mockImplementation(() => {})
  renderApp()
  await openSettings()
  await userEvent.click(screen.getByRole('button', { name: copy.exportTrajectory }))
  expect(download).toHaveBeenCalledWith(
    'webdroid-agent-trajectory.json',
    expect.objectContaining({ kind: 'webdroid.trajectory', schemaVersion: 1 }),
  )
})
```

（`fileExport` 的 import 方式与该文件已有的 mock 风格保持一致；若该文件尚无 mock 先例，用 `vi.mock('./lib/fileExport', ...)`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/App.test.tsx -t "trajectory file"`
Expected: FAIL —— 找不到名为 `exportTrajectory` 的按钮

- [ ] **Step 3: 实现**

`src/lib/appCopy.en-US.ts` / `appCopy.zh-CN.ts` 各加三个键（两份必须同名同数量，`appCopy.test.ts` 会强制）：

```ts
  exportTrajectory: 'Export trajectory',
  exportTrajectoryUnavailable: 'No run to export yet.',
  trajectoryExported: 'Trajectory exported',
```

```ts
  exportTrajectory: '导出本次运行轨迹',
  exportTrajectoryUnavailable: '还没有可导出的运行记录。',
  trajectoryExported: '运行轨迹已导出',
```

`src/App.tsx` —— 在 `handleExportChatHistory`（`:520`）**旁**加一个同风格的普通函数：

```ts
  function handleExportTrajectory() {
    const session = ensureSession()
    const lastTurn = [...session.turns].reverse().find((turn) => turn.runId)
    if (!lastTurn?.runId) {
      addLog({ tone: 'warn', title: copy.exportTrajectoryUnavailable })
      return
    }
    downloadJsonFile(
      'webdroid-agent-trajectory.json',
      buildTrajectoryArtifact({
        thread: session,
        runId: lastTurn.runId,
        model: {
          provider: modelConfig.provider,
          model: modelConfig.model,
          actionProtocol,
        },
      }),
    )
    addLog({ tone: 'info', title: copy.trajectoryExported })
  }
```

`ensureSession` 已在 App 的解构里（`:401`）；顶部加 `import { buildTrajectoryArtifact } from './lib/trajectory'`。把 `handleExportTrajectory` 作为 `onExportTrajectory` 传给 `SettingsDialog`（参照该组件已有的 `onExportChatHistory` prop 传法），并在 `SettingsDialog.tsx:347` 的导出按钮旁渲染同名按钮。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/App.test.tsx src/lib/appCopy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/App.tsx src/components/SettingsDialog.tsx src/lib/appCopy.en-US.ts src/lib/appCopy.zh-CN.ts src/App.test.tsx
git commit -m "feat(ui): export the most recent run as a trajectory file"
```

---

# Part 3 — 夹具与 CI

### Task 9: fixture 生成器

**Files:**
- Create: `src/lib/trajectoryFixture.ts`、`scripts/trajectory-to-fixture.mjs`
- Modify: `package.json`（scripts）
- Test: `src/lib/trajectoryFixture.test.ts`、`test/fixtureReplay/loadFixtures.ts`（共享加载器）

**Interfaces:**
- Consumes: `TrajectoryArtifact`（Task 7）
- Produces:
  - `type ActionFixture` / `type CoordinateFixture`（含 `schemaVersion`、`name`、`source`、`input`、`expected`、`note?`）
  - `trajectoryToActionFixtures(artifact): ActionFixture[]`
  - `trajectoryToCoordinateFixtures(artifact): CoordinateFixture[]`
  - `serializeFixture(fixture): string`

- [ ] **Step 1: 写失败测试**

Create `src/lib/trajectoryFixture.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { trajectoryToActionFixtures, trajectoryToCoordinateFixtures } from './trajectoryFixture'
import type { TrajectoryArtifact } from './trajectory'

function artifact(step: Partial<TrajectoryArtifact['steps'][number]> = {}): TrajectoryArtifact {
  return {
    schemaVersion: 1,
    kind: 'webdroid.trajectory',
    exportedAt: '2026-09-13T00:00:00.000Z',
    app: { version: '0.2.0' },
    run: { runId: 'run_a', threadId: 't1', task: 'tap', status: 'done', startedAt: 1, partial: false, stepTurnIds: ['turn_1'] },
    model: { model: 'gpt-4o', actionProtocol: 'webdroid_json', coordinateMode: 'screenshot_pixels' },
    device: { name: 'android-device', screen: { width: 1080, height: 2316 }, modelScreen: { width: 720, height: 1544 } },
    steps: [
      {
        index: 1,
        turnId: 'turn_1',
        timing: { captureMs: 0, currentAppMs: 0, modelMs: 0, parseMs: 0, totalMs: 0 },
        currentApp: 'Chrome',
        deviceState: { app: 'Chrome' },
        context: { chars: 3, digest: 'fnv1a32:00000000' },
        modelOutput: '{"action":"tap","x":100,"y":200}',
        action: { action: 'tap', x: 100, y: 200 },
        executionAction: { action: 'tap', x: 150, y: 300 },
        executionResult: 'ok',
        success: true,
        ...step,
      },
    ],
    outcome: {},
  }
}

describe('trajectoryToActionFixtures', () => {
  it('derives a parse fixture from the recorded model output', () => {
    const [fixture] = trajectoryToActionFixtures(artifact())
    expect(fixture?.input.modelOutput).toBe('{"action":"tap","x":100,"y":200}')
    expect(fixture?.expected.action).toEqual({ action: 'tap', x: 100, y: 200 })
    expect(fixture?.source).toBe('trajectory:run_a#1')
    expect(fixture?.schemaVersion).toBe(1)
  })
})

describe('trajectoryToCoordinateFixtures', () => {
  it('pairs the model-space action with the native-space execution action', () => {
    const [fixture] = trajectoryToCoordinateFixtures(artifact())
    expect(fixture?.input.fromScreen).toEqual({ width: 720, height: 1544 })
    expect(fixture?.input.toScreen).toEqual({ width: 1080, height: 2316 })
    expect(fixture?.expected.action).toEqual({ action: 'tap', x: 150, y: 300 })
  })

  it('skips steps without a model screen, which cannot be replayed', () => {
    const bare = artifact()
    delete bare.device.modelScreen
    expect(trajectoryToCoordinateFixtures(bare)).toEqual([])
  })
})

describe('determinism', () => {
  it('produces byte-identical output for the same input', () => {
    const a = JSON.stringify(trajectoryToActionFixtures(artifact()))
    const b = JSON.stringify(trajectoryToActionFixtures(artifact()))
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/trajectoryFixture.test.ts`
Expected: FAIL —— `Failed to resolve import "./trajectoryFixture"`

- [ ] **Step 3: 实现**

Create `src/lib/trajectoryFixture.ts`:

```ts
import type { ActionProtocol, ActionCoordinateMode } from './actionProtocol'
import type { AgentAction, ScreenSize } from './actionTypes'
import type { TrajectoryArtifact } from './trajectory'

export const FIXTURE_SCHEMA_VERSION = 1

export type ActionFixture = {
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION
  kind: 'webdroid.action-fixture'
  name: string
  source: string
  input: {
    modelOutput: string
    screen: ScreenSize
    actionProtocol: ActionProtocol
    coordinateMode: ActionCoordinateMode
  }
  expected: { action: AgentAction } | { error: { messageIncludes: string } }
  note?: string
}

export type CoordinateFixture = {
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION
  kind: 'webdroid.coordinate-fixture'
  name: string
  source: string
  input: { action: AgentAction; fromScreen: ScreenSize; toScreen: ScreenSize }
  expected: { action: AgentAction }
  note?: string
}

export function trajectoryToActionFixtures(artifact: TrajectoryArtifact): ActionFixture[] {
  const coordinateMode = artifact.model.coordinateMode
  return artifact.steps
    .filter((step) => step.modelOutput.trim() !== '')
    .map((step) => ({
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      kind: 'webdroid.action-fixture',
      name: `${artifact.run.runId}-step-${step.index}`,
      source: `trajectory:${artifact.run.runId}#${step.index}`,
      input: {
        modelOutput: step.modelOutput,
        screen: artifact.device.modelScreen ?? artifact.device.screen,
        actionProtocol: artifact.model.actionProtocol,
        coordinateMode,
      },
      expected: { action: step.action },
      note: 'expected values are the recorded action; confirm before committing',
    }))
}

export function trajectoryToCoordinateFixtures(artifact: TrajectoryArtifact): CoordinateFixture[] {
  const fromScreen = artifact.device.modelScreen
  if (!fromScreen) {
    return []
  }
  return artifact.steps
    .filter((step) => hasCoordinates(step.action))
    .map((step) => ({
      schemaVersion: FIXTURE_SCHEMA_VERSION,
      kind: 'webdroid.coordinate-fixture',
      name: `${artifact.run.runId}-step-${step.index}`,
      source: `trajectory:${artifact.run.runId}#${step.index}`,
      input: { action: step.action, fromScreen, toScreen: artifact.device.screen },
      expected: { action: step.executionAction },
      note: 'expected values are the recorded execution action; confirm before committing',
    }))
}

function hasCoordinates(action: AgentAction) {
  return 'x' in action && 'y' in action
}

export function serializeFixture(fixture: ActionFixture | CoordinateFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`
}
```

Create `scripts/trajectory-to-fixture.mjs`（**纯 JS、不 import src**，只做数据重塑，因此不需要任何构建步骤）：

```js
#!/usr/bin/env node
// Usage: node scripts/trajectory-to-fixture.mjs <trajectory.json> [--out test/fixtures]
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const [, , inputPath, ...rest] = process.argv
if (!inputPath) {
  console.error('Usage: node scripts/trajectory-to-fixture.mjs <trajectory.json> [--out test/fixtures]')
  process.exit(1)
}
const outIndex = rest.indexOf('--out')
const outRoot = resolve(outIndex === -1 ? 'test/fixtures' : rest[outIndex + 1])

const artifact = JSON.parse(readFileSync(resolve(inputPath), 'utf8'))
if (artifact.kind !== 'webdroid.trajectory' || artifact.schemaVersion !== 1) {
  console.error(`Unsupported artifact: kind=${artifact.kind} schemaVersion=${artifact.schemaVersion}`)
  process.exit(1)
}
if (JSON.stringify(artifact).includes('data:image')) {
  console.error('Refusing to generate fixtures: the trajectory contains inline image data.')
  process.exit(1)
}

const { actionFixtures, coordinateFixtures } = project(artifact)

// Determinism check: same input must produce byte-identical output.
const again = project(artifact)
if (JSON.stringify(again) !== JSON.stringify({ actionFixtures, coordinateFixtures })) {
  console.error('Non-deterministic projection; refusing to write fixtures.')
  process.exit(1)
}

writeAll(join(outRoot, 'actions'), actionFixtures)
writeAll(join(outRoot, 'coordinates'), coordinateFixtures)
console.log(`Wrote ${actionFixtures.length} action + ${coordinateFixtures.length} coordinate fixtures to ${outRoot}`)
console.log('Review the "expected" values by hand before committing.')
```

`project(artifact)` 与 `writeAll(dir, fixtures)` 用与 `trajectoryFixture.ts` 相同的字段规则实现（`kind`/`schemaVersion`/`name`/`source`/`input`/`expected`/`note`）；`writeAll` 以 `fixture.name + '.json'` 落盘，覆写同名文件。

`package.json` scripts 加：

```json
    "trajectory:fixture": "node scripts/trajectory-to-fixture.mjs"
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/trajectoryFixture.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/trajectoryFixture.ts src/lib/trajectoryFixture.test.ts scripts/trajectory-to-fixture.mjs package.json
git commit -m "feat(test): derive replay fixtures from a recorded trajectory"
```

---

### Task 10: Layer 1 重放用例

**Files:**
- Create: `test/fixtureReplay/loadFixtures.ts`
- Create: `test/fixtureReplay/actions.test.ts`、`test/fixtureReplay/coordinates.test.ts`、`test/fixtureReplay/commands.test.ts`
- Create: `test/fixtures/actions/*.json`（6 个种子夹具）
- Create: `test/fixtures/coordinates/*.json`（3 个种子夹具）
- Create: `test/fixtures/commands/*.json`（2 个种子夹具）
- Modify: `src/lib/trajectoryFixture.ts`（补 `CommandFixture` 类型）

**Interfaces:**
- Consumes: `parseModelAction`（`src/lib/actionParser.ts:7`）、`mapActionCoordinates`（`src/lib/screenshot/coordinates.ts:85`）、`ActionFixture`/`CoordinateFixture`（Task 9）
- Produces: `loadFixtures<T>(dir: string): T[]`

- [ ] **Step 1: 写加载器与夹具**

Create `test/fixtureReplay/loadFixtures.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

export function loadFixtures<T>(relativeDir: string): T[] {
  const dir = path.join(process.cwd(), relativeDir)
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as T)
}
```

Create 6 action fixtures under `test/fixtures/actions/`。每个都带 `schemaVersion: 1`、`kind: 'webdroid.action-fixture'`、`name`、`source: 'handwritten'`、`input`、`expected`：

1. `canonical-tap.json` —— `modelOutput: "{\"action\":\"tap\",\"x\":100,\"y\":200}"`，`screen: {width:1080,height:2316}`，`actionProtocol: "webdroid_json"`，`coordinateMode: "screenshot_pixels"`，期望 `{action:'tap',x:100,y:200}`
2. `open-autoglm-alias.json` —— `modelOutput: "<answer>do(action=\"Tap\", element=[10, 20])</answer>"`，期望 `{action:'tap',x:10,y:20}`（若实际别名/格式不被接受，**以实测结果为准修正本夹具的 modelOutput 与期望，并在 `note` 里写明实际接受的形状**——本夹具的目的是锁住真实解析行为，不是表达愿望）
3. `markdown-wrapped.json` —— 用 ```` ```json … ``` ```` 包裹的同一 JSON，期望解析成功
4. `normalized-0-1000.json` —— `actionProtocol: "webdroid_normalized_json"`、`coordinateMode: "normalized_0_1000"`、坐标 `500/500`，期望像素落在屏幕中心附近（用 `expected.error` 之外的真实值；**该值必须由实跑捕获后填入**）
5. `invalid-package.json` —— `{"action":"launch","packageName":"not a package!"}`，期望 `{error:{messageIncludes:'package'}}`
6. `non-json-prose.json` —— 纯散文输出，期望 `{error:{messageIncludes:'JSON'}}`

Create 3 coordinate fixtures under `test/fixtures/coordinates/`：

1. `identity.json` —— `fromScreen === toScreen`，期望等于输入动作（**可证明**，无需捕获）
2. `model-to-native.json` —— `fromScreen {720,1544}` → `toScreen {1080,2316}`，`note` 里抄下 `mapPoint` 的真实公式，`expected` 由实跑捕获
3. `boundary-clamp.json` —— 坐标取 `0` 与屏幕边界值，断言不越界

Create 2 command fixtures under `test/fixtures/commands/`（**这是 spec §7 所说 `deviceCommands` 的真正用途** —— 用纯函数构造器锁住命令构造，离线可跑，覆盖 `shellEscape` 安全路径）：

`set-clipboard-escapes-metacharacters.json`:

```json
{
  "schemaVersion": 1,
  "kind": "webdroid.command-fixture",
  "name": "set-clipboard-escapes-metacharacters",
  "source": "handwritten",
  "input": { "action": { "action": "set_clipboard", "text": "hello; rm -rf / && echo 'pwned'" } },
  "expected": { "argv": [] },
  "note": "argv captured from buildSetClipboardCommand; the raw ; and && must stay inside quoted arguments"
}
```

`dump-screen-tree.json`:

```json
{
  "schemaVersion": 1,
  "kind": "webdroid.command-fixture",
  "name": "dump-screen-tree",
  "source": "handwritten",
  "input": { "action": { "action": "dump_screen_tree" } },
  "expected": { "argv": [] },
  "note": "argv captured from buildDumpScreenTreeCommand"
}
```

> 两个 `expected.argv` 初始为空数组，由 Step 3 用实跑捕获填入。命令夹具的形状刻意与「真实 run 录下来的 `deviceCommands`」一致，因此第一份真机 trajectory 提交后，可直接用 `trajectoryToCommandFixtures()`（Task 9 的生成器按同一字段规则产出）替换种子。

在 `src/lib/trajectoryFixture.ts` 里补第三种夹具类型（与 Task 9 的 `FIXTURE_SCHEMA_VERSION` 共用）：

```ts
export type CommandFixture = {
  schemaVersion: typeof FIXTURE_SCHEMA_VERSION
  kind: 'webdroid.command-fixture'
  name: string
  source: string
  input: { action: AgentAction }
  expected: { argv: readonly string[] }
  note?: string
}
```

- [ ] **Step 2: 写用例**

Create `test/fixtureReplay/actions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseModelAction } from '../../src/lib/actionParser'
import type { ActionFixture } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<ActionFixture>('test/fixtures/actions')

describe('action fixtures', () => {
  it('has fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fixture of fixtures) {
    it(`${fixture.name} (${fixture.source})`, () => {
      if ('error' in fixture.expected) {
        expect(() =>
          parseModelAction(fixture.input.modelOutput, fixture.input.screen, fixture.input.actionProtocol),
        ).toThrowError(new RegExp(fixture.expected.error.messageIncludes, 'i'))
        return
      }
      const action = parseModelAction(
        fixture.input.modelOutput,
        fixture.input.screen,
        fixture.input.actionProtocol,
      )
      expect(action).toEqual(fixture.expected.action)
    })
  }
})
```

Create `test/fixtureReplay/coordinates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapActionCoordinates } from '../../src/lib/screenshot/coordinates'
import type { CoordinateFixture } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<CoordinateFixture>('test/fixtures/coordinates')

describe('coordinate fixtures', () => {
  for (const fixture of fixtures) {
    it(`${fixture.name} matches the recorded mapping`, () => {
      const mapped = mapActionCoordinates(
        fixture.input.action,
        fixture.input.fromScreen,
        fixture.input.toScreen,
      )
      expect(mapped).toEqual(fixture.expected.action)
    })

    it(`${fixture.name} stays inside the target screen`, () => {
      const mapped = mapActionCoordinates(
        fixture.input.action,
        fixture.input.fromScreen,
        fixture.input.toScreen,
      ) as { x?: number; y?: number }
      if (typeof mapped.x === 'number') {
        expect(mapped.x).toBeGreaterThanOrEqual(0)
        expect(mapped.x).toBeLessThanOrEqual(fixture.input.toScreen.width - 1)
      }
      if (typeof mapped.y === 'number') {
        expect(mapped.y).toBeGreaterThanOrEqual(0)
        expect(mapped.y).toBeLessThanOrEqual(fixture.input.toScreen.height - 1)
      }
    })
  }

  it('is the identity when both screens are the same size', () => {
    const fixture = fixtures.find((candidate) => candidate.name === 'identity')
    expect(fixture).toBeDefined()
    expect(fixture?.expected.action).toEqual(fixture?.input.action)
  })
})
```

Create `test/fixtureReplay/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSetClipboardCommand } from '../../src/adapters/inputCommands'
import { buildDumpScreenTreeCommand } from '../../src/adapters/uiAutomator'
import type { CommandFixture } from '../../src/lib/trajectoryFixture'
import { loadFixtures } from './loadFixtures'

const fixtures = loadFixtures<CommandFixture>('test/fixtures/commands')

const BUILDERS: Record<string, (action: never) => readonly string[]> = {
  set_clipboard: (action: { text: string }) => buildSetClipboardCommand(action.text),
  dump_screen_tree: () => buildDumpScreenTreeCommand(),
}

describe('command fixtures', () => {
  it('has fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fixture of fixtures) {
    it(`${fixture.name} still builds the recorded argv`, () => {
      const build = BUILDERS[fixture.input.action.action]
      expect(build, `no builder registered for ${fixture.input.action.action}`).toBeDefined()
      expect(build?.(fixture.input.action as never)).toEqual(fixture.expected.argv)
    })

    it(`${fixture.name} keeps shell metacharacters inside quoted arguments`, () => {
      const build = BUILDERS[fixture.input.action.action]
      const argv = build?.(fixture.input.action as never) ?? []
      for (const token of argv) {
        expect(token).not.toBe(';')
        expect(token).not.toBe('&&')
      }
    })
  }
})
```

> `BUILDERS` 的键就是夹具里 `input.action.action` 的值。后续从真机 trajectory 生成的命令夹具，只要动作类型在此表内即可直接重放；遇到未登记的动作类型，用例会明确报出「no builder registered」，而不是静默跳过。

- [ ] **Step 3: 逐夹具校准期望值**

Run: `npx vitest run test/fixtureReplay`
Expected: 首次运行会有若干 FAIL —— **这是本步骤的目的**。对每个失败：
- 若失败原因是「解析/构造行为与我的预期不同」，以**实测行为**为准更新夹具，并在 `note` 写明实际形状；
- 若失败原因是「实现有 bug」（例如越界、`;` 出现在独立 token 里、错误的正则语义），**停下来**，改为修实现并保留夹具期望 —— 不要为了让测试变绿而放宽期望。

捕获命令夹具的 argv 用一次性脚本，例如：

```bash
node --experimental-strip-types -e "
import('./src/adapters/inputCommands.ts').then((m) => console.log(JSON.stringify(m.buildSetClipboardCommand(\"hello; rm -rf / && echo 'pwned'\"))))
"
```

若 `--experimental-strip-types` 在本机 Node 版本下不可用，改为在 `commands.test.ts` 里临时加一个 `it.only` 打印实际 argv，抄进夹具后删除该临时用例。**无论用哪种方式，捕获值必须来自真实执行结果，不能手写猜测。**

Run: `npx vitest run test/fixtureReplay`
Expected: PASS

- [ ] **Step 4: 跑全量测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add test/fixtureReplay test/fixtures
git commit -m "test(agent): replay action and coordinate fixtures in CI"
```

---

### Task 11: CI 守卫 + README 同步

**Files:**
- Modify: `test/repo-hardening.test.ts`
- Modify: `README.md`、`README.en-US.md`（路线图、项目结构、验证小节）
- Modify: `docs/superpowers/plans/2026-07-26-webui-optimization.md`（若真机验证项仍未完成，保持原状即可，不改）

**Interfaces:**
- Consumes: `TRAJECTORY_SCHEMA_VERSION`/`FIXTURE_SCHEMA_VERSION`
- Produces: 两条 CI 强制守卫

- [ ] **Step 1: 写守卫测试**

追加到 `test/repo-hardening.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'

function collectJsonFiles(relativeDir: string): string[] {
  const dir = path.join(repoRoot, relativeDir)
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      return collectJsonFiles(child)
    }
    return entry.name.endsWith('.json') ? [child] : []
  })
}

describe('fixture guards', () => {
  it('never commits real screenshot pixels into fixtures', () => {
    for (const file of collectJsonFiles('test/fixtures')) {
      const content = readFileSync(path.join(repoRoot, file), 'utf8')
      expect(content, file).not.toContain('data:image')
    }
  })

  it('stamps every fixture with a schema version', () => {
    const files = collectJsonFiles('test/fixtures')
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
        schemaVersion?: number
      }
      expect(fixture.schemaVersion, file).toBe(1)
    }
  })
})
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run test/repo-hardening.test.ts`
Expected: PASS

- [ ] **Step 3: 故意验一次守卫真的会拦**

Run: `printf '{"schemaVersion":1,"dataUrl":"data:image/png;base64,AAAA"}' > /tmp/canary.json && cp /tmp/canary.json test/fixtures/actions/zz-canary.json && npx vitest run test/repo-hardening.test.ts; rm test/fixtures/actions/zz-canary.json`
Expected: FAIL —— 报出 `zz-canary.json` 含 `data:image`。确认拦截后已删除该文件（`git status` 应干净）。

- [ ] **Step 4: 更新文档**

- `README.md` + `README.en-US.md` 的「验证」小节：加入 `npm run trajectory:fixture <file>` 用法。
- 「项目结构」树：补 `src/lib/failureTaxonomy.ts`、`src/lib/trajectory.ts`、`src/lib/trajectoryFixture.ts`、`scripts/trajectory-to-fixture.mjs`、`test/fixtures/`、`test/fixtureReplay/`、`test/helpers/`（Task 12 会加）。
- 「路线图」：把「增强更系统的失败分类、动作重试和任务暂停恢复体验」拆开表述——失败分类与按类重试本次已交付，暂停/恢复仍待办（`- [ ]`）。
- 「当前测试主要覆盖」列表补一条：失败分类、trajectory 投影与脱敏、动作/坐标夹具重放。

- [ ] **Step 5: 提交**

```bash
git add test/repo-hardening.test.ts README.md README.en-US.md
git commit -m "test(ci): guard fixtures against pixels and missing schema versions"
```

---

# Part 4 — Layer 2

### Task 12: fake `DeviceBackend`

**Files:**
- Create: `test/helpers/fakeDeviceBackend.ts`
- Create: `test/helpers/fakeDeviceBackend.test.ts`

> **与 spec §8 的偏离（有意）**：spec 把这个文件列在 `src/adapters/` 下。改放 `test/helpers/` 的理由是 `src/` 会被打进生产 bundle，测试替身不应进入产物。功能与接口不变。

**Interfaces:**
- Consumes: `DeviceBackend`（`src/adapters/deviceTypes.ts:62`）、`DeviceBackendError`（Task 1）
- Produces:
  - `type FakeRunScript`（§Task 13 的 fixture 形状）
  - `class FakeDeviceBackend implements DeviceBackend`，含 `executedActions: AgentAction[]`、`executeCalls: number`
  - `createScriptedClient(script: FakeRunScript): OpenAiClient`

- [ ] **Step 1: 写失败测试**

Create `test/helpers/fakeDeviceBackend.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DeviceBackendError } from '../../src/adapters/deviceTypes'
import { FakeDeviceBackend, createScriptedClient, type FakeRunScript } from './fakeDeviceBackend'

const script: FakeRunScript = {
  schemaVersion: 1,
  name: 'unit',
  device: { screen: { width: 1080, height: 2316 }, modelScreen: { width: 720, height: 1544 }, currentApp: 'Chrome' },
  steps: [
    { modelOutput: '{"action":"tap","x":1,"y":2}', deviceResult: { kind: 'ok', summary: 'tapped' } },
    { modelOutput: '{"action":"tap","x":3,"y":4}', deviceResult: { kind: 'timeout', message: 'slow' } },
  ],
}

describe('FakeDeviceBackend', () => {
  it('serves geometry and app state from the script without any canvas work', async () => {
    const device = new FakeDeviceBackend(script)
    const screenshot = await device.screenshot()
    expect(screenshot.screen).toEqual({ width: 1080, height: 2316 })
    expect(screenshot.modelScreen).toEqual({ width: 720, height: 1544 })
    expect(await device.getCurrentApp()).toBe('Chrome')
  })

  it('replays ok and timeout results in order and counts calls', async () => {
    const device = new FakeDeviceBackend(script)
    await expect(device.execute({ action: 'tap', x: 1, y: 2 })).resolves.toBe('tapped')
    const error = await device.execute({ action: 'tap', x: 3, y: 4 }).catch((caught) => caught)
    expect(error).toBeInstanceOf(DeviceBackendError)
    expect((error as DeviceBackendError).kind).toBe('timeout')
    expect(device.executeCalls).toBe(2)
    expect(device.executedActions).toHaveLength(2)
  })
})

describe('createScriptedClient', () => {
  it('returns the scripted model output per step, clamping past the end', async () => {
    const client = createScriptedClient(script)
    expect(await client.completeAction({} as never)).toBe('{"action":"tap","x":1,"y":2}')
    expect(await client.completeAction({} as never)).toBe('{"action":"tap","x":3,"y":4}')
    expect(await client.completeAction({} as never)).toBe('{"action":"tap","x":3,"y":4}')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/helpers/fakeDeviceBackend.test.ts`
Expected: FAIL —— `Failed to resolve import "./fakeDeviceBackend"`

- [ ] **Step 3: 实现**

Create `test/helpers/fakeDeviceBackend.ts`:

```ts
import {
  DeviceBackendError,
  type DeviceBackend,
  type DeviceInfo,
  type DeviceScreenshot,
  type DeviceState,
} from '../../src/adapters/deviceTypes'
import type { AgentAction } from '../../src/lib/actionTypes'
import type { OpenAiClient } from '../../src/lib/openAiTypes'

export type FakeRunScript = {
  schemaVersion: 1
  name: string
  device: {
    screen: { width: number; height: number }
    modelScreen?: { width: number; height: number }
    currentApp: string
    packageName?: string
  }
  steps: {
    modelOutput: string
    deviceResult: { kind: 'ok'; summary?: string } | { kind: 'io' | 'timeout'; message?: string }
  }[]
  expect?: { status: string; failureClasses: string[] }
}

export class FakeDeviceBackend implements DeviceBackend {
  executedActions: AgentAction[] = []
  executeCalls = 0
  #stepIndex = 0

  constructor(private readonly script: FakeRunScript) {}

  async connect(): Promise<DeviceInfo> {
    return { serial: 'fake', name: 'Fake Device' }
  }

  async disconnect(): Promise<void> {}

  async screenshot(): Promise<DeviceScreenshot> {
    return {
      dataUrl: '',
      screen: this.script.device.screen,
      ...(this.script.device.modelScreen ? { modelScreen: this.script.device.modelScreen } : {}),
    }
  }

  async getCurrentApp(): Promise<string> {
    return this.script.device.currentApp
  }

  async getDeviceState(): Promise<DeviceState> {
    return {
      app: this.script.device.currentApp,
      ...(this.script.device.packageName ? { packageName: this.script.device.packageName } : {}),
    }
  }

  async execute(action: AgentAction): Promise<string> {
    const step = this.script.steps[this.#stepIndex]
    this.#stepIndex += 1
    this.executeCalls += 1
    this.executedActions.push(action)

    const result = step?.deviceResult
    if (result?.kind === 'timeout') {
      throw new DeviceBackendError(result.message ?? 'device command timed out.', 'timeout')
    }
    if (result?.kind === 'io') {
      throw new DeviceBackendError(result.message ?? 'device command failed.', 'io')
    }
    return result?.summary ?? 'ok'
  }
}

export function createScriptedClient(script: FakeRunScript): OpenAiClient {
  let callIndex = 0
  return {
    async completeAction() {
      const step = script.steps[Math.min(callIndex, script.steps.length - 1)]
      callIndex += 1
      return step?.modelOutput ?? '{"action":"done","summary":"ok"}'
    },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/helpers/fakeDeviceBackend.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add test/helpers
git commit -m "test(agent): add a scripted device backend and model client"
```

---

### Task 13: Layer 2 重放用例

**Files:**
- Create: `test/fixtures/runs/device-timeout-then-review.json`、`test/fixtures/runs/abort-keeps-executed-steps.json`
- Create: `test/fixtureReplay/deviceLoop.test.ts`

**Interfaces:**
- Consumes: `createAgentRunner`（`src/lib/agent.ts:699`）、`FakeDeviceBackend` / `createScriptedClient`（Task 12）
- Produces: 设备时序的离线回归覆盖

- [ ] **Step 1: 写夹具**

Create `test/fixtures/runs/device-timeout-then-review.json`:

```json
{
  "schemaVersion": 1,
  "name": "device-timeout-then-review",
  "device": {
    "screen": { "width": 1080, "height": 2316 },
    "modelScreen": { "width": 720, "height": 1544 },
    "currentApp": "Chrome"
  },
  "steps": [
    { "modelOutput": "{\"action\":\"tap\",\"x\":1,\"y\":2}", "deviceResult": { "kind": "timeout", "message": "device command timed out after 30000ms." } },
    { "modelOutput": "{\"action\":\"tap\",\"x\":1,\"y\":2}", "deviceResult": { "kind": "timeout", "message": "device command timed out after 30000ms." } },
    { "modelOutput": "{\"action\":\"tap\",\"x\":1,\"y\":2}", "deviceResult": { "kind": "timeout", "message": "device command timed out after 30000ms." } }
  ],
  "expect": { "status": "awaiting_review", "failureClasses": ["device_timeout", "device_timeout", "device_timeout"] }
}
```

Create `test/fixtures/runs/abort-keeps-executed-steps.json`:

```json
{
  "schemaVersion": 1,
  "name": "abort-keeps-executed-steps",
  "device": {
    "screen": { "width": 1080, "height": 2316 },
    "modelScreen": { "width": 720, "height": 1544 },
    "currentApp": "Chrome"
  },
  "steps": [
    { "modelOutput": "{\"action\":\"tap\",\"x\":1,\"y\":2}", "deviceResult": { "kind": "ok", "summary": "tapped" } },
    { "modelOutput": "{\"action\":\"tap\",\"x\":3,\"y\":4}", "deviceResult": { "kind": "ok", "summary": "tapped" } }
  ],
  "expect": { "status": "stopped", "failureClasses": [] }
}
```

- [ ] **Step 2: 写用例**

Create `test/fixtureReplay/deviceLoop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createAgentRunner } from '../../src/lib/agent'
import type { ModelConfig } from '../../src/lib/openAiTypes'
import { FakeDeviceBackend, createScriptedClient, type FakeRunScript } from '../helpers/fakeDeviceBackend'
import { loadFixtures } from './loadFixtures'

const MODEL_CONFIG: ModelConfig = { baseUrl: 'http://localhost', apiKey: 'test', model: 'test-model' }
const fixtures = loadFixtures<FakeRunScript>('test/fixtures/runs')

describe('device loop replay', () => {
  it('has run fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const script of fixtures) {
    it(`${script.name} reaches ${script.expect?.status}`, async () => {
      const device = new FakeDeviceBackend(script)
      const runner = createAgentRunner({ device, client: createScriptedClient(script) })

      const result = await runner.run({
        modelConfig: MODEL_CONFIG,
        task: 'replay',
        autoExecute: true,
        maxSteps: 6,
      })

      expect(result.status).toBe(script.expect?.status)
      expect(result.steps.map((step) => step.failureClass ?? null).filter(Boolean)).toEqual(
        script.expect?.failureClasses ?? [],
      )
      expect(device.executedActions.length).toBe(result.steps.length)
    })
  }

  it('stops mid-run without losing the steps that already ran', async () => {
    const script = fixtures.find((candidate) => candidate.name === 'abort-keeps-executed-steps')
    expect(script).toBeDefined()
    const device = new FakeDeviceBackend(script as FakeRunScript)
    const controller = new AbortController()
    const runner = createAgentRunner({ device, client: createScriptedClient(script as FakeRunScript) })

    const result = await runner.run({
      modelConfig: MODEL_CONFIG,
      task: 'replay',
      autoExecute: true,
      maxSteps: 6,
      signal: controller.signal,
      onStep: () => {
        controller.abort()
      },
    })

    expect(result.status).toBe('stopped')
    expect(result.steps).toHaveLength(1)
    expect(device.executedActions).toHaveLength(1)
  })
})
```

- [ ] **Step 3: 跑测试确认通过**

Run: `npx vitest run test/fixtureReplay/deviceLoop.test.ts`
Expected: PASS —— 超时夹具应恰好执行 3 次后 `awaiting_review`；中止夹具应保留 1 步。

若超时夹具只执行 1 次就 `awaiting_review`，说明 Task 4 的白名单没生效，回到 Task 4 检查；若执行超过 3 次，检查 `MAX_AUTO_RECOVERABLE_EXECUTION_FAILURES` 的比较方向（应为 `>` 而非 `>=`）。

- [ ] **Step 4: 跑全量验证**

Run: `npm test && npm run lint && npm run build && npm run css:audit`
Expected: 全部通过；主 chunk 与 CSS 体积较基线（477.70 kB / 115.79 kB）增幅应在个位数 kB 内 —— 本计划只新增纯逻辑模块与测试替身。

- [ ] **Step 5: 提交**

```bash
git add test/fixtures/runs test/fixtureReplay/deviceLoop.test.ts
git commit -m "test(agent): replay device timeout and abort scenarios offline"
```

---

## 验收对照（spec §11）

| spec 验收项 | 由谁交付 |
| --- | --- |
| 1. 导出单文件 trajectory，不含凭据/像素/上下文全文 | Task 7（允许列表投影 + 5 条泄漏用例）、Task 8（入口） |
| 2. trajectory 经生成器产出夹具后能在无设备无网络下重放 | Task 9、Task 10、Task 13 |
| 3. Layer 1 覆盖解析（含别名/非法参数）与坐标（含 normalized/边界） | Task 10 |
| 4. Layer 2 覆盖超时重试到 `awaiting_review`；命令构造与记录 argv 一致 | Task 13（时序）、Task 10 的 `commands.test.ts`（命令构造，spec §7 所指 `deviceCommands` 的真正用途） |
| 5. 失败分类在 `AgentStepCard` / `RunLog` 可见 | Task 4（数据）+ 见下方说明 |
| 6. 现有 544 用例全绿、lint/build 干净 | 每个任务的收尾步骤 |
| 7. README 路线图与结构树同步 | Task 11 |

**关于验收项 5 的说明**：`AgentStepCard` 里把 `failureClass` 渲染成 `failed` tone 的副标题属于展示层改动，本计划未单列任务。若要在本 milestone 内完成，可在 Task 4 之后插入一个小组件任务（读 `turn.failureClass`，经 `appCopy` 取文案，加一条渲染用例）；若本 milestone 只关心 CI 价值，可把它记入路线图待办。**这一处需要执行者与用户确认后再决定是否纳入。**

---

## 计划级偏离与已知取舍

1. **fake backend 放在 `test/helpers/`**（spec 写在 `src/adapters/`）：避免测试替身进入生产 bundle。
2. **坐标夹具是「相机式」期望值**：`expected` 记录实现当前行为，因此必须配合 Task 10 的不变量断言（恒等 / 越界）与 `note` 里的公式抄录，否则会把 bug 焊死。
3. **不做 PNG 合成**：既有 `screenshotPreprocess.test.ts` 已用手工 mock canvas 覆盖绘制路径；本计划的坐标夹具只覆盖数值映射，不重复覆盖 canvas。
4. **`AgentStepCard` 展示未单列任务**：见验收对照的说明。
5. **`device_unavailable` 分类被移除**：代码中没有对应的错误信号（spec §5.1 已记录理由），凭空保留会让它永远落进 `unknown` 或被误判。

## 自查记录（writing-plans 要求）

写完计划后对照 spec 逐节复查，发现并已修正 4 处缺陷：

| # | 缺陷 | 修正 |
| --- | --- | --- |
| 1 | **Task 6 的测试访问 TypeScript `#` 私有方法，根本跑不通**，且把「用哪种注入形式」留给实现者 —— 正是被禁止的占位符 | 把「哪些步骤可上报」抽成可导出的纯函数 `toReportableDeviceCommand()`，测试改为覆盖纯函数 + registry 转发 + 循环收集三层，全部离线可跑 |
| 2 | **`loop_guard` 被标在「最后一步」上是语义错误**：`detectLoopGuard()` 拦在**执行之前**，那一步从未执行，而前一步是成功的；且控制器把 `loop_guard` 折叠成 thread status `stopped`，与用户中止无法区分 | 新增 run 级分类：`status_change` 事件携带 `failureClass`，`recordThreadStatus` 加同名选项；`loop_guard` → `'loop_guard'`、用户中止 → `'aborted'`；step 不再被污染。**spec §4.1/§5.4 已同步修订（决策 13）** |
| 3 | **spec §7 声称 `deviceCommands` 的用途是断言命令构造，但计划里没有任何测试做这件事** | Task 10 新增 `test/fixtures/commands/` 命令夹具族 + `commands.test.ts`：用纯函数构造器重放 argv，并断言 `;` / `&&` 不会成为独立 token（覆盖 `shellEscape` 安全路径），无需真机 |
| 4 | Task 4/5 的测试用了 `makeDevice` / `makeClient` / `DUMMY_MODEL_CONFIG` 等**不存在的 helper**，靠一句「指代文件内已有等价 helper」含糊带过 | 改为锚定真实基建：复用 `src/lib/agent.test.ts:15` 的 `fakeDevice()`，并给出 `sequentialClient()` / `deviceFailingWith()` 的完整实现 |

同时补齐了 spec 中遗漏投影的两个字段（`safetyDecision`、`device.orientation`），并把 `unrestrictedMode: true` 标注为 `unsupported_action` 用例的必要条件（否则 `call_api` 会走 `take_over` 分支）。
