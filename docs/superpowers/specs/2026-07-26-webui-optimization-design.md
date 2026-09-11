# WebDroid Agent WebUI 全面优化设计

**日期**：2026-07-26
**状态**：已确认
**作者**：协作设计（用户 + AI）

---

## 1. 背景与目标

WebDroid Agent 当前 WebUI 功能完整，但存在以下可优化空间：

- 三栏布局（左配置 + 中手机 + 右聊天）中手机预览区域不够突出
- 仅支持浅色主题，未跟随系统偏好
- 缺少键盘快捷键与拖拽操作支持
- 自定义 CSS 体量较大（约 6.9k 行），维护成本渐增
- 组件样式缺乏统一的设计系统约束

**优化目标：**

1. 以手机预览为中心重构布局
2. 全面的 UX/交互优化：设备连接、模型配置、聊天执行、手机操作、设置管理、响应式
3. 跟随系统的明暗双主题（支持手动覆盖）
4. 键盘快捷键 + 拖拽操作
5. 引入现代组件库，降低长期维护成本

---

## 2. 技术选型

| 技术 | 版本 | 用途 | 选型理由 |
|---|---|---|---|
| Tailwind CSS | v4 | 原子化样式系统 | 与 Vite 集成良好，按需生成，CSS 变量友好，包体积小 |
| shadcn/ui | latest | 组件库（基于 Radix UI） | 复制式组件、可完全定制、无运行时依赖锁定、官方支持 React 19 |
| Radix UI Primitives | latest | 无样式可访问组件 | Dialog / DropdownMenu / Tooltip / Tabs / Sheet 等 |
| lucide-react | 已有 ^1.16.0 | 图标 | 与 shadcn/ui 同源 |
| sonner | latest | Toast 通知 | shadcn 推荐，轻量 |
| react-resizable-panels | latest | 可拖拽面板布局 | shadcn 推荐，专为分栏布局设计 |

**不引入：** Ant Design / MUI / Chakra UI（重型运行时 UI 库，与渐进式迁移策略不符）。

---

## 3. 布局重构（以手机为中心）

### 3.1 目标布局

```
+------------------------------------------------------+
| Topbar: Logo · 设备状态 · 历史切换 · 主题切换 · 设置  |
+--------+---------------------------------+-----------+
| 历史   |                                 |  聊天     |
| 会话   |      手机预览（最大化）         |  面板     |
| (可折叠|      + 浮动操作按钮             | (可折叠)  |
| 可拖宽)|                                 | 可拖宽    |
|        |  +---------------------------+  |           |
|        |  |  手机截图                 |  | +-------+ |
|        |  |  + 触控覆盖层             |  | |运行日志| |
|        |  |  + Agent 光标             |  | |(底部Tab)| |
|        |  +---------------------------+  | +-------+ |
|        |  [Quick Actions: 截图·Home·Back]|           |
+--------+---------------------------------+-----------+
| 底部 Sheet：配置面板（设备 / 模型 / 高级，默认收起）  |
+------------------------------------------------------+
```

### 3.2 关键变化

- **三栏 → 手机为主**：原左侧 ConfigSidebar 改为底部 `Sheet` 组件，按需拉起；中间手机预览占据视觉中心
- **可折叠面板**：历史会话栏（左）与聊天面板（右）可独立折叠，宽度可拖拽（`react-resizable-panels`）
- **Quick Actions**：手机预览下方浮动快捷操作条（截图、Home、Back、最近任务）
- **底部 Sheet 配置**：设备 / 模型 / 高级配置分 Tab 展示，触发入口在 Topbar

### 3.3 响应式

- **桌面（≥1280px）**：三栏完整布局
- **平板（768–1279px）**：默认折叠历史栏；手机预览 + 聊天面板并存
- **移动端（<768px）**：单栏布局，Tab 切换「预览 / 聊天 / 配置」

---

## 4. 主题系统

### 4.1 实现机制

- CSS 变量定义所有颜色 token，挂 `:root`（light）与 `[data-theme="dark"]` 选择器
- `useTheme()` hook：
  - 默认值：`prefers-color-scheme` 媒体查询
  - 用户手动覆盖：存于 `localStorage`，key 为 `webdroid-theme`
  - 三个选项：`light` / `dark` / `system`
- 通过 `document.documentElement.dataset.theme` 切换
- 监听系统主题变化（仅在 `system` 模式下生效）

### 4.2 Token 清单

沿用现有命名，扩展为完整明暗双套：

- **Surface**：`--page-bg`、`--panel-bg`、`--surface-muted`、`--field-bg`
- **Border**：`--border-default`、`--border-subtle`、`--border-strong`
- **Text**：`--text-primary`、`--text-secondary`、`--text-tertiary`、`--text-disabled`
- **Accent**：`--accent`、`--accent-hover`、`--accent-soft`、`--accent-soft-text`
- **Semantic**：`--primary`（success）、`--danger`、`--warn` 及其 bg/border 变体

### 4.3 切换入口

Topbar 右侧放置主题切换 `DropdownMenu`：亮色 / 暗色 / 跟随系统。

---

## 5. 交互增强

### 5.1 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| Cmd+K / Ctrl+K | 聚焦聊天输入框（未来扩展为命令面板） |
| Cmd+Enter / Ctrl+Enter | 发送当前消息 |
| Esc | 停止当前 Agent 运行 |
| Cmd+B / Ctrl+B | 切换左侧历史栏 |
| Cmd+J / Ctrl+J | 切换底部配置 Sheet |
| ? | 显示快捷键帮助 Dialog |

**实现：** 全局 `useEffect` + `keydown` 监听，结合 `useHotkeys` 自定义 hook；输入框聚焦时不触发单键快捷键。

### 5.2 拖拽操作

- **面板宽度拖拽**：`react-resizable-panels` 提供 `PanelResizeHandle`
- **拖拽导入配置**：设置面板接收 JSON 文件拖放，复用 `parseSettingsImport`
- **拖拽图片到聊天框**（未来扩展，本次仅预留样式钩子）

### 5.3 反馈与状态

- **Toast**：所有异步操作（连接、截图、发送、保存）通过 `sonner` 反馈
- **Skeleton**：模型配置加载、历史会话加载等场景
- **进度动画**：Agent 步骤执行卡片增加进度指示

---

## 6. 组件迁移策略（渐进式 4 阶段）

### Phase 1 — 基础设施（1 天）

- 安装 Tailwind v4（`@tailwindcss/vite` 插件）
- shadcn 初始化：`npx shadcn@latest init`
- 建立 `src/components/ui/` 目录（shadcn 组件存放）
- 实现 `useTheme` hook + 主题切换 UI
- 新 tokens 与现有 `theme.css` 共存（不删除旧样式）

**验收：** 主题切换可用；现有 UI 视觉无回归。

### Phase 2 — 核心布局（1.5 天）

- 引入 `react-resizable-panels`，重构 `App.tsx` 主布局
- Topbar 重构：`DropdownMenu`、主题切换、设置入口
- 底部 Sheet：迁移 ConfigSidebar 内容到 Sheet + Tabs
- PhoneStage 包装：浮动 Quick Actions
- 历史栏、聊天栏折叠逻辑

**验收：** 布局重构完成；三栏在桌面/平板/移动端表现符合设计。

### Phase 3 — 核心面板（2 天）

- ChatPanel / ConversationPanel：迁移 Input/Button/Card → shadcn 组件，集成 `sonner`
- ModelPanel / DevicePanel：表单组件迁移（`Form`、`Input`、`Select`、`Switch`、`Slider`）
- SettingsDialog：迁移到 shadcn `Dialog` + `Tabs`
- SensitiveActionDialog、UnrestrictedModeConfirmDialog、ScreenshotLightbox → shadcn `Dialog` / `AlertDialog`
- RunLog、AgentStepCard、PendingActionCard 视觉对齐

**验收：** 所有面板使用 shadcn 组件；交互回归测试通过。

### Phase 4 — 清理与优化（0.5 天）

- 删除被替换的旧 CSS 文件
- 统一 `primitives/index.tsx`：保留为薄封装或移除
- 性能审计（bundle size、运行时性能）
- 全量回归测试 + 手动真机验证

**验收：** CSS 体积从 ~6.9k 行降至 ~2k 行；所有测试通过。

---

## 7. 文件结构变化

```
src/
  components/
    ui/                    # 新增：shadcn 组件
      button.tsx
      dialog.tsx
      dropdown-menu.tsx
      sheet.tsx
      tabs.tsx
      toast.tsx (sonner)
      ...
    primitives/            # 保留为薄封装或最终移除
    ...（现有组件逐个迁移）
  hooks/
    useTheme.ts            # 新增
    useHotkeys.ts          # 新增
  lib/
    utils.ts               # 新增：cn() 工具
  styles/
    globals.css            # 新增：Tailwind 入口 + CSS 变量
    theme.css              # 逐步弃用，Phase 4 移除
    ...（旧文件按 Phase 进度删除）
```

---

## 8. 测试策略

### 8.1 现有测试

- 所有现有 Vitest 测试必须保持通过（不修改业务逻辑）
- 已覆盖：动作解析、API 客户端、Agent 流程、设置持久化、组件渲染

### 8.2 新增测试

- `useTheme` hook：默认值、手动覆盖、系统监听
- 快捷键 hook：单键、组合键、输入框聚焦时不触发
- 布局组件：折叠/展开、面板拖拽（mock 事件）
- 主题切换 UI：DropdownMenu 行为

### 8.3 手动验证

- 真实设备连接流程
- 各响应式断点下的布局
- 明暗主题在所有面板下的视觉一致性

---

## 9. 风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 包体积增加 ~80KB（gzip） | 首次加载稍慢 | 按需引入 Radix 组件；Tailwind 按需生成 |
| 迁移期间样式不一致 | 视觉体验参差 | 渐进式替换，每 Phase 完整可用 |
| 旧 CSS 与新 tokens 冲突 | 局部样式错乱 | 明确的命名空间隔离，Phase 4 彻底清理 |
| 回归风险 | 现有功能受影响 | 完整测试 + 每 Phase 验收 |

---

## 10. 验收标准

- [ ] 跟随系统的明暗主题，可手动覆盖
- [ ] 以手机预览为中心的响应式布局
- [ ] 完整的键盘快捷键支持
- [ ] 面板折叠与宽度拖拽
- [ ] 所有核心面板迁移至 shadcn/ui 组件
- [ ] 所有现有测试通过 + 新增关键交互测试
- [ ] CSS 体积显著下降（~70%）
- [ ] 真实设备手动验证通过

---

## 11. 后续扩展（不在本次范围）

- 命令面板（Cmd+K）完整实现
- 拖拽图片到聊天框作为附件
- 右键菜单（截图保存、复制坐标）
- 触摸手势（移动端双指缩放手机预览）
- 多用户实时协作
