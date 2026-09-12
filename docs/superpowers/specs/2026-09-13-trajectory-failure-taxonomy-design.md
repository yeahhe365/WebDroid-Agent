# WebDroid Agent 运行 trajectory 与失败分类设计

**日期**：2026-09-13
**状态**：待复核
**作者**：协作设计（用户 + AI）
**关联文档**：
- `docs/superpowers/2026-05-25-reference-alignment-audit.md`（建议 5「trajectory 导出与回放」、建议 9「observability 事件作为公共 schema」）
- `README.md` 路线图未完成项：真机验证矩阵、失败分类与重试/暂停恢复、安全风险分级

---

## 1. 背景与目标

### 1.1 现状核查（2026-09-13 实测）

- `npm test`：61 文件 / 544 用例全绿；`npm run lint`、`npm run build` 干净。
- 构建产物：主 chunk 477.70 kB / gzip 148.14 kB，CSS 115.79 kB / gzip 18.31 kB。
- 工作区干净；`src/` + `server/` 内 `TODO` / `FIXME` / `HACK` 数量为 0。
- `docs/` 下 12 份 spec/plan 齐全，状态已回填。

结论：项目**不欠技术债**，缺的是可靠性的**证据链** —— 功能齐全但无法证明它在真机上稳定。

### 1.2 要解决的问题

1. **真机链路零覆盖**：544 个用例没有一个触达真实设备路径；`docs/superpowers/plans/2026-07-26-webui-optimization.md` 唯一未打勾项即真机手动验证。失败一次就永久丢失那次现场。
2. **失败无分类**：`src/lib/agent.ts:900` 的 `isAutoRecoverableExecutionFailure()` 实现为 `!result.safetyDecision` —— 除安全拦截外，所有执行失败共用同一个 `MAX_AUTO_RECOVERABLE_EXECUTION_FAILURES = 2` 预算。包名写错的 `launch` 与 uiautomator dump 超时被同等对待，「值得重试」和「重试无用」混为一谈。
3. **无法导出单次 run**：目前只有「导出全部 threads」的原始 dump（`exportChatHistory`），且 `retainStepForRunResult()`（`agent.ts:904`）会清空 `promptContext` 与截图像素，直接序列化线程也拿不到完整现场。
4. **无 run 边界标识**：线程里没有 `runId`（见 §2），单次 run 无法可靠切分。
5. **设备命令构造无回归保护**：`inputCommands` / `stayAwakeCommands` / `screenBlackoutCommands` / `uiAutomator` 里的纯函数命令构造器是安全相关代码（`shellEscape`），却只在命令拼装层面有单测，没有「真实运行发出的 argv」作为对照。

### 1.3 本 milestone 目标

1. 把单次 run 投影成**带版本、可脱敏、可提交**的 `TrajectoryArtifact`。
2. 失败分类**在源头**完成，替换布尔式重试判断。
3. 由 trajectory 生成**确定性 fixture**：Layer 1 纯函数面先上 CI；Layer 2 用 fake `DeviceBackend` 离线重放设备时序。
4. 把「真机验证」从一次性人工操作，变成**可积累的自动化覆盖**。

**非目标**见 §12。

---

## 2. 现状事实（实现依据，均已核实）

| 事实 | 位置 |
| --- | --- |
| **turn = 一步**，不是一次 run：`startThreadTurn()` 在 `runAgentStep()` 内每步调用一次 | `src/lib/agent.ts:517`、`:588` |
| 一次 run = 多步 = 多个 turn；多步 run 由 `createAgentRunner().run()` 驱动，单步 run 由 `runAgentStep()` 驱动 | `src/lib/agent.ts:326`、`:699` |
| **当前没有 `runId`**，run 只能靠「连续且 `task` 相同的 turn」推断，不可靠 | 全仓库无 `runId` |
| `AgentTurn` 已持久化：`promptContext`、`modelOutput`、`action`、`executionAction`、`preview`、`timing`、`executionResult`、`success`、`toolName`、`deviceSnapshot` | `src/lib/agentThread.ts:75` |
| `AgentTurnStatus` = `planned` / `executed` / `failed` / `done` / `awaiting_review` / `awaiting_takeover` | `src/lib/agentThread.ts:23` |
| `AgentRunStatus` = `awaiting_review` / `awaiting_takeover` / `done` / `loop_guard` / `max_steps` / `stopped` | `src/lib/agent.ts:113` |
| typed errors 已存在：`ActionValidationError`、`OpenAiClientError`、`DeviceBackendError`，以及私有的 `InvalidModelActionError` | `actionTypes.ts:211`、`openAiErrors.ts:1`、`deviceTypes.ts:79`、`agent.ts:165` |
| 设备读写已有超时与重试基建：`withTimeout` / `retryDeviceOperation`（默认 4 次尝试、250/750/1500ms） | `src/adapters/deviceRetry.ts` |
| `ActionToolResult` 只有人类可读的 `summary`，没有机器可读的失败种类 | `src/lib/toolRegistry.ts:30` |
| `DeviceBackend` 只有 6 个必需方法（其余可选），fake 实现成本低 | `src/adapters/deviceTypes.ts:62` |
| `threadStore` 只有 `threads` / `threadSummaries` 两个 object store，**没有独立媒体库**；截图经 `compactScreenshotForMemory` 压缩，引用上限 `MAX_THREAD_SCREENSHOT_REFERENCES = 32` | `src/lib/threadStore.ts`、`agentThread.ts:12` |
| 测试环境无 2D canvas：现有测试用 FakeImage + 手工 mock context 的方式验证绘制路径，**不引原生依赖** | `src/adapters/screenshotPreprocess.test.ts` |
| 执行失败以 `ActionToolResult{success:false}` 返回（非异常）；`take_over` → `awaiting_takeover`，有 `safetyDecision` → `awaiting_review`，其余全部计入可自动恢复预算 | `src/lib/agent.ts:877` |

---

## 3. 方案选型

### 方案 1（选定）：投影式 schema + 源头分类 + 夹具生成器

- trajectory 是从 `AgentThread.turns` **投影**出的独立产物，显式带 `schemaVersion`，不改 IndexedDB 内部 schema。
- 失败分类在源头标注：已有 typed errors + `withTimeout` 超时 + 安全决策各映射到一类，判不了的进 `unknown`（会被统计，而非猜测）。
- fixture 由 trajectory 投影而来，确定性、脱敏、可提交。
- 成本中等（3 个新模块 + 若干标注点），**fixture 不因内部重构而漂移**。

### 方案 2（否决）：直接序列化 `AgentThread` 当 trajectory + 事后字符串分类

成本最低，但 fixture 与内部存储强耦合（thread 结构一改，已提交 fixture 全废）；分类靠正则，`unknown` 占比高，**虚假分类会误导后续重试策略**；达不到「评测集」要求的确定性。

### 方案 3（否决）：先做审计 #9 的 `WebDroidEvent` 公共事件流

架构最干净，但等于重构运行时数据流（agent 循环 + 线程持久化 + UI 订阅），大面积触碰现有 544 个测试。对「下一步」而言范围过大，YAGNI。

**选定方案 1**：唯一同时满足「能直接喂 CI」（确定性 + 不漂移）与「分层推进」（Layer 1/2 可分开交付）的形状，且不动运行时数据流。

---

## 4. 数据模型

### 4.1 新增持久化字段（全部可选，向后兼容）

```ts
// src/lib/failureTaxonomy.ts（新）
export type FailureClass =
  | 'model_transport'    // OpenAiClientError：网络/HTTP/限流
  | 'model_output'       // 空回复、非 JSON、解析不出动作（InvalidModelActionError）
  | 'action_invalid'     // ActionValidationError：包名/URI/控制字符非法
  | 'unsupported_action' // 动作本身不支持（如 call_api）
  | 'device_io'          // DeviceBackendError（kind='io'）：ADB 命令失败
  | 'device_timeout'     // DeviceBackendError（kind='timeout'）：withTimeout 触发
  | 'loop_guard'         // detectLoopGuard 命中
  | 'aborted'            // 用户停止
  | 'unknown'            // 未识别（需被统计，不允许静默吞掉）
```

```ts
// AgentStep（src/lib/agent.ts:73）与 AgentTurn（src/lib/agentThread.ts:75）各新增：
runId?: string             // 一次 run 的稳定标识，见 4.2
failureClass?: FailureClass
safetyDecision?: ActionSafetyDecision
deviceCommands?: string[][] // 该步实际发出的 argv（不含 { waitMs } 定时项）
```

### 4.2 `runId` 的引入（更正：原设计误判 turn 为 run 边界）

`startThreadTurn()` 每步调用一次，因此 **turn 是步、不是 run**。为可靠切分单次 run，新增：

- `RunAgentStepInput.runId?: string`（`agent.ts:96`）。
- 多步：`createAgentRunner().run()` 入口生成一个 `runId`，全程透传。
- 单步：`useAgentRunController` 的 `execute-action` 任务生成一个 `runId`。
- `runAgentStep()` 将其写入 `AgentStep.runId`，`startThreadTurn()` 写入 `AgentTurn.runId`。

这样「导出这次 run」有了确定语义，也顺带修掉了今天无法切分 run 的真实缺陷。

### 4.3 `TrajectoryArtifact` v1

```ts
export type TrajectoryArtifact = {
  schemaVersion: 1
  kind: 'webdroid.trajectory'
  exportedAt: string                 // ISO 8601
  app: { version: string }           // 来自 __APP_VERSION__
  run: {
    runId: string
    threadId: string
    task: string
    status: AgentRunStatus
    startedAt: number
    endedAt?: number
    partial: boolean                 // 被 stop 中断时为 true
    stepTurnIds: string[]
  }
  model: {
    provider: string
    model: string
    actionProtocol: ActionProtocol
    coordinateMode: ActionCoordinateMode
  }                                  // 不含 baseUrl / apiKey
  device: {
    name: string                     // 不含 serial
    screen: ScreenSize
    modelScreen?: ScreenSize
    orientation?: string
  }
  steps: TrajectoryStep[]
  outcome: {
    failureClass?: FailureClass
    reason?: string
    finalResponse?: string
  }
}

export type TrajectoryStep = {
  index: number
  turnId: string
  timing: AgentTurnTiming
  currentApp: string
  deviceState: DeviceState
  uiTree?: ScreenTreeSummary
  context: { chars: number; sha256: string } | { text: string }
  modelOutput: string
  action: AgentAction
  executionAction: AgentAction
  toolName?: string
  executionResult: string
  success?: boolean
  failure?: { class: FailureClass; message: string }
  safetyDecision?: ActionSafetyDecision
  deviceCommands?: string[][]
  screenshot?: { id: string; sha256: string; screen: ScreenSize; modelScreen?: ScreenSize }
}
```

### 4.4 三条硬规则

1. **只记事实，不记期望** —— 期望值属于 fixture 层（§6.1）。trajectory 里不出现任何「应该是什么」，杜绝「金文件自我实现」。
2. **只记引用，不记像素** —— 截图只存 `ScreenshotRef`（id + sha256 + 尺寸）。像素仅在本地调试导出时可选内联。
3. **脱敏是一等公民** —— 不记 `device.serial`、不记 `model.baseUrl` / `apiKey`、secret 只记 descriptor id；`promptContext` 默认只存 `{ chars, sha256 }` 摘要，全文仅在 `includeContext: true` 时写入（默认关闭，供本地调试）。

### 4.5 向后兼容

- 新字段全部可选：已持久化的旧 thread 与旧 dump 仍可解析。
- `isAgentThread()`（`agentThread.ts:772`）与 `parseChatHistoryImport()`（`:791`）需接受新字段；解析不出 `runId` 的旧 thread，其 trajectory 标记 `run.runId = ''` 并置 `partial: true`。

---

## 5. 失败分类

### 5.1 分类必须在源头做

`ActionToolResult` 增加机器可读字段：

```ts
export type ActionToolResult = {
  toolName: string
  success: boolean
  summary: string
  failureKind?: FailureClass          // 新增
  safetyDecision?: Exclude<ActionSafetyDecision, 'allow'>
}
```

`toolRegistry` 是唯一知道「是设备命令抛错，还是动作根本不支持」的地方（`toolRegistry.ts:312` 的 `call_api` 即属后者）。三类来源各归各的：

| 来源 | 判据 | 分类 |
| --- | --- | --- |
| 抛出的异常 | `OpenAiClientError` | `model_transport` |
| | `InvalidModelActionError` / `parseModelAction` 失败 | `model_output` |
| | `ActionValidationError` | `action_invalid` |
| | `DeviceBackendError` 且 `kind === 'timeout'` | `device_timeout` |
| | `DeviceBackendError` 且 `kind === 'io'` | `device_io` |
| | `AbortError` | `aborted` |
| 返回值 | `success === false` + `failureKind === 'unsupported_action'` | `unsupported_action` |
| | `success === false` + 其他 `failureKind` | 对应枚举 |
| 循环 | `detectLoopGuard()` 命中 | `loop_guard` |
| 兜底 | 以上都不匹配 | `unknown` |

**为什么必须给错误加类型标记**：`withTimeout()`（`src/adapters/deviceRetry.ts:21`）目前抛出的是普通 `DeviceBackendError`，只有一句 `"<label> timed out after <n>ms."` 消息 —— 在 catch 点 `device_timeout` 与 `device_io` **无法区分**，除非退化成字符串匹配（本设计明确拒绝）。因此：

```ts
// src/adapters/deviceTypes.ts
export type DeviceBackendErrorKind = 'io' | 'timeout'
export class DeviceBackendError extends Error {
  readonly kind: DeviceBackendErrorKind
  constructor(message: string, kind: DeviceBackendErrorKind = 'io') { /* message 不变 */ }
}
```

`withTimeout()` 改以 `kind: 'timeout'` 构造；`kind` 默认 `'io'`，现有构造点全部不变，错误消息也不变，因此现有 `deviceRetry` 相关测试不受影响。

**为什么不设 `device_unavailable`**：核查后确认代码中**没有**连接丢失 / 未授权的独立错误信号 —— `LazyWebAdbDeviceBackend` 只做透传（`src/adapters/lazyWebAdbBackend.ts:33-77`），连接期失败以底层异常形式冒泡。凭空加一个无法可靠触发的分类会让它永远落进 `unknown` 或误判，故 v1 不设；连接期失败暂归 `device_io`，待出现真实信号后再拆类。

安全决策不是失败，单列 `safetyDecision` 记录（`allow` / `confirm` / `block` / `take_over`），供 Layer 1 覆盖策略回归。

### 5.2 唯一的运行时行为改动

`isAutoRecoverableExecutionFailure()`（`agent.ts:900`）由 `!result.safetyDecision` 改为按类白名单：

```ts
const AUTO_RECOVERABLE_FAILURES: ReadonlySet<FailureClass> =
  new Set(['device_io', 'device_timeout'])
```

**精确表述**（不做过度承诺）：改动后 `device_timeout` 成为显式可重试类；而**非设备类**的执行失败（`unsupported_action`、`unknown` 等）不再被静默重试 2 次，而是直接进入 `awaiting_review` 并带上原因。`device_io` 仍可重试（与今天一致，因为包名错误也表现为 `DeviceBackendError`）。这是本 milestone 唯一改变运行时行为的地方，必须单独测试并保持可回退。

### 5.3 UI 落点

- **不加新档位**：`StepTone`（`AgentStepCard.tsx:23`）保持 `planned` / `running` / `success` / `failed` / `review` / `takeover`，失败类作为 `failed` 的副标题展示。
- `RunLog` 的 detail 追加分类标签；`LogEntry.tone` 四档不变。

---

## 6. 夹具生成与 CI 接线（Layer 1）

### 6.1 事实与期望分离

`TrajectoryArtifact` = 事实；`Fixture` = 事实 + 期望。生成器**只产出期望值草案，绝不自动覆写**已人工确认的期望 —— 唯一的人工步骤就是确认期望。

### 6.2 两类 Layer 1 夹具

1. **`test/fixtures/actions/*.json`（解析 / 校验面）**
   - 输入：`modelOutput` 原文 + `screen` + `actionProtocol` + `coordinateMode`
   - 重放：`parseModelAction()` → `validateAction()`，断言 canonical `AgentAction`
   - 覆盖：canonical JSON、normalized JSON、Open-AutoGLM 风格别名、markdown 包裹、空回复、多对象、非法参数
2. **`test/fixtures/coordinates/*.json`（坐标面）**
   - 输入：合成几何（原生 `screen`、`modelScreen`、grid divisions、点击点、`coordinateMode`）
   - 重放：`src/lib/screenshot/coordinates.ts` + `src/lib/actionCoordinates.ts`
   - 覆盖：缩放往返、normalized 0-1000、边界钳制、网格吸附

**「合成截图」的准确含义**：合成**几何（数字）** + 复用现有 FakeImage / mock context 模式验证绘制路径。jsdom 不提供 2D context，真去合成 PNG 需要 `canvas` / `@napi-rs/canvas` / `sharp` 等原生依赖，**违反本项目「不引新依赖」约束**，因此不做。

### 6.3 生成器脚本

`scripts/trajectory-to-fixture.mjs`：读 trajectory JSON → 写 `test/fixtures/**` → 打印期望值草案。放在 Node 侧而非浏览器按钮，因为它必须可重复、可进 CI、零运行时依赖。脱敏在生成器内完成。

### 6.4 CI 守卫

- **像素守卫**：在 `test/repo-hardening.test.ts` 增加断言 —— `test/fixtures/**` 中出现 `data:image/` 或超长 base64 即 fail。把「不提交真实像素」从口头约定变成 CI 强制。
- **版本守卫**：fixture 内记录 `schemaVersion`，加载器对不上即 fail 并提示重新生成。
- `npm test` 已是 CI 步骤，fixture 重放即普通 vitest 用例，**`ci.yml` 无需改动**。

### 6.5 人工回路

1. 真机跑一次 → 导出 trajectory（复用 `downloadJsonFile`，`src/lib/fileExport.ts:8`）
2. `npm run trajectory:fixture <file>` → 生成脱敏 fixture + 打印期望草案
3. **人工确认期望值**并提交（唯一人工步骤）
4. CI 重放

---

## 7. Layer 2：fake `DeviceBackend` 离线重放

- 实现 `DeviceBackend` 的 6 个必需方法，数据来自 trajectory：
  - `getCurrentApp()` / `getDeviceState()` → 该步记录的 `currentApp` / `deviceState`
  - `screenshot()` → 该步记录的尺寸几何
  - `execute(action)` → 成功返回记录的 `executionResult`；失败按记录的 `failure.class` 抛 `DeviceBackendError` 或超时
- 配离线 fake `OpenAiClient`，离线重放 `runAgentStep()` / `createAgentRunner().run()`，无网络。
- **`deviceCommands` 的真正用途**：不是驱动 fake，而是**断言命令构造没有回归** —— 用现成的纯函数构造器（`buildSetClipboardCommand`、`buildDumpScreenTreeCommand`、`buildStayAwakeCommand` 等）从动作重建 argv，与该步记录的 argv 逐项比对，覆盖 `shellEscape` 相关安全路径。
- 采集方式：新增可选回调 `RunAgentStepInput.onDeviceCommand?: (argv: readonly string[]) => void`，由 `runAgentStep()` 收集进 `step.deviceCommands`；`{ waitMs }` 定时项不记录。
- 目标用例：ADB 超时 → `device_timeout` → 自动重试 → 第三次 `awaiting_review`；dump 失败降级；abort 中途停止仍保留已执行 steps（回归 `f338471`）。

---

## 8. 文件结构变化

**新增**

```
src/lib/failureTaxonomy.ts          FailureClass、分类函数、AUTO_RECOVERABLE_FAILURES
src/lib/trajectory.ts               TrajectoryArtifact 类型 + 从 AgentThread 投影 + 脱敏
src/lib/trajectoryFixture.ts        trajectory → fixture 投影（含期望草案）
scripts/trajectory-to-fixture.mjs   Node 侧生成器
test/fixtures/actions/*.json
test/fixtures/coordinates/*.json
test/fixtures/trajectories/*.json   仅元数据的真实 run 记录
```

**修改**

```
src/lib/agent.ts               runId 透传、onDeviceCommand 收集、失败分类标注、重试白名单
src/lib/agentThread.ts         新字段 + startThreadTurn / recordThreadTurnExecution 接收
                               runId / failureClass / safetyDecision / deviceCommands
                               + isAgentThread / parseChatHistoryImport 兼容
src/lib/toolRegistry.ts        ActionToolResult.failureKind
src/adapters/deviceTypes.ts    DeviceBackendError 增加 kind（'io' | 'timeout'）
src/adapters/deviceRetry.ts    withTimeout 以 kind: 'timeout' 构造错误
src/components/AgentStepCard.tsx  failed tone 副标题显示分类
src/lib/runLogEntries.ts       日志 detail 追加分类标签
src/lib/appCopy.ts (+ zh-CN/en-US) 新增文案
package.json                   新增脚本 trajectory:fixture
test/repo-hardening.test.ts     像素守卫 + fixture schemaVersion 守卫
README.md / README.en-US.md    路线图与结构树同步
```

---

## 9. 测试策略

**新增**

- `src/lib/failureTaxonomy.test.ts` —— 每类来源各一例；`unknown` 兜底；白名单成员。
- `DeviceBackendError.kind` 兼容用例 —— 默认 `'io'`、`withTimeout` 产出 `'timeout'`、错误消息不变（保证现有 `deviceRetry` 断言不回归）。
- `src/lib/trajectory.test.ts` —— 投影完整性、摘要 vs 全文、脱敏（serial / baseUrl / apiKey / secret 值不出现）、`schemaVersion`、旧 thread（无 `runId`）兼容。
- `src/lib/trajectoryFixture.test.ts` —— fixture 生成确定性（同输入两次生成字节一致）、不覆写已确认期望。
- `test/fixtureReplay/actions.test.ts`、`coordinates.test.ts` —— 逐 fixture 重放。
- `test/fixtureReplay/deviceLoop.test.ts` —— Layer 2，fake backend + 离线 client。
- `src/adapters/fakeDeviceBackend.test.ts` —— fake 本身的行为。
- 重试白名单的行为用例 —— `device_timeout` 重试至第三次 `awaiting_review`；`unsupported_action` 一次即 `awaiting_review`。

**保持**

- 现有 61 文件 / 544 用例全绿（新字段均为可选，不应破坏任何断言）。
- `npm run lint`、`npm run build`、`npm run css:audit` 干净。

**手动**

- 真机跑一次完整流程并导出 trajectory，走通 §6.5 的四步回路（需要物理设备）。

---

## 10. 风险与权衡

| 风险 | 应对 |
| --- | --- |
| 重试白名单收窄改变运行时行为，可能让原本「自动重试就好了」的场景改为中断 | 唯一行为改动，单独测试 + 保留回退开关；`device_io` 保持可重试以覆盖包名类错误 |
| `unknown` 分类占比过高，使分类失去意义 | `unknown` 必须被统计；Layer 1 用例中显式断言主要路径不落入 `unknown` |
| trajectory 体积（`promptContext` 摘要已规避，但 `modelOutput` + `executionResult` 仍可能较大） | 沿用现有截断常量（`RUN_RESULT_MODEL_OUTPUT_MAX_LENGTH`、`MAX_RUN_LOG_DETAIL_CHARS`）；fixture 只保留重放所需字段 |
| fixture 与投影逻辑同时漂移，导致测试自证 | 期望值人工确认一次后锁定；生成器不自动覆写；CI 守卫 `schemaVersion` |
| Layer 2 需要 jsdom 下的 canvas mock，易碎 | 复用 `screenshotPreprocess.test.ts` 已验证的 FakeImage + mock context 模式；fake backend 优先返回几何而非像素 |
| 旧 chat history dump 导入回归 | 新字段全可选 + `isAgentThread` 兼容用例 + `parseChatHistoryImport` 旧格式用例 |

---

## 11. 验收标准

1. 能对一次真实 run 导出单文件 trajectory，文件内**不含** serial / baseUrl / apiKey / secret 值 / 截图像素 / promptContext 全文。
2. 该 trajectory 经 `npm run trajectory:fixture` 生成 fixture 后，能在**无设备、无网络**的 CI 中重放通过。
3. Layer 1 至少覆盖：模型输出解析（含 Open-AutoGLM 别名与非法参数）、坐标映射（含 normalized 0-1000 与边界钳制）。
4. Layer 2 至少覆盖：`device_timeout` 触发自动重试并最终 `awaiting_review`；命令构造与记录 argv 一致。
5. 失败分类在 `AgentStepCard` 与 `RunLog` 可见，且 `unknown` 在主路径用例中不出现。
6. 现有 544 用例全绿，lint / build 干净。
7. README 路线图与结构树同步更新。

---

## 12. 不在本次范围

- `WebDroidEvent` 公共事件流（方案 3 / 审计建议 9）。
- 界面内回放 UI（「在页面上重放一次运行」）。
- PNG 合成（需要原生依赖）。
- eval 打分与聚合报告（先有夹具，再谈评测集）。
- `call_api` 真实语义（属兼容性方向，与本 milestone 正交）。
- 暂停 / 恢复（需先有失败分类作为依据，留待下一 milestone）。
- 安全风险分级（README 路线图第 3 项）。

---

## 13. 决策记录

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | trajectory 首要用途 | 回归夹具 / 评测集，能直接喂 CI |
| 2 | 重放边界 | 分层推进：先纯函数面（Layer 1），再加 stub 设备链路（Layer 2） |
| 3 | 截图像素处理 | 合成几何 + 真实 run 只存元数据；不提交真实像素 |
| 4 | 方案选型 | 方案 1（投影式 schema + 源头分类 + 夹具生成器） |
| 5 | `promptContext` | 默认只存 `{ chars, sha256 }` 摘要，`includeContext` 显式开全文 |
| 6 | 重试白名单 | 本次一并收窄为 `device_io` / `device_timeout` |
| 7 | 像素守卫 | `test/fixtures/**` 出现 `data:image/` 即 CI fail |
| 8 | `runId` 引入 | 更正 §4.2：turn 是步不是 run，必须新增 `runId` 才能切分单次 run（**需复核**） |
