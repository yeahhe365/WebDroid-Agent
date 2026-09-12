# WebUI 优化（自研 CSS 路线）Implementation Plan

> **状态（2026-09-12 重写）**：本计划原为「引入 Tailwind CSS v4 + shadcn/ui + Radix 的 4 阶段迁移」。
> 实际代码走的是 `bc14735 feat(ui): redesign workspace as operator console` 的**自研 CSS 令牌 + 分区样式表**路线，
> 原计划的依赖从未安装。经确认（用户决策），本计划**重新界定为自研 CSS 路线**：保留现有操作台外观与全部测试，
> 补齐原计划中仍然有价值且不依赖组件库的两项需求 —— **全局键盘快捷键**与**可拖拽分栏**，
> 其余「迁移到 shadcn」类任务正式废弃。

**Goal:** 在不引入 Tailwind/shadcn 的前提下，让操作台具备跟随系统的明暗主题、手机为中心的布局、键盘快捷键与可拖拽分栏。

**Architecture:** 复用 `src/styles/*.css` 的 CSS 变量令牌体系；新交互以独立 hook 实现（`useHotkeys`、`useSplitPane`），
只在 `App.tsx` 做一次性接线，样式追加到 `layout.css` 的媒体查询内，不改动现有断点行为。

**Tech Stack:** React 19 · TypeScript 6 · Vite 8 · 原生 CSS 变量 · Vitest + Testing Library

## Global Constraints

- 保持所有现有 Vitest 测试通过（`npm test`，当前 59 文件 / 534 测试）。
- 不引入 shadcn/ui、Radix、Tailwind、sonner、react-resizable-panels 等新依赖。
- 主题默认值 `system`（跟随 `prefers-color-scheme`），设置项 `themeMode` 持久化在 `localStorage`。
- 快捷键约定：`Cmd/Ctrl+K` 聚焦输入 · `Cmd/Ctrl+B` 切换配置面板 · `Cmd/Ctrl+J` 切换运行日志 · `Esc` 停止运行。
  发送消息沿用输入框内的 `Enter`（`Shift+Enter` 换行），不再重复绑定 `Cmd/Ctrl+Enter`。
- 分栏拖拽仅在 ≥1200px 生效（更窄的断点由既有响应式规则接管），比例持久化 key `webdroid-workspace-split`。

---

## Phase 1: 主题与令牌（已由操作台重设计交付）

- [x] 设计令牌补全（`theme.css` / `primitives.css`：字重、行高、阴影、间距、`--chrome-bg`）。
- [x] 明暗双主题：`:root[data-theme='dark']` + `@media (prefers-color-scheme: dark)` 回退。
- [x] `themeMode` 设置项（`system` / `light` / `dark`）与 `useDocumentPreferences` 写入 `data-theme`。
- [x] 全局 `prefers-reduced-motion` 支持。

**决定**：不做 Topbar 主题下拉（原 Task 1.4）。主题入口保留在「设置 → Preferences」，避免与设置重复。

## Phase 2: 布局（已交付，含本次新增拖拽）

- [x] 手机为中心的 workspace 布局与配置抽屉（`ConfigSidebar` + Topbar 触发，替代原计划底部 Sheet）。
- [x] 手机预览下方快捷操作条（`DeviceQuickControls`，覆盖原 Task 2.3）。
- [x] 移动端 Tab 布局（`responsive.css` 的 `.workspace-mobile-tabs`，≤899px）。
- [x] **可拖拽分栏**（替代原 Task 2.1 的 `react-resizable-panels`）：
  - `src/hooks/useSplitPane.ts`：百分比状态、指针拖拽、方向键调整、双击复位、越界钳制、localStorage 持久化。
  - `App.tsx`：`.workspace` 挂 `containerRef` 与 `--workspace-split` 变量，插入 `role="separator"` 分隔条。
  - `src/styles/layout.css`：`@media (min-width: 1200px)` 内启用分隔条并按 `--workspace-split` 设定列宽；
    未自定义时仍使用 `.workspace` / `.workspace-running` 各自的默认比例。
  - 测试：`src/hooks/useSplitPane.test.ts`（7 用例）、`src/App.test.tsx`（分隔条 aria 与键盘调整）。

**决定**：不引入 `react-resizable-panels`，不改为底部 Sheet（配置抽屉已满足需求）。

## Phase 3: 键盘快捷键（本次交付）

- [x] `src/hooks/useHotkeys.ts`：window 级监听、`metaOrCtrl` 匹配、单键在输入框内自动忽略、匹配后 `preventDefault`、
      通过 ref 持有最新 handler（不重复注册监听）。
- [x] `App.tsx` 接线：`Cmd/Ctrl+K` 聚焦输入框、`Cmd/Ctrl+B` 开合配置抽屉、`Cmd/Ctrl+J` 开合运行日志、
      `Esc` 在无弹层且任务运行中时停止运行。
- [x] 输入框聚焦辅助 `src/lib/chatComposer.ts`（`textarea[name="chatMessage"]`）。
- [x] 测试：`src/hooks/useHotkeys.test.ts`（6 用例）、`src/App.test.tsx` 的快捷键集成用例。

## Phase 4: 清理与验证（部分仍待办）

- [x] 删除死代码：`components/ConfigRail.tsx`、`components/DirectCommandsSection.tsx`、`styles/config-rail.css`
      （及其在 `styles/index.css` 的 @import），并同步两份 README 的项目结构。
- [x] 更新 README：核心能力补充快捷键与分栏说明，结构树补齐全部现存文件。
- [x] **CSS 瘦身（已完成）**：以 `scripts/css-audit.mjs`（`npm run css:audit`）扫描「类名不再被任何 ts/tsx/html 引用」
      的规则，按文件逐条人工确认后删除：
      `.disclosure*`（theme.css）、`.capability-grid*` 与 `.home-device-installed-apps`（device-options.css）、
      `.status-strip*` / `.readiness-pill.is-running` / `.inspect-drawer .run-log`（layout.css、responsive.css）、
      `.log-drawer*`（run-log.css）、`.direct-command-panel*` / `.direct-command-grid*`（direct-commands.css）、
      `.agent-step-body/block/meta*` 与 `.agent-step-label`（agent-step-card.css）、
      `.chat-send.button--primary*`（chat-composer.css）、`.compact-section .direct-command-panel/.conversation-list`。
      同步更新了两处失效的样式契约断言（`App.test.tsx` 的 `.compact-section .installed-app-panel`、`.command-center` grid-area）。
      结果：`src/styles/*.css` 7,026 → 6,844 行；构建产物 CSS 118.47 kB / gzip 18.65 kB → **115.40 kB / gzip 18.20 kB**。
      注意：扫描器是启发式的，`button--${variant}`、`status-${x}` 这类模板类名会被保守判为存活，输出需人工确认。
- [x] **Bundle 分析（已完成）**：主 chunk 460.45 kB / gzip 140.90 kB（新增两个 hook 后 +3 kB），
      MarkdownContent 158.87 kB / gzip 47.60 kB 未变。
- [ ] **真实设备手动验证（唯一剩余项）**：连接 Android 设备跑完整流程
      （连接 → 配置模型 → 发送任务 → 执行 → 停止 → 拖拽分栏 → 快捷键）。已在真实 Chrome 中验证过快捷键、
      分栏拖拽与持久化、以及删除 CSS 前后的视觉一致性，但真机链路仍需物理设备。
- [x] **废弃项说明**：Phase 3 组件迁移（ChatPanel/ModelPanel/Dialog 等改 shadcn）与 Tailwind 基建不再执行；
      原 Task 2.4 的 `Cmd/Ctrl+Enter` 发送与 `Esc` 关闭底部 Sheet 由现有 Enter 发送与抽屉 Esc 行为覆盖。

## Verification

```bash
npm test          # 59 files / 534 tests
npm run lint      # eslint .
npm run build     # tsc -b && vite build
npm run build:server
npm run css:audit # 失效 CSS 选择器扫描（启发式，需人工确认后删除）
```

当前覆盖本计划改动的测试：

- `src/hooks/useHotkeys.test.ts` —— 组合键、输入框内单键忽略、大小写、shift 约束、preventDefault、handler 热更新。
- `src/hooks/useSplitPane.test.ts` —— 默认值、拖拽、钳制、方向键、持久化与非法存储值。
- `src/App.test.tsx` —— 快捷键聚焦输入框、开合配置/日志抽屉、分隔条 aria 与键盘调整。
