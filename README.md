<p align="center">
  <img src="./public/webdroid-agent-logo-128.png" alt="WebDroid Agent logo" width="96" />
</p>

# WebDroid Agent

<p align="center">
  <a href="./README.md">中文</a> | <a href="./README.en-US.md">English</a>
</p>

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![WebUSB](https://img.shields.io/badge/WebUSB-Android_ADB-34A853?logo=googlechrome&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-online-F38020?logo=cloudflare&logoColor=white)

WebDroid Agent 是一个以浏览器为核心的 Android 手机 Agent 实验项目。静态部署时它完全在前端运行；Docker 部署时会额外启用一个本地 Node API 代理，让模型请求通过容器转发而不是从浏览器直接跨域请求。它在浏览器中通过 WebUSB/WebADB 连接 Android 设备，截取手机屏幕并发送给 OpenAI 兼容的视觉模型，再把模型返回的受控动作解析、校验并通过 ADB 执行。

项目目标不是替代人工长期托管手机，而是提供一个可以在本地浏览器中快速验证「视觉模型 + 手机控制」链路的实验环境。

[历史在线地址（Pages 旧域名）](https://webadb-autoglm.pages.dev/) · [英文版](./README.en-US.md) · [Tango / WebADB](https://github.com/yume-chan/ya-webadb)

```text
Chromium WebUSB -> Tango/WebADB -> Android ADB
静态部署: 浏览器 fetch -> OpenAI 兼容 /v1/chat/completions -> 视觉模型
Docker: 浏览器 fetch -> 同源本地代理 -> OpenAI 兼容 /v1/chat/completions -> 视觉模型
```

## 目录

- [核心能力](#核心能力)
- [适合谁使用](#适合谁使用)
- [项目状态](#项目状态)
- [工作流程](#工作流程)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [Docker 部署](#docker-部署)
- [模型动作协议](#模型动作协议)
- [mobilerun 兼容](#mobilerun-兼容)
- [Open-AutoGLM 兼容](#open-autoglm-兼容)
- [设备控制细节](#设备控制细节)
- [安全边界](#安全边界)
- [项目结构](#项目结构)
- [验证](#验证)
- [路线图](#路线图)
- [贡献说明](#贡献说明)
- [部署到 Cloudflare Pages](#部署到-cloudflare-pages)
- [License](#license)
- [相关项目和社区](#相关项目和社区)

## 核心能力

- 静态部署纯前端运行，适合本地实验、Cloudflare Pages 等静态站点部署。
- Docker 部署内置同源本地 API 代理，可避免模型服务浏览器 CORS 限制。
- 通过 WebADB 在浏览器中连接已开启 USB 调试的 Android 设备。
- 截取手机屏幕，并把截图、当前 App、设备状态、完整已安装应用列表和历史步骤发送给视觉模型。
- 可显式选择 `webdroid_json`、`open_autoglm_function` 或 `mobilerun_xml` 动作协议。
- 使用 canonical JSON 提示词和动作格式，并保留 Open-AutoGLM、mobilerun 风格动作输出的解析兼容。
- 自动解析、规范化并校验模型返回的下一步动作。
- 通过 ADB 执行启动应用、点击、滑动、输入文本、返回、Home、长按、双击、等待等操作，支持模型显式配置等待时间。
- 支持输入前清空文本、动作后固定等待、瞬时模型 API 错误/模型空回复重试和非敏感执行失败的有限自动恢复。
- 支持可编辑 App Cards、本地 Custom Tools，以及只向模型暴露 ID/标签的安全 Secret 输入。
- 发送聊天消息后默认自动执行，也保留单步计划等高级调试能力。
- 支持敏感动作确认、完全无限制模式、最大步数限制、停止运行，以及高级区中的上下文重置和运行日志导出。
- 页面配置持久化到本机浏览器 `localStorage`，Agent thread/turn 历史持久化到 IndexedDB。

## 适合谁使用

适合用于：

- 验证 OpenAI 兼容视觉模型是否能理解真实手机界面。
- 调试手机 Agent 的动作协议、坐标映射和自动执行流程。
- 研究 Open-AutoGLM、mobilerun 风格动作和更通用 JSON 动作之间的兼容层。
- 在本地安全环境中做 Android UI 自动化原型实验。
- 想快速体验 WebUSB + ADB + 多模态模型闭环的开发者。

不建议用于：

- 支付、下单、删除、授权、账号设置等高风险流程。
- 登录、验证码、密码输入等需要人工明确介入的流程。
- 需要后台服务、长期稳定托管或多设备调度的生产场景。

## 项目状态

当前项目处于实验可用阶段，核心链路已经打通：

- 浏览器端连接 Android 设备并获取截图。
- 调用 OpenAI 兼容视觉模型生成下一步动作。
- 解析 canonical JSON、Open-AutoGLM 和 mobilerun 风格动作。
- 执行常见 ADB 控制指令并记录运行日志。
- 支持聊天驱动的自动执行、人工确认、停止、上下文恢复和基础失败恢复。

仍建议把它当作本地实验工具使用。真实设备、模型能力、浏览器权限、CORS 配置和 Android ROM 差异都会影响效果。

## 工作流程

1. 在 Chromium 系浏览器中打开应用。
2. 连接开启 USB 调试的 Android 设备，并在手机上授权 ADB 调试。
3. 填写 OpenAI 兼容接口的 `Base URL`、`API Key` 和 `Model`。
4. 在右侧聊天区输入自然语言指令，例如「打开设置并进入 Wi-Fi 页面」。
5. 发送后应用截屏并请求模型返回一个动作。
6. 前端解析、校验动作，并自动执行安全动作；敏感动作默认仍会请求确认。
7. 如果非敏感动作执行失败，失败反馈会进入下一轮上下文，模型最多获得少量自动恢复机会。
8. 重复执行，直到模型返回 `done`、请求 `take_over`、达到最大步数或用户停止；开启完全无限制模式时不会因 `take_over` 停止。

## 环境要求

- 支持 WebUSB 的 Chromium 系浏览器，例如 Chrome 或 Edge。
- 已开启 USB 调试的 Android 设备。
- 可传输数据的 USB 数据线。
- OpenAI 兼容的 `/v1/chat/completions` API。
- 支持 `image_url` 输入的视觉模型。
- 静态部署时，API 服务需要允许浏览器跨域请求，也就是正确配置 CORS；Docker 部署可通过同源本地代理规避这项要求。
- 页面需要运行在 `localhost` 或 HTTPS 环境下，WebUSB 才能正常工作。

## 快速开始

```bash
npm install
npm run dev
```

然后用 Chrome 或 Edge 打开 Vite 输出的本地地址。

常用命令：

```bash
npm test
npm run lint
npm run build
npm run preview
```

## 配置说明

应用会把以下配置保存在当前浏览器的 `localStorage` 中：

- `Base URL`：OpenAI 兼容接口地址，默认 `https://api.openai.com/v1`。
- `API Key`：模型接口密钥。
- `Model`：模型名称，默认 `gpt-5.5`。
- `Thinking depth`：GPT-5.5 等推理模型的 `reasoning_effort`，可使用服务默认值，或选择 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`。
- `Action protocol`：模型动作协议，可选 `webdroid_json`、`open_autoglm_function`、`mobilerun_xml`。
- `Max steps`：自动执行的最大步数，默认 `50`。
- `Confirm sensitive actions`：敏感点击是否需要人工确认，默认开启。
- `完全无限制模式`：绕过本地安全策略和敏感确认，模型也会被提示不要请求人工接管。
- `Stream responses`：是否启用流式响应，默认关闭。
- `Use ADB Keyboard for text`：是否优先使用 ADB Keyboard 输入文本，默认关闭。
- `Action settle`、`Double tap interval`、`Keyboard step`：动作执行后的等待和输入节奏参数。
- `App Cards`：按包名编辑的应用上下文卡片，默认内置 Chrome、Gmail、Settings。
- `Secrets`：本地 Secret 列表，模型只看到 `id` 和 `label`，执行时通过 `type_secret` 在本机解析真实值。
- `Custom Tools`：本地工具定义，模型只看到工具名和描述，执行结果在本地返回给下一轮上下文。

API Key 只保存在浏览器本地。请只在可信设备和本地实验环境中使用。Docker 部署时，浏览器会把模型请求发送到同源的本地代理接口，再由容器内 Node 服务请求模型 API，以绕过浏览器 CORS 限制。

## Docker 部署

Docker 镜像会构建同一个前端应用，并额外启用一个本地 Node 服务：

- 浏览器访问容器页面，WebUSB/WebADB 仍然在浏览器中工作。
- 前端请求同源 `/api/openai/chat/completions`。
- 容器内 Node 服务读取请求里的 `Base URL`、`API Key` 和 OpenAI-compatible payload，再转发到模型 API。
- Cloudflare Pages 不使用这个 Node 服务，也不会设置代理构建变量，仍然是静态前端和浏览器直连模型 API。

构建并运行：

```bash
npm run docker:build
docker run --rm -p 8080:8080 webdroid-agent
```

然后用 Chrome 或 Edge 打开：

```text
http://localhost:8080/
```

如果使用仓库内的 Docker Compose 配置：

```bash
docker compose up -d --build
```

则打开：

```text
http://localhost:8083/
```

Docker 运行时不需要把 API Key 写进环境变量；继续在页面里的模型配置中填写。请不要把这个容器代理直接暴露到不可信公网，因为它会转发浏览器提交的任意 OpenAI-compatible `Base URL`。

## 模型动作协议

推荐让模型只返回一个 JSON 对象，不要包含 Markdown 或解释性文本：

```json
{ "action": "tap", "x": 540, "y": 1280, "reason": "点击搜索框" }
```

canonical JSON 推荐使用的标准动作：

| 动作 | 说明 |
| --- | --- |
| `launch` | 启动应用，可传常见应用名或包名 |
| `tap` | 点击屏幕坐标 |
| `swipe` | 从一个坐标滑动到另一个坐标 |
| `input_text` | 输入文本；`clear:true` 会先清空当前焦点文本框 |
| `type_secret` | 输入本地 Secret；模型只传 `secretId`，不会看到真实值 |
| `open_url` | 使用 Android `ACTION_VIEW` 打开网页 URL 或 App deep link |
| `set_clipboard` | 设置 WebDroid 剪贴板文本，并尽力同步到设备剪贴板 |
| `paste` | 将 WebDroid 剪贴板文本粘贴/输入到当前焦点 |
| `custom_tool` | 调用本地配置的 Custom Tool |
| `key` | 发送 Android 按键，如 `BACK`、`HOME`、`ENTER` |
| `back` | 返回 |
| `home` | 回到桌面 |
| `long_press` | 长按坐标 |
| `double_tap` | 双击坐标 |
| `wait` | 等待一段时间，推荐使用 `duration` 秒数 |
| `take_over` | 请求人工接管 |
| `note` | 记录观察，不执行设备动作 |
| `done` | 任务完成 |

示例：

```json
{ "action": "launch", "app": "Settings", "reason": "打开系统设置" }
```

```json
{ "action": "swipe", "fromX": 540, "fromY": 1700, "toX": 540, "toY": 500, "durationMs": 400, "reason": "向下滚动列表" }
```

```json
{ "action": "take_over", "message": "需要用户输入验证码" }
```

```json
{ "action": "type_secret", "secretId": "gmail_password", "clear": true, "reason": "输入已配置的本地密码" }
```

```json
{ "action": "open_url", "url": "https://example.com/search?q=webdroid", "reason": "直接打开目标网页" }
```

遗留兼容层仍能接收 `interact` 和 `call_api`，但它们不是推荐给模型使用的真实执行动作：`interact` 会转成 `take_over`，`call_api` 会转成带有“不支持二次 API 调用”说明的 `take_over`。

## mobilerun 兼容

解析器也接受常见 mobilerun 风格动作，并映射到 WebDroid 的真实执行动作：

| mobilerun 风格 | WebDroid 执行动作 |
| --- | --- |
| `click_at` / `tap_at` | `tap` |
| `click_area` / `tap_area` | 点击区域中心点 |
| `long_press_at` | `long_press` |
| `type_text` / `type_text_direct` | `input_text` |
| `type_secret` | `type_secret` |
| `custom_tool` | `custom_tool` |
| `system_button` / `press_button` | `key` |
| `open_app` / `open_bundle_id` | `launch` |
| `remember` | `note` |
| `complete` | `done` |

`swipe` 也兼容 `coordinate`、`coordinate2` 和 `duration` 秒数。mobilerun 风格的 `coordinate`、`point`、`position`、`click_area` 坐标都按截图像素处理；只有 Open-AutoGLM 的 `element` 继续按 `0-1000` 相对坐标处理。

## Open-AutoGLM 兼容

解析器也兼容 Open-AutoGLM 风格的动作名称和载荷，包括：

- `Launch`
- `Tap`，支持 `element: [x, y]` 相对坐标
- `Type`
- `Swipe`
- `Back`
- `Home`
- `Long Press`
- `Double Tap`
- `Wait`
- `Take_over`
- `Interact`，会转成 `take_over`
- `Note`
- `Call_API`，会转成带“不支持二次 API 调用”说明的 `take_over`
- `type_secret(secret_id="...")`
- `custom_tool(tool="...")`

也支持类似下面的函数式输出：

```text
do(action="Launch", app="京东")
```

Open-AutoGLM 风格坐标使用 `0-1000` 的相对坐标空间；canonical JSON 默认使用截图像素坐标。应用会在执行前把坐标映射回设备原生坐标。

## 设备控制细节

- 启动应用：优先匹配设备已安装应用列表，也支持内置常见 App 名称映射或直接传 Android 包名。
- 点击/滑动：执行前会校验坐标是否在屏幕范围内。
- 界面结构：每步会尽力通过 `uiautomator dump --compressed` 读取当前控件树，把可见文本、描述、资源 ID、可点击状态和 bounds 注入模型上下文。
- 打开 URL：使用 Android `am start -a android.intent.action.VIEW -d <url>`，支持网页和设备上已注册的 deep link。
- 长按：使用 Android `input swipe x y x y duration` 命令模拟。
- 双击：连续发送两次 `tap`，中间带可配置延迟。
- 文本输入：简单 ASCII 文本使用 Android `input text`。
- 清空后输入、中文和复杂字符：使用 ADB Keyboard 或 AutoGLM Keyboard 广播模式输入。
- 剪贴板：`set_clipboard` 会保存一份本地 WebDroid 剪贴板并尝试调用 `cmd clipboard set`；`paste` 优先用本地剪贴板通过当前输入通道写入焦点框。
- ADB Keyboard 模式要求设备上已安装并启用 `com.android.adbkeyboard/.AdbIME`；设备面板提供安装和启用入口。
- 每个设备动作执行后会按 `Action settle` 配置等待，避免动画或页面加载期间过早进入下一步。

## 安全边界

项目会尽量在前端执行前做约束和确认：

- 模型输出必须能解析为受支持动作。
- 坐标会进行屏幕范围校验。
- 文本输入会限制长度并拒绝控制字符。
- `type_secret` 只从模型接收本地 Secret ID，真实 Secret 值不会进入模型请求或日志摘要。
- 自动执行有最大步数限制。
- 用户可以随时停止运行。
- 敏感点击可要求人工确认；开启完全无限制模式时会跳过这些确认。
- `take_over`、`note`、`done` 不会直接操作设备；遗留 `interact` 和 `call_api` 会转成人工接管。

仍然建议避免让 Agent 操作账号登录、支付、下单、删除、授权、验证码、隐私页面等高风险流程。默认情况下模型返回 `take_over` 时，自动执行会停止并等待人工接管；开启完全无限制模式后不会因接管请求停止。

## 项目结构

```text
src/
  adapters/
    adbKeyboard.ts            # ADB Keyboard 安装、检测和编码工具
    appPackages.ts            # 常见 App 名称和包名映射
    deviceCommands.ts         # 设备命令兼容导出口
    deviceParsers.ts          # dumpsys 和截图二进制解析
    deviceRetry.ts            # 设备读取重试和延迟工具
    deviceTiming.ts           # 设备执行时序默认值
    deviceTypes.ts            # 设备后端共享类型和错误
    inputCommands.ts          # ADB 输入命令构建
    installedApps.ts          # 已安装应用解析、搜索和显示名
    sensitiveActions.ts       # 敏感动作确认
    screenshotPreprocess.ts   # 截图预处理
    stayAwakeCommands.ts      # ADB 连接期间保持唤醒命令
    webAdbBackend.ts          # WebADB/WebUSB 实现
  components/
    AgentStepCard.tsx         # Agent 步骤卡片
    AppTopbar.tsx             # 顶栏品牌和状态
    ChatHistorySidebar.tsx    # 历史会话侧栏
    ChatPanel.tsx             # 聊天记录和输入区外壳
    ConfigRail.tsx            # 收起状态下的配置快捷栏
    ConfigSidebar.tsx         # 设备和模型配置侧栏编排
    ConversationPanel.tsx     # 聊天、历史会话和待执行动作
    DeviceOptionsSection.tsx  # 设备输入、确认和时序选项
    DevicePanel.tsx           # 设备连接和执行设置面板
    DirectCommandsSection.tsx # 直接 ADB 动作面板
    InstalledAppsSection.tsx  # 已安装应用搜索和启动
    LazyDetails.tsx           # 延迟渲染的折叠区域
    MarkdownContent.tsx       # 聊天消息 Markdown 渲染
    ModelPanel.tsx            # 模型配置面板
    PendingActionCard.tsx     # 待执行动作确认卡片
    PhoneStage.tsx            # 手机截图和动作覆盖层
    RunLog.tsx                # 运行日志
    ScreenshotLightbox.tsx    # 截图预览弹窗
    SettingsDialog.tsx        # 应用设置、仓库信息和可编辑资源
    TutorialPanel.tsx         # 顶部栏展开的快速上手教程
  hooks/
    useAgentRunController.ts        # Agent 自动运行和待执行动作控制
    useAgentSessionHistory.ts       # 会话恢复、保存和历史列表状态
    useBusyTask.ts                  # 运行中任务和错误状态管理
    useConfigTargetScroll.ts        # 配置侧栏目标定位
    useDeviceBackendPreferences.ts  # 设备后端偏好同步
    useDeviceController.ts          # 设备连接、截图和直接动作控制
    useDocumentPreferences.ts       # 文档主题和语言属性同步
    useLatestValue.ts               # 异步回调读取最新值的 ref
    usePersistedSettings.ts         # 设置变更持久化
    useRepositoryStats.ts           # 设置弹窗中的 GitHub 仓库统计加载
    useRunLog.ts                    # 运行日志状态管理
    useStorageEstimate.ts           # 本地存储容量估算
  lib/
    actionDefaults.ts         # 常用截图动作默认值
    actionParser.ts           # 动作解析、规范化和校验
    actionPreview.ts          # 动作预览文案格式化
    actionProtocol.ts         # 显式动作协议枚举
    actionSafetyPolicy.ts     # 本地动作安全策略
    actionTypes.ts            # 动作类型和校验错误定义
    actions.ts                # 动作模块兼容导出口
    agentResources.ts         # App 外的本地 Secret 和 Custom Tool 资源
    agent.ts                  # Agent 循环调度
    agentThread.ts            # 持久化 Agent thread/turn/event 模型
    appCards.ts               # 可编辑应用上下文卡片
    appCopy.ts                # 界面文案聚合和语言解析
    appCopy.en-US.ts          # 英文界面文案
    appCopy.zh-CN.ts          # 中文界面文案
    busyTask.ts               # 页面运行中任务标识
    contextBuilder.ts         # 本轮模型上下文构建和压缩
    deviceDoctor.ts           # 设备和模型配置诊断
    deviceState.ts            # 设备状态展示格式化
    interactionStream.ts      # 聊天消息和 Agent 步骤合并展示
    openAiClient.ts           # OpenAI 兼容网络客户端
    openAiErrors.ts           # OpenAI 客户端错误类型
    openAiPayload.ts          # OpenAI 兼容请求体构造
    openAiResponse.ts         # OpenAI 兼容响应读取和错误格式化
    openAiRuntimeConfig.ts    # OpenAI 请求运行时配置
    openAiTypes.ts            # OpenAI 客户端和消息类型
    promptContextFormatting.ts # 模型上下文格式化工具
    prompts.ts                # 提示词和动作规则
    repository.ts             # 仓库链接和 GitHub 统计解析
    runLogEntries.ts          # 运行日志条目和截图视图格式化
    screenshot/              # 截图坐标、上下文和内存保留策略
      coordinates.ts
      index.ts
      retention.ts
    settings.ts               # 本地设置读写
    threadStore.ts            # Agent thread 持久化存储
    toolRegistry.ts           # Agent 动作工具注册和执行入口
  styles/                    # 按页面区域拆分的样式
    agent-step-card.css      # Agent 步骤卡片样式
    chat-composer.css        # 聊天输入区样式
    chat-history.css         # 历史会话侧栏样式
    chat-panel.css           # 聊天面板样式
    compact-section.css      # 折叠工具区样式
    config-panel.css         # 设备和模型配置面板样式
    config-rail.css          # 收起配置栏样式
    controls.css             # 表单、按钮和通用控件样式
    conversation-panel.css   # 会话面板外壳和待执行动作样式
    device-doctor.css        # 设备诊断结果样式
    device-options.css       # 设备执行选项样式
    device-panel.css         # 设备连接区样式
    direct-commands.css      # 直接命令面板样式
    index.css                # 全局样式入口
    installed-apps.css       # 已安装应用列表样式
    layout.css               # 页面布局和面板外框
    markdown-content.css     # Markdown 内容样式
    model-panel.css          # 模型配置区样式
    phone-stage.css          # 手机预览和动作覆盖层样式
    responsive.css           # 响应式布局调整
    run-log.css              # 运行日志样式
    screenshot-lightbox.css  # 截图预览弹窗样式
    settings-dialog.css      # 设置弹窗样式
    theme.css                # 主题变量和基础 reset
    tutorial-panel.css       # 教程面板样式
  App.tsx                     # 页面状态、业务流程和组件编排
  main.tsx                    # React 入口和全局样式加载
server/
  index.js                    # Docker 中的静态文件和 API 代理服务
  openAiProxy.js              # OpenAI 兼容接口本地代理
```

## 验证

```bash
npm test
npm run lint
npm run build
```

当前测试主要覆盖：

- 动作解析和动作安全校验。
- OpenAI 兼容请求体构造、响应解析和网络客户端错误处理。
- Agent 单步和连续执行流程。
- 失败反馈、瞬时模型 API 错误/模型空回复重试和有限自动恢复。
- 设置持久化和兼容迁移。
- Agent thread/turn 持久化。
- 已安装应用解析、匹配和完整上下文注入。
- 截图坐标映射。
- 运行日志、截图预览和主界面布局组件。

真实设备控制仍需要连接 Android 设备进行手动验证。

## 路线图

- [x] 浏览器中通过 WebADB 连接 Android 设备。
- [x] 截图并发送给 OpenAI 兼容视觉模型。
- [x] 支持 canonical JSON 动作协议。
- [x] 显式支持 `webdroid_json`、`open_autoglm_function`、`mobilerun_xml` 三种动作协议。
- [x] 支持可编辑 App Cards、本地 Custom Tools 和安全 Secret 输入。
- [x] 支持自动执行、单步执行和敏感动作确认。
- [x] 支持运行日志和截图查看。
- [x] 支持已安装应用列表、文本清空输入、可配置等待和基础失败恢复。
- [ ] 补充更完整的真实设备验证矩阵。
- [ ] 增加更多模型提供商配置示例。
- [ ] 增强更系统的失败分类、动作重试和任务暂停恢复体验。
- [ ] 提供更系统的安全策略和风险分级。

## 贡献说明

欢迎围绕以下方向提交 issue 或 pull request：

- 新设备、新浏览器或新模型的兼容性反馈。
- 动作解析、坐标映射、ADB 执行稳定性改进。
- Open-AutoGLM 或其他手机 Agent 协议兼容。
- 文档、示例任务、故障排查和安全建议补充。
- UI 可用性、日志可读性和本地实验体验优化。

提交改动前建议先运行：

```bash
npm test
npm run lint
npm run build
```

## 部署到 GitHub Pages

1. 在 GitHub 仓库设置中，进入 **Settings** -> **Pages**。
2. 在 **Build and deployment** -> **Source** 中选择 **GitHub Actions**。
3. 之后每次推送到 `main` 分支都会触发 `.github/workflows/deploy.yml` 自动构建并部署。

## 部署到 Cloudflare Pages

项目支持在 Cloudflare Pages 部署：

- 部署方式：GitHub 绑定自动部署。
- 构建命令：`npm run build`。
- 构建输出目录：`dist`。

Cloudflare Pages 使用普通 `npm run build`，不要设置 `VITE_OPENAI_PROXY_URL`。这样线上静态站点会继续由浏览器直接请求你填写的 OpenAI 兼容 API，不依赖 Docker 的本地 Node 代理。

## License

本项目基于 [MIT License](./LICENSE) 开源。你可以自由使用、复制、修改、分发和二次开发本项目代码，但需要保留原始版权声明和许可证文本。

项目依赖的第三方库仍遵循各自的开源许可证，请在分发或商用前自行确认依赖合规性。

## 相关项目和社区

- [Tango / WebADB](https://github.com/yume-chan/ya-webadb)：浏览器中的 ADB/WebUSB 能力基础。
- Open-AutoGLM：手机 GUI Agent 动作协议的重要参考。
- Linux.do：活跃的中文技术社区，围绕 AI、软件开发、资源分享与前沿资讯展开讨论。
