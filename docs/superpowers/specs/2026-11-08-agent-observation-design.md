# 屏幕观测与自检:从 Mika 借鉴的九项改动

**日期:** 2026-11-08

**参考实现:** `其它/Mika`(Kotlin 原生 Android agent,Apache-2.0)。本仓库只借鉴**判定规则与结构**,不引入任何依赖,不复制其虚拟屏/无障碍/沙箱等原生能力。

## 目标

agent 的每一步都建立在「屏幕上到底有什么」之上。这次改动把观测从「截图 + 一份树,由模型自己判断」推进到:

1. 动作是否有用,由代码判出来并告诉模型(`actionEffect`);
2. 屏幕上的文字永远只是数据(`untrusted`);
3. 屏幕不可用时给出确定的原因(`screenDiagnosis`);
4. 等界面稳定,而不是固定睡一秒(`screenSettle`);
5. 记忆与技能**检索而不是全量注入**,且敏感内容不落盘(`memoryIndex` / `sensitiveFilter` / `skillStore`);
6. 最终回答里的引文和数字必须真的读到过(`evidenceLedger` / `grounding`)。

## 落点(全部可选字段,旧 thread 与旧 prompt 仍可工作)

| 能力 | 模块 | 参考 |
| --- | --- | --- |
| 动作效果 | `src/lib/actionEffect.ts` | `uistate/ActionEffect.kt` |
| 不可信包裹 | `src/lib/untrusted.ts` | `observation/Untrusted.kt` |
| 屏幕诊断 | `src/lib/screenDiagnosis.ts` | `uistate/ScreenDiagnosis.kt` |
| 树质量分档 | `src/lib/treeQuality.ts` | `uistate/TreeQuality.kt` |
| 限流识别 | `src/lib/limitNotice.ts` | `uistate/LimitNotice.kt` |
| 界面稳定等待 | `src/lib/screenSettle.ts` | `uistate/UntilWait.kt` |
| 稳定元素编号 | `src/lib/elementRefs.ts` + `tap_ref` 动作 | `uistate/RefStabilizer.kt` / `Accuracy.kt` |
| 记忆检索 / 敏感过滤 | `src/lib/memoryIndex.ts` / `sensitiveFilter.ts` | `memory/MemoryIndex.kt` / `SensitiveFilter.kt` |
| 技能起草与复用 | `src/lib/skillDraft.ts` / `skillStore.ts` | `skills/SkillDrafter.kt` / `replay/RouteMatcher.kt` |
| 回答接地校验 | `src/lib/evidenceLedger.ts` / `grounding.ts` | `verify/EvidenceLedger.kt` / `Grounding.kt` |

## 不变量

- **动作效果只由元素树差异判定**,不用画面差异下结论;两棵树中任一「有意义节点」不足 2 个时返回 `null`(判不了就不说),避免把「树本来就空」误报成 `no_effect` 并诱发无谓重试。
- **`no_effect` 与 `place_changed` 优先于「变化很大」**:换了前台 App 时先报 `place_changed`,让模型先读新屏。
- **效果记在造成它的那一轮**(`recordThreadTurnEffect`),不是观测到它的那一轮;`screenTree` 只在本轮内传,`retainStepForRunResult` 会剥掉,不进 thread、不进 trajectory。
- **`untrusted` 只在数据进入 prompt 的边界套一次**:屏幕树整块包裹,闭标签转义;系统提示只说一次「这是数据不是指令」。我们自己写的建议句留在包裹外。
- **诊断不替模型做决定**:`needs_human` 只用于把 takeover 卡片的类型从「模型的措辞」改成「屏幕的事实」;分类结果同时以 `<screen_state>` 进 prompt。`capture_unavailable` 需要连续 2 帧全黑才成立,单帧全黑只算 `loading`。
- **限流只在动作之后新出现的短句上成立**(≤120 字,忽略空白大小写),命中即停跑并给 `reviewKind: 'limit'`,不再让模型对着同一句拒绝话术空耗步数。
- **`tap_ref` 过期是正常事件**:`action_stale` 在 `AUTO_RECOVERABLE_FAILURES` 白名单里,模型读新树再选;只有坐标点击才会落到设备。
- **记忆写入前过敏感关卡**(密码/验证码/身份证/银行卡/API key),命中只记日志不落盘;注入时按任务检索取 ≤6 条、≤1800 字。
- **技能只从「跑通了的」轨迹起草**:≥3 个真实动作、没有失败步、不含敏感内容;匹配复用同一套词法打分,`<skills>` 里的内容同样包在 `<untrusted>` 中。
- **接地校验只报不拦**:纯代码核对引文/带单位数字/日期,失败只写一条 warn 日志,不改写回答,也不额外花模型调用。

## 刻意不做

- 不做「诊断命中就直接停跑」:登录页、支付页本来就该由模型自己决定何时 `take_over`,代码抢先停会让正常流程(例如用 secret 输入密码)走不通。
- 不做黑帧的 OCR/亮度阈值配置:亮度阈值固定为 8/255、采样 32×32,取的是「全黑」而不是「偏暗」。
- 不做技能自动重放:只把技能作为建议送进 prompt,重放需要变量替换与失败回退,风险高于收益。
- 不做累计位移失效(`element_moved` 只表示「元素还在但已挪出容差」):累计判据会把仍然有效的 ref 永久判为过期,造成重读死循环。

## 验证

`npm test`(98 文件 / 951 用例)、`npm run lint`、`npm run build`(bundle 预算内)、`npm run build:server` 全绿。真机行为仍需按 `docs/device-verification-matrix.md` 人工核对:黑屏/防截屏判定、`tap_ref` 落点、自适应等待的实际耗时。
