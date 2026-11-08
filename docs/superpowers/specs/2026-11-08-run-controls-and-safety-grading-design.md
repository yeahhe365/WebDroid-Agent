# WebDroid Agent 运行控制与安全分级设计

**日期**：2026-11-08
**状态**：已实现，真机验收待回填
**作者**：协作设计（用户 + AI）
**关联文档**：
- `docs/device-verification-matrix.md`（本里程碑产出的真机验收矩阵；本文 §4 的离线等价覆盖对应其 P4/P6/K4 等行）
- `docs/superpowers/specs/2026-09-13-trajectory-failure-taxonomy-design.md`（失败分类，本设计在其之上分层）
- `README.md` 路线图：暂停与恢复、真实设备验证矩阵、安全策略与风险分级

---

## 1. 背景与目标

### 1.1 现状核查（2026-11-08 实测）

- `npm test`：84 文件 / 763 用例全绿；`npm run lint`、`npm run build`、`npm run build:server` 干净。
- 构建产物：入口 chunk 322.50 kB（gzip 100.41 kB）、`react` 189.60 kB、懒加载的 `MarkdownContent` 158.91 kB、`adb` 55.93 kB；js+css 合计 906.79 kB。
- 工作区干净，本里程碑的改动已按功能拆成 16 个提交落盘。

### 1.2 要解决的问题（均已核实）

1. **接管类型靠猜**：`needsYou.ts` 用关键词扫描最后一条消息判断是登录、验证码还是支付。安全策略自己的提示语里就带 "captcha" 这个词，于是密码流程会被渲染成验证码卡片。
2. **只能杀进程，不能停**：`stopCurrentRun()` 会 `abort` 掉整轮，没有「做完这一步再停」的语义，也没有任何恢复路径。
3. **Token 数是零**：用量只在最终回复里读一次，流式跑完一轮之前计数器一直是 0。
4. **安全策略是一条 if 链**：每个类别一个硬判定（`actionSafetyPolicy.ts:138` 起）。支付被 `block` 成通用 review 卡；`block` 与普通 `review` 区分不出来，卡片却给了「继续」按钮，点下去只是再被拦一次；步数上限借用 review 卡。
5. **包体贴在警告线上**：入口 chunk 499.60 kB，距 Vite 的 500 kB 警告只剩 0.40 kB。

### 1.3 本 milestone 目标

1. 接管/复核类型由**模型和运行器显式给出**，UI 不再推理。
2. 增加**协作式暂停**：在步骤边界停下，恢复时复用同一 thread，不新增用户消息。
3. 流式场景下**边跑边记 token**，并对拒绝 `stream_options` 的网关降级。
4. 把安全策略改成**风险等级 + 判定阶梯 + 可配置强度**，并让「被拦下」「到步数上限」各有自己的卡片。
5. 给包体设**硬预算**，让越线变成构建失败而不是警告。

非目标见 §6。

---

## 2. 现状事实（实现依据）

| 事实 | 位置 |
| --- | --- |
| `AgentThreadStatus` 已包含 `paused`；`ReviewKind = 'answer' \| 'blocked' \| 'confirm' \| 'max_steps' \| 'other'` | `src/lib/agentThread.ts:32` |
| `AgentRunStatus` / `AgentRunResult` 均含 `paused` 与 `reviewKind` | `src/lib/agent.ts:133`、`:146` |
| 运行循环在 5 处检查 `shouldPause`：步骤边界、模型错误重试后、`done` 前、执行后、以及继续排队消息前 | `src/lib/agent.ts:784`、`:840`、`:866`、`:1013`、`:1020` |
| `toolRegistry` 在 `unrestrictedMode` 下跳过策略，只保留不可逆守卫 | `src/lib/toolRegistry.ts:364`、`:370` |
| thread 状态由 `recordThreadStatus` 写入并被 `persistSession` 持久化，刷新后可读回 | `src/lib/agentThread.ts:566`、`useAgentRunController.ts:162` |
| `recoverInterruptedThread` 只把 `running` 判为「被打断」，不碰 `paused` | `src/lib/agentThread.ts:598` |
| `createMemoryThreadStore` 存取都做深拷贝，等价于一次真实 reload | `src/lib/threadStore.ts:74` |
| 聊天补全的流式请求带 `stream_options.include_usage` | `src/lib/openAiPayload.ts` |
| `needsYouKind` 已是纯函数，接受 `takeoverKind` / `reviewKind` | `src/lib/needsYou.ts:25` |

---

## 3. 设计

### 3.1 结构化 kind

`take_over` 动作接受 `kind`（`login` / `captcha` / `payment` / `other`），别名（`verification-code`、`otp`、`2fa`）在 `actionValidation.ts` 归一到结构化值；本地安全策略同样返回 `takeoverKind`，所以「策略判定」和「模型请求」两条来源共用同一套卡片。

复核侧新增 `blocked`：策略判 `block` 时 `agent.ts:992` 以 `reviewKind: 'blocked'` 结束本轮，投影成「被安全策略拦下」卡片，主按钮是**打开运行日志**而不是「继续」。

### 3.2 协作式暂停

语义：**当前正在执行的那一步会做完，然后在下个边界停下。**

为什么不在动作中途 abort：ADB 命令已经发给设备，`abort` 只中断 JS 侧的等待，设备的副作用已经发生，却不进 thread —— 下次运行会重复执行同一步。所以暂停只在 `shouldPause()` 的 5 个检查点生效（见 §2）。

- `pauseCurrentRun()`（`useAgentRunController.ts:489`）只置一个 ref 和一个 `runPausing` 状态；没有自动运行在跑时是 no-op。
- `runPausing` 在 `runAutoLoop` 的 `finally` 里清空，UI 上表现为「正在暂停…」+ 禁用按钮，避免长步骤看起来像死按钮。
- `resumeRun()`（`:499`）要求 `busyTask` 为空且 `session.status === 'paused'`，然后直接再跑一次 `runAutoLoop`：同一个 session、同一个 thread，**不注入用户消息**。

刷新后的恢复链路：`recordThreadStatus(…,'paused')` → `persistSession` → reload → `threadStore.loadLatest()` → `recoverInterruptedThread()`（对 `paused` 返回 `false`，不改状态）→ 卡片显示「继续运行」→ `resumeRun`。

### 3.3 流式 Token 与降级

- OpenAI Chat：`stream_options: { include_usage: true }`，从流的 usage 块取值。
- OpenAI Responses：读 `response.completed` 的 usage。
- Gemini：读 `usageMetadata`。
- 最终回复的 usage 由 `recordAgentFinalResponse` 合并进最后一轮。

降级：兼容网关不认识 `stream_options` 会整条请求报错。`openAiClient.ts:128` 识别错误文本里是否提到该字段，命中则去掉字段**重试一次**（`withoutStreamOptions`，`:46`），运行继续，并通过 `onNotice` 在运行日志里留一条 warn。与 `stream_options` 无关的失败（例如 401）不重试。

### 3.4 风险分级

新增 `src/lib/actionRisk.ts`，三件事：

- **风险等级**：`none` / `low` / `medium` / `high` / `critical`。
- **判定阶梯**：`allow < confirm < take_over < block`。
- **类别档案**（`SAFETY_CATEGORY_PROFILES`，`:58`）：每个类别声明默认判定 `decision`、下限 `floor`、上限 `ceiling`。

| 类别 | 风险 | 标准 | 宽松 | 严格 |
| --- | --- | --- | --- | --- |
| `secret_or_login` | high | take_over | confirm | take_over |
| `critical_destructive` | critical | block | block | block |
| `payment` | critical | take_over | take_over | take_over |
| `destructive` | high | confirm | confirm | take_over |
| `authorization` | medium | confirm | allow | take_over |
| `payment_context` | medium | confirm | allow | take_over |

`resolveSafetyDecision()`（`:101`）是唯一把类别映射成判定的地方：宽松降一档、严格升一档，两边都被 `floor` / `ceiling` 夹住。因此：

- 宽松**不能**让支付或删除账号直接执行（两者的 `floor` 就是自身判定）；
- 严格**不会**把登录/支付升级成 `block` —— 那会让用户既不能做也不能继续，卡死；
- 不可逆守卫（`evaluateIrreversibleSafety`）在强度设置之外，永远 `block`；
- 设置导入只允许**收紧**（`settings.ts` 的 `stricterStrictness`），不能放宽。

策略函数本身不读设置，强度从 `ActionSafetyContext.strictness` 进（`agent.ts:927`、`useAgentRunController.ts:171`），调用方不用改签名。

### 3.5 卡片投影

`needsYouKind(status, failureClass, message, takeoverKind, reviewKind)` 现在是纯映射，不再猜：

| 状态 | kind | 卡片 | 主操作 |
| --- | --- | --- | --- |
| `awaiting_takeover` + `login`/`captcha`/`payment` | 同名 | 登录 / 验证 / 付款 | 处理好了，继续 |
| `awaiting_takeover` + `other` | takeover | 需要你接手 | 处理好了，继续 |
| `awaiting_review` + `answer` | answer | 需要你回答 | 聚焦输入框 |
| `awaiting_review` + `max_steps` | max_steps | 已达到步数上限 | 继续 |
| `awaiting_review` + `blocked` | blocked | 被安全策略拦下 | 打开运行日志（无「继续」） |
| `paused` | paused | 已暂停 | 继续运行 |

### 3.6 分包与预算

`vite.config.ts:22` 的 `vendorChunks` 只列两组：`react` 与 `@yume-chan/adb`。入口从 499.60 kB 降到 321 kB。

**Markdown 栈故意不列**：一旦手动分块，Vite 会把它写进 `index.html` 的 modulepreload，懒加载的 `MarkdownContent` 就白拆了 —— 第一次尝试正是这样丢掉懒加载的。

`scripts/bundle-budget.mjs` 接入 `npm run build`：入口 400 KiB、单 chunk 500 KiB、总量 1100 KiB，超了非零退出；另外检查「体积 >100 KiB 的懒加载 chunk 不能被 `index.html` 预加载」。

---

## 4. 验证

- 单测新增覆盖：风险阶梯与强度矩阵、策略在三种强度下的判定、`blocked` / `max_steps` 卡片、支付接管卡片、导入不可放宽、`stream_options` 降级与「无关错误不重试」、暂停的 `runPausing` 状态机（含重复点击与 run 外的空点）。
- **刷新后恢复**的离线等价（`useAgentRunController.test.tsx`）：跑一步 → 暂停 → `store.save` → `store.load` 得到全新对象图 → 断言 `recoverInterruptedThread` 对 `paused` 返回 `false` → 用新 hook 实例 `resumeRun` → 断言 `done`、turn 数**恰好 +1**、用户消息仍为 1 条。
- 该用例做过变异验证：把 `resumeRun` 的守卫从 `!== 'paused'` 改成 `!== 'running'`，两个用例立刻变红；还原后重新全绿。
- 真机部分见 `docs/device-verification-matrix.md`（暂停落点、恢复不新增消息、刷新后继续、各家流式 usage、强度行为）。

---

## 5. 决策与权衡

| 决策 | 备选 | 原因 |
| --- | --- | --- |
| 暂停只在步骤边界 | 中途 `abort` ADB 动作 | 设备副作用已发生，中途打断会让 thread 与设备状态不一致，下次重放会重复执行 |
| `payment` 判为 `take_over` 而非 `block` | 保持 `block` | 两者都阻止 Agent 执行；`take_over` 才能给出「你自己付完再继续」的可操作卡片。不可逆守卫里也同样改为 `take_over`，保持一致 |
| 强度只影响 `medium` / `high`，`critical` 锁死 | 让强度统管全部类别 | 用户调节的是「要多少确认」，不是「要不要遵守底线」 |
| 登录/支付严格模式封顶 `take_over` | 升到 `block` | `block` 之后没有继续路径，用户被卡死在自己刚设的更严设置里 |
| Markdown 手动分块被放弃 | 按依赖分组 | 实测会触发预加载，等于取消懒加载 |
| 预算按 KiB 且比 Vite 更严 | 抬高 `chunkSizeWarningLimit` | 调高阈值只是让警告闭嘴，问题还在 |

---

## 6. 已知限制与非目标

- 暂停**不能**中断已经在设备上执行的单步动作；这正是设计选择，不是缺陷。
- `unrestrictedMode` 下策略被整体绕过（仅保留不可逆守卫），**强度设置不生效**；两者是不同层级的开关。
- `blocked` 卡片不提供「继续」：被策略拦下的动作重放只会再被拦一次。
- 降级重试后 token 计数为空（`stream_options` 已被去掉），日志会说明。
- 未做：按类别逐项覆盖的 UI（当前只有三档强度）；真机自动化的 CI 接入。

## 7. 后续

1. 按 `docs/device-verification-matrix.md` 回填真机结果。
2. 如果确实需要更细的粒度，可在 `SAFETY_CATEGORY_PROFILES` 之上加用户覆盖，但 `floor` 不对外开放。
