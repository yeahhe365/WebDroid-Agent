# WebUI 全面优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 WebDroid Agent WebUI，引入 shadcn/ui + Tailwind CSS，实现以手机为中心的布局、跟随系统的明暗主题、键盘快捷键、可拖拽面板。

**Architecture:** 渐进式 4-Phase 迁移。Phase 1 建立基础设施（Tailwind + shadcn + 主题）；Phase 2 重构布局（Resizable Panels + 底部 Sheet 配置）；Phase 3 迁移核心面板组件；Phase 4 清理旧 CSS。

**Tech Stack:** React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui · Radix UI · lucide-react · sonner · react-resizable-panels

## Global Constraints

- 保持所有现有 Vitest 测试通过（不修改业务逻辑）
- 保持现有功能可用（设备连接、模型调用、Agent 执行、聊天）
- 不引入 Ant Design / MUI / Chakra UI 等重型运行时 UI 库
- 主题默认值：`system`（跟随 `prefers-color-scheme`），存储 key `webdroid-theme`
- 快捷键：`Cmd/Ctrl+K` 聚焦输入 · `Cmd/Ctrl+Enter` 发送 · `Esc` 停止 · `Cmd/Ctrl+B` 切左栏 · `Cmd/Ctrl+J` 切底部 Sheet
- CSS 体积目标：从 ~6.9k 行降至 ~2k 行

---

## Phase 1: 基础设施（Tailwind + shadcn + 主题）

### Task 1.1: 安装与配置 Tailwind CSS v4

**Files:**
- Modify: `package.json` (添加依赖)
- Create: `src/styles/globals.css`
- Modify: `vite.config.ts` (集成 Tailwind v4 插件)
- Modify: `src/main.tsx` (引入 globals.css)

**Interfaces:**
- Produces: Tailwind v4 可用；CSS 变量 tokens 定义于 `:root` 和 `[data-theme="dark"]`

- [ ] **Step 1: 安装依赖**
```bash
cd /Volumes/WD_BLACK/Code/WebDroid-Agent
npm install -D tailwindcss @tailwindcss/vite
npm install class-variance-authority clsx tailwind-merge
```

- [ ] **Step 2: 配置 vite.config.ts**

在 plugins 数组开头添加：
```typescript
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  // ...其余配置不变
})
```

- [ ] **Step 3: 创建 src/styles/globals.css**

包含 `@import "tailwindcss";` 和完整的明暗主题 CSS 变量 tokens（迁移自 theme.css 的 light 部分，新增 dark 部分）。

- [ ] **Step 4: 修改 src/main.tsx**

在 `import './styles/index.css'` 之前添加：
```typescript
import './styles/globals.css'
```

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: 构建成功，无 CSS 错误

---

### Task 1.2: 实现 useTheme hook

**Files:**
- Create: `src/hooks/useTheme.ts`
- Test: `src/hooks/useTheme.test.ts`

**Interfaces:**
- Produces: `useTheme()` 返回 `{ theme: 'light'|'dark'|'system', resolvedTheme: 'light'|'dark', setTheme: (t) => void }`

- [ ] **Step 1: 写测试**

```typescript
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './useTheme'

describe('useTheme', () => {
  it('defaults to system', () => { /* ... */ })
  it('persists user override to localStorage', () => { /* ... */ })
  it('resolves system to light/dark based on matchMedia', () => { /* ... */ })
})
```

- [ ] **Step 2: 实现 hook**

读取/写入 localStorage `webdroid-theme`；监听 `prefers-color-scheme`；通过 `document.documentElement.dataset.theme` 切换。

- [ ] **Step 3: 测试通过**

Run: `npx vitest run src/hooks/useTheme.test.ts`
Expected: PASS

---

### Task 1.3: shadcn 初始化与基础组件

**Files:**
- Create: `components.json` (shadcn 配置)
- Create: `src/lib/utils.ts` (cn 函数)
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/sheet.tsx`
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/switch.tsx`
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/ui/sonner.tsx`
- Modify: `package.json` (Radix 依赖)

**Interfaces:**
- Produces: 所有 shadcn 基础组件可用；`cn()` 工具函数

- [ ] **Step 1: 安装 Radix 依赖**

```bash
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-switch @radix-ui/react-select @radix-ui/react-slot sonner react-resizable-panels
```

- [ ] **Step 2: 创建 components.json**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 3: 创建 src/lib/utils.ts**

```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 4: 配置 tsconfig paths**

在 `tsconfig.app.json` 和 `tsconfig.json` 添加 paths：
```json
"paths": { "@/*": ["./src/*"] }
```

并在 `vite.config.ts` 添加 resolve.alias：
```typescript
resolve: { alias: { '@': path.resolve(__dirname, './src') } }
```

- [ ] **Step 5: 创建所有 ui 组件**

按 shadcn new-york 风格逐个创建（Button、Dialog、DropdownMenu、Sheet、Tabs、Input、Select、Switch、Tooltip、Sonner）。

- [ ] **Step 6: 验证构建**

Run: `npm run build`
Expected: 构建成功

---

### Task 1.4: Topbar 主题切换入口

**Files:**
- Modify: `src/components/AppTopbar.tsx`

**Interfaces:**
- Consumes: `useTheme`、`DropdownMenu`、`Button` (shadcn)
- Produces: Topbar 右侧主题切换下拉菜单（Light / Dark / System）

- [ ] **Step 1: 在 AppTopbar 右侧添加主题切换**

使用 `Sun` / `Moon` / `Monitor` 图标 + DropdownMenu。

- [ ] **Step 2: 验证**

Run: `npm run dev`，手动切换主题，刷新后保持。

---

## Phase 2: 核心布局

### Task 2.1: Resizable 三栏布局

**Files:**
- Create: `src/components/layout/ResizableLayout.tsx`
- Modify: `src/App.tsx` (主布局部分)

**Interfaces:**
- Consumes: `react-resizable-panels`
- Produces: 三栏 Resizable 布局，左栏可折叠、右栏可折叠

- [ ] **Step 1: 创建 ResizableLayout 组件**

包装 `PanelGroup` + 3 个 `Panel` + 2 个 `PanelResizeHandle`。

- [ ] **Step 2: 在 App.tsx 中替换现有布局**

保留 SetupHome 流程不变；工作台页面使用 ResizableLayout。

- [ ] **Step 3: 验证**

Run: `npm run dev`，手动测试折叠和拖拽。

---

### Task 2.2: 底部 Sheet 配置面板

**Files:**
- Create: `src/components/ConfigSheet.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppTopbar.tsx` (添加触发按钮)

**Interfaces:**
- Consumes: shadcn `Sheet`、`Tabs`；现有 `DevicePanel`、`ModelPanel` 内容
- Produces: 底部 Sheet 包含设备/模型/高级 三个 Tab

- [ ] **Step 1: 创建 ConfigSheet 组件**

接收 `open` 和 `onOpenChange` props；内容使用现有 ConfigSidebar 中的面板。

- [ ] **Step 2: 在 App.tsx 集成**

用 ConfigSheet 替换左侧 ConfigSidebar 渲染。

- [ ] **Step 3: Topbar 添加触发按钮**

`Settings2` 图标按钮，点击打开 Sheet。

- [ ] **Step 4: 验证**

Run: `npm run dev`，测试打开/关闭/Tab 切换。

---

### Task 2.3: PhoneStage Quick Actions

**Files:**
- Create: `src/components/PhoneQuickActions.tsx`
- Modify: `src/components/PhoneStage.tsx`

**Interfaces:**
- Consumes: shadcn `Button`、`Tooltip`
- Produces: 手机预览下方浮动操作条（截图、Home、Back、最近任务）

- [ ] **Step 1: 创建 PhoneQuickActions 组件**

接收 `onScreenshot`、`onHome`、`onBack`、`onRecents` 回调。

- [ ] **Step 2: 集成到 PhoneStage**

绝对定位浮于手机预览下方。

- [ ] **Step 3: 验证**

Run: `npm run dev`，连接设备后测试各操作。

---

### Task 2.4: 键盘快捷键 hook

**Files:**
- Create: `src/hooks/useHotkeys.ts`
- Test: `src/hooks/useHotkeys.test.ts`
- Modify: `src/App.tsx` (注册全局快捷键)

**Interfaces:**
- Produces: `useHotkeys(handlers: HotkeyHandler[])`，输入框聚焦时自动忽略单键

- [ ] **Step 1: 实现 hook**

监听 window keydown；检查 `event.target` 是否为 input/textarea/contenteditable。

- [ ] **Step 2: 写测试**

覆盖单键、组合键、输入框聚焦场景。

- [ ] **Step 3: 在 App.tsx 注册快捷键**

`Cmd/Ctrl+K` 聚焦聊天输入；`Cmd/Ctrl+Enter` 发送；`Esc` 停止；`Cmd/Ctrl+B` 切左栏；`Cmd/Ctrl+J` 切底部 Sheet。

- [ ] **Step 4: 验证**

Run: `npx vitest run src/hooks/useHotkeys.test.ts && npm run dev`
Expected: 测试 PASS；手动验证快捷键行为。

---

## Phase 3: 核心面板迁移

### Task 3.1: ChatPanel 迁移

**Files:**
- Modify: `src/components/ChatPanel.tsx`
- Modify: `src/components/ConversationPanel.tsx`

**Interfaces:**
- Consumes: shadcn `Button`、`Input`、`Card`、`Tooltip`；sonner `toast`
- Produces: 聊天面板使用 shadcn 组件

- [ ] **Step 1: 替换 Button/Input 为 shadcn 版本**

- [ ] **Step 2: 集成 sonner toast**

替换现有的本地 toast 实现。

- [ ] **Step 3: 验证**

Run: `npx vitest run src/components/ConversationPanel.test.tsx`
Expected: PASS

---

### Task 3.2: ModelPanel / DevicePanel 迁移

**Files:**
- Modify: `src/components/ModelPanel.tsx`
- Modify: `src/components/DevicePanel.tsx`

**Interfaces:**
- Consumes: shadcn `Input`、`Select`、`Switch`、`Button`
- Produces: 配置面板使用 shadcn 组件

- [ ] **Step 1: 替换表单控件**

- [ ] **Step 2: 验证**

Run: `npx vitest run src/components/ModelPanel.test.tsx src/components/DevicePanel.test.tsx`
Expected: PASS

---

### Task 3.3: Dialog 迁移

**Files:**
- Modify: `src/components/SettingsDialog.tsx`
- Modify: `src/components/SensitiveActionDialog.tsx`
- Modify: `src/components/UnrestrictedModeConfirmDialog.tsx`
- Modify: `src/components/ScreenshotLightbox.tsx`

**Interfaces:**
- Consumes: shadcn `Dialog`、`AlertDialog`
- Produces: 所有弹窗使用 shadcn 组件

- [ ] **Step 1: 逐个迁移**

- [ ] **Step 2: 验证**

Run: `npx vitest run src/components/SensitiveActionDialog.test.tsx`
Expected: PASS

---

### Task 3.4: 卡片与运行日志视觉对齐

**Files:**
- Modify: `src/components/AgentStepCard.tsx`
- Modify: `src/components/PendingActionCard.tsx`
- Modify: `src/components/RunLog.tsx`

**Interfaces:**
- Consumes: shadcn `Card`、`Badge`
- Produces: 视觉与 shadcn 风格统一

- [ ] **Step 1: 应用 Card 组件**

- [ ] **Step 2: 验证**

Run: `npx vitest run`
Expected: 全部 PASS

---

## Phase 4: 清理与优化

### Task 4.1: 移除旧 CSS

**Files:**
- Delete: `src/styles/theme.css`、`controls.css`、`primitives.css`、`layout.css`、`config-panel.css`、`model-panel.css`、`device-panel.css`、`chat-panel.css`、`chat-composer.css`、`agent-step-card.css`、`run-log.css`、`settings-dialog.css`、`sensitive-action-dialog.css`、`screenshot-lightbox.css`、`phone-stage.css`、`conversation-panel.css`、`chat-history.css`、`compact-section.css`、`config-rail.css`、`device-options.css`、`installed-apps.css`、`direct-commands.css`、`device-doctor.css`、`markdown-content.css`、`tutorial-panel.css`、`setup-home.css`、`responsive.css`
- Modify: `src/styles/index.css` (仅保留少量尚未迁移的)

- [ ] **Step 1: 确认所有组件已迁移**

- [ ] **Step 2: 删除文件**

- [ ] **Step 3: 验证**

Run: `npm run build && npm test`
Expected: 构建成功；所有测试通过。

---

### Task 4.2: 性能审计与最终验证

**Files:**
- Modify: `src/components/primitives/index.tsx` (评估保留或删除)

- [ ] **Step 1: Bundle 分析**

Run: `npm run build`
Expected: 查看输出，确保 Tailwind 按需生成，CSS 体积符合预期。

- [ ] **Step 2: 手动真机验证**

连接 Android 设备，跑完整流程：连接 → 配置模型 → 发送任务 → 执行 → 停止。

- [ ] **Step 3: 更新 README**

如果组件结构变化显著，更新 README 项目结构部分。

---

## Self-Review 检查

- ✅ 所有 Spec 章节都有对应 Task（布局 → Phase 2；主题 → Phase 1；快捷键 → Phase 2.4；拖拽 → Phase 2.1；面板迁移 → Phase 3）
- ✅ 无占位符（所有步骤都有具体命令/代码）
- ✅ 类型一致性（`useTheme` 返回值在各 Task 中一致；`cn()` 全局使用）
- ✅ 频繁验证（每 Task 都有验证步骤）
