# ClaudeChatAPP Android 远程控制设计规格

- 状态：已批准
- 批准日期：2026-08-13
- 目标仓库：`123caster/ClaudeChatAPP`
- 首版平台：Android
- 使用方式：个人使用、可信局域网直连

## 1. 背景

ClaudeChatAPP 是一个个人使用的 Android 客户端。它通过运行在用户电脑上的本机 Gateway 控制 Claude Code，在手机上提供接近微信的会话列表和聊天体验。

首版不是通用聊天机器人，也不是远程桌面或终端模拟器。它只负责把 Claude Code 的结构化会话、流式回复、工具调用和权限审批安全地呈现到手机端。

Happy 项目是架构参考：电脑端包装或驱动 Claude Code，手机端远程查看和控制会话。本项目不会复制 Happy 的产品范围，首版只实现个人 Android、本机 Gateway 和 Claude Code 控制闭环。

## 2. 产品目标

首版必须实现：

1. Android 真机安装并连接同一局域网内的 Windows 电脑。
2. 通过一次性配对码建立个人设备身份。
3. 查看类似微信的会话列表和聊天页面。
4. 为指定本机项目创建 Claude Code 会话。
5. 实时显示 Claude 文本、工具调用和执行状态。
6. 在手机上允许或拒绝 Claude 的文件操作和命令执行请求。
7. 停止正在运行的 Claude 回合。
8. 在 App 断线、重启或 Gateway 重启后保留历史并恢复可恢复的会话。
9. 为后续 Tailscale 或云端中转保留稳定的传输和认证边界。

## 3. 非目标

首版不包含：

- iOS、Web 或桌面客户端。
- 用户注册、多人协作、群聊或多设备同步。
- 语音、朋友圈、社交关系或消息已读回执。
- 手机文件上传、相册、相机或语音输入。
- 远程桌面、PTY 终端模拟或任意 Shell 控制台。
- 应用商店发布流程。
- 公网直接暴露本机 Gateway。
- 在手机中保存 Claude 账号、API Key 或 Claude 登录凭据。
- `dangerously-skip-permissions` 或全局自动批准高风险操作。

## 4. 已确认的技术方向

项目采用 TypeScript Monorepo：

```text
apps/mobile       React Native + Expo Android App
apps/gateway      Node.js 本机 Gateway
packages/protocol App 与 Gateway 共用协议和 Zod 校验
packages/database SQLite schema、迁移和仓储接口
```

建议的基础设施：

- 包管理与工作区：`pnpm` workspace。
- 手机端：React Native、Expo Development Build、React Navigation。
- 本地状态：Zustand；服务端数据和重连同步由独立 API/事件客户端负责。
- 密钥存储：Expo SecureStore，只保存 Gateway 设备令牌。
- Gateway HTTP：Fastify。
- 实时通道：WebSocket。
- 运行时校验：Zod，共享于 App 和 Gateway。
- 数据库：SQLite，Gateway 是唯一写入者。
- Claude 集成：官方 `@anthropic-ai/claude-agent-sdk`，封装在独立 `ClaudeAdapter` 中。

依赖版本由 lockfile 固定。Claude Agent SDK 的事件格式只能在 `ClaudeAdapter` 内出现，不能泄漏到 UI、数据库或公共 WebSocket 协议中。

## 5. 总体架构

```text
┌─────────────────────────────┐
│ Android App                 │
│ 会话列表 / 聊天 / 权限审批  │
└──────────────┬──────────────┘
               │ HTTP + WebSocket
               │ Bearer device token
┌──────────────▼──────────────┐
│ Local Gateway               │
│ 配对 / 会话 / 事件 / SQLite │
└──────────────┬──────────────┘
               │ ClaudeAdapter
┌──────────────▼──────────────┐
│ Claude Agent SDK / Code     │
│ 本机登录态 / 本机项目目录    │
└─────────────────────────────┘
```

### 5.1 Android App

App 负责用户交互和本地展示，不直接访问 Claude 服务，也不直接执行命令。它只通过版本化协议访问 Gateway。

App 保存：

- Gateway 基础地址。
- 设备令牌，存入 SecureStore。
- 最近一次收到的事件序号。
- 为离线展示准备的有限会话快照缓存。

Gateway 和 SQLite 才是会话与消息的权威数据源。

### 5.2 Local Gateway

Gateway 负责：

- 启动时检查 Claude Code/Agent SDK 是否可用、是否已完成本机认证。
- 输出本机访问地址和一次性配对码。
- 验证设备令牌和请求权限。
- 限制 App 只能选择允许的项目根目录。
- 创建、恢复、中止和观察 Claude 会话。
- 将 Claude SDK 事件转换为稳定的领域事件。
- 在推送前持久化事件，支持断线补发。
- 维护权限请求并将手机端决定返回 Claude。
- 保存会话、消息、工具调用、权限请求和事件游标。

Gateway 默认监听配置端口 `43110`。首版允许用户在配置中修改端口。

### 5.3 ClaudeAdapter

`ClaudeAdapter` 是 Gateway 内唯一依赖 Claude Agent SDK 的模块。它对上层暴露稳定接口：

```ts
interface ClaudeAdapter {
  startSession(input: StartSessionInput): AsyncIterable<ClaudeDomainEvent>;
  resumeSession(input: ResumeSessionInput): AsyncIterable<ClaudeDomainEvent>;
  cancelTurn(sessionId: string): Promise<void>;
  resolvePermission(input: PermissionDecision): Promise<void>;
  healthCheck(): Promise<ClaudeHealth>;
}
```

实现要求：

- 使用流式输入和输出，不通过解析终端 ANSI 文本工作。
- 保存并复用 Claude Session ID。
- 使用 SDK 权限回调处理工具审批。
- 使用 `AbortController` 中止当前回合。
- 未识别的 SDK 事件记录到诊断日志，但不能导致 Gateway 崩溃。
- SDK 升级只允许修改 Adapter 和对应契约测试。

### 5.4 Database

SQLite 默认位于 Windows 用户本地应用数据目录：

```text
%LOCALAPPDATA%\ClaudeChatAPP\gateway.db
```

核心实体：

- `devices`：已配对设备、令牌哈希、创建时间、撤销时间。
- `projects`：允许访问的项目根目录及显示名称。
- `sessions`：本地会话 ID、Claude Session ID、项目、标题、状态。
- `messages`：用户、Claude、系统和工具消息。
- `tool_calls`：工具名、输入摘要、输出摘要、状态。
- `permission_requests`：审批内容、决定、过期时间和关联工具调用。
- `events`：递增事件 ID、会话 ID、事件类型、JSON 负载和时间。

令牌只保存 SHA-256 哈希，明文令牌只在配对成功响应中出现一次。

## 6. 状态模型

会话状态只有：

- `idle`：等待用户输入。
- `running`：Claude 正在执行当前回合。
- `waiting_permission`：Claude 等待手机审批。
- `interrupted`：用户取消、Gateway 重启或 Claude 进程异常退出。
- `error`：无法继续的会话错误。
- `archived`：从默认列表隐藏，但历史保留。

允许的主要转换：

```text
idle -> running
running -> waiting_permission -> running
running -> idle
running -> interrupted
waiting_permission -> interrupted
interrupted -> running
idle | interrupted | error -> archived
```

Gateway 重启后，数据库中遗留的 `running` 或 `waiting_permission` 会话统一转换为 `interrupted`。App 不得显示它们仍在后台运行。

## 7. 配对和认证

### 7.1 首次配对

1. Gateway 在本机控制台显示局域网地址和六位一次性配对码。
2. 配对码有效期为 5 分钟，只能成功使用一次。
3. 用户在 App 输入 Gateway 地址和配对码。
4. Gateway 生成 32 字节随机设备令牌，返回一次后只保存哈希。
5. App 将令牌保存到 SecureStore，后续 HTTP 和 WebSocket 均使用该令牌。

### 7.2 请求认证

- HTTP 使用 `Authorization: Bearer <token>`。
- WebSocket 握手使用 Authorization 请求头，不把令牌放入 URL 查询参数。
- 无效、过期或已撤销令牌返回统一未授权错误。
- 配对接口按 IP 和配对码限流。
- 首版允许一个有效设备；新设备配对需要在本机显式生成新配对码。

### 7.3 局域网安全边界

首版只允许在用户信任的家庭或个人局域网使用。HTTP/WebSocket 流量不承诺抵抗同网段主动监听，因此：

- README 必须明确禁止在公共 Wi-Fi 使用。
- Gateway 默认不配置路由器端口映射。
- App 不提供“公网模式”开关。
- 进入 Tailscale 或云端阶段前，必须启用 HTTPS/WSS 或受信任隧道。

## 8. 项目目录边界

Gateway 配置包含一个或多个允许根目录，例如：

```text
D:\ouyang\Projects
D:\ouyang\Documents\ProjectPool
```

创建会话时：

1. App 只能从 Gateway 返回的项目列表中选择目录。
2. Gateway 使用真实绝对路径解析并验证目标位于允许根目录内。
3. 不接受 App 提交的未经枚举的任意路径。
4. 符号链接、junction 和大小写差异不能绕过根目录验证。

归档或删除会话只影响 ClaudeChatAPP 数据，不删除项目目录或项目文件。

## 9. 通信协议

协议版本首版固定为 `1`。

### 9.1 事件信封

所有实时事件使用统一信封：

```ts
type EventEnvelope<TType extends string, TPayload> = {
  protocolVersion: 1;
  eventId: number;
  sessionId: string | null;
  requestId: string | null;
  type: TType;
  emittedAt: string;
  payload: TPayload;
};
```

首版事件类型：

- `connection.ready`
- `session.snapshot`
- `session.created`
- `session.updated`
- `message.created`
- `assistant.delta`
- `tool.started`
- `tool.completed`
- `permission.requested`
- `permission.resolved`
- `turn.completed`
- `turn.failed`
- `server.notice`

除临时的 `assistant.delta` 外，领域事件在发送前写入 SQLite。完整 Claude 消息在回合完成或中断时落库，确保历史不依赖零散 delta 重建。

### 9.2 HTTP 接口

```text
GET  /v1/health
POST /v1/pairing/exchange
GET  /v1/projects
GET  /v1/sessions
POST /v1/sessions
GET  /v1/sessions/:sessionId
POST /v1/sessions/:sessionId/messages
POST /v1/sessions/:sessionId/cancel
POST /v1/permissions/:permissionId/decision
POST /v1/sessions/:sessionId/archive
```

每个写请求带客户端生成的 `requestId`。Gateway 保存短期幂等记录，重复请求不得重复发送消息、重复执行取消或重复解决权限。

### 9.3 WebSocket

```text
GET /v1/events?after=<lastEventId>
```

连接成功后：

1. Gateway 发送 `connection.ready`。
2. 若 `after` 有效，补发之后的持久化事件。
3. 若游标已经不可用，发送 `session.snapshot`，App 用快照替换本地缓存。
4. 之后持续推送新事件。

App 使用指数退避重连，间隔上限为 30 秒。切换到前台时立即尝试一次重连。

## 10. 核心流程

### 10.1 创建会话

1. App 获取允许项目列表。
2. 用户选择项目并输入第一条消息。
3. Gateway 再次验证项目路径并创建本地会话。
4. Gateway 调用 ClaudeAdapter 启动会话。
5. 获得 Claude Session ID 后更新 `sessions`。
6. 流式事件进入数据库并推送 App。

### 10.2 继续会话

1. App 提交新消息和 `requestId`。
2. Gateway 要求会话状态为 `idle` 或 `interrupted`。
3. ClaudeAdapter 使用保存的 Claude Session ID 恢复上下文。
4. 若 Claude 会话已不可恢复，Gateway 返回明确错误，不静默创建新上下文。

### 10.3 权限审批

1. ClaudeAdapter 收到 SDK 权限回调。
2. Gateway 创建 `permission_requests` 记录，并将会话置为 `waiting_permission`。
3. App 显示完整命令、文件路径、工具名称和 Claude 提供的说明。
4. 用户选择“允许一次”或“拒绝”。
5. Gateway 通过原子更新保证该请求只能解决一次。
6. 决定返回 ClaudeAdapter，会话恢复为 `running`。
7. 10 分钟内没有决定时自动拒绝，并向 Claude 返回超时原因。

### 10.4 中止回合

1. App 发送取消请求。
2. Gateway 调用 ClaudeAdapter 的 `cancelTurn`。
3. 已收到的文本作为不完整消息保存。
4. 会话进入 `interrupted`，用户可以稍后继续。

## 11. Android 信息架构

App 不提供营销落地页。已配对用户启动后直接进入会话列表；未配对用户进入连接页面。

### 11.1 连接页面

- Gateway 地址输入框。
- 六位配对码输入框。
- 连接按钮。
- 连接错误使用可操作的中文提示。
- 不展示 Claude API Key 输入框。

### 11.2 会话列表

- 顶栏标题“Claude”。
- 顶栏展示 Gateway 的在线、连接中或离线状态。
- 右上角加号创建会话。
- 每行展示项目图标、会话标题、最后消息摘要、时间和状态。
- `running` 显示活动状态；`waiting_permission` 显示红色审批角标。
- 长按支持重命名、归档和删除本地会话记录。
- 删除操作明确提示不会删除项目文件。

### 11.3 新建会话

- 从 Gateway 提供的项目列表中选择项目。
- 输入第一条任务。
- 首版使用 Claude 默认模型和 Gateway 默认权限策略。
- 创建后立即进入聊天页。

### 11.4 聊天页

- 用户消息在右侧，使用克制的微信绿色气泡。
- Claude 消息在左侧，使用白色气泡。
- 支持 Markdown、代码块、复制和长文本选择。
- 工具调用显示为紧凑状态行，点击后展开输入、输出摘要和结果。
- 顶栏展示项目名称与会话状态。
- 输入区包含多行文本框和发送按钮。
- 会话运行时，发送按钮切换为停止图标，尺寸保持不变。
- 离线时保留历史浏览，但禁用发送并显示离线横幅。

页面使用 Android 系统字体，不使用视口宽度缩放字号。固定高度工具栏、输入区按钮和状态图标必须有稳定尺寸，避免内容变化造成布局跳动。

### 11.5 权限审批面板

审批使用底部面板，不使用普通聊天气泡：

- 操作类型和工具名称。
- 完整命令或目标文件路径。
- Claude 提供的原因和说明。
- “拒绝”和“允许一次”两个操作。
- 高风险命令使用警告色和二次确认。
- 首版不提供“一直允许”。

## 12. 错误处理

### 12.1 Gateway 不可达

- App 显示离线横幅和最近缓存。
- 禁止新建会话、发送消息和解决权限请求。
- 后台指数退避重连，前台恢复时立即重试。

### 12.2 Claude 不可用

`/v1/health` 区分：

- Claude Code/Agent SDK 未安装或无法启动。
- 本机 Claude 未完成登录。
- Claude 版本不兼容。
- Gateway 自身正常但 Claude 健康检查失败。

错误消息不得泄露令牌、环境变量或完整进程环境。

### 12.3 项目路径无效

Gateway 在启动 Claude 前拒绝请求，返回稳定错误码和中文可操作提示。

### 12.4 Claude 进程异常

- 保存已收到的完整内容。
- 会话进入 `interrupted`。
- 记录诊断日志。
- App 显示“继续会话”，不伪造成功状态。

### 12.5 Gateway 重启

- 数据库执行迁移和完整性检查。
- 残留运行状态转换为 `interrupted`。
- 新连接收到会话快照。
- 未解决的权限请求标记为已取消，不在重启后自动批准。

## 13. 可观察性和隐私

Gateway 使用结构化日志，包含请求 ID、会话 ID、事件类型和错误码。

日志默认不记录：

- 设备令牌或 Authorization 头。
- Claude 登录凭据或环境变量。
- 完整用户消息。
- 完整文件内容。
- 未经截断的命令输出。

诊断模式可以记录协议元数据和截断后的工具摘要，但必须由本机用户显式开启。

## 14. 测试策略

### 14.1 单元测试

- 协议 Zod schema 和版本拒绝逻辑。
- 路径根目录验证，包括 junction、大小写和 `..` 绕过。
- 会话状态机。
- 权限请求只能解决一次。
- 令牌哈希、撤销和配对码过期。
- Claude SDK 事件到领域事件的映射。

### 14.2 Gateway 集成测试

使用 `FakeClaudeAdapter`，覆盖：

- 创建和继续会话。
- 文本 delta 聚合。
- 工具开始和完成。
- 权限允许、拒绝和超时。
- 取消回合。
- WebSocket 断线补发和快照回退。
- Gateway 重启后的状态恢复。

### 14.3 Android 测试

- 连接和配对页面表单。
- 会话列表各状态。
- 长消息、Markdown 和代码块布局。
- 工具调用展开。
- 权限审批和高风险二次确认。
- 离线、重连和重复事件去重。
- 常见 Android 手机宽度下无文本溢出或控件重叠。

### 14.4 端到端测试

1. Android 模拟器连接 Fake Gateway，自动跑完整控制流程。
2. Android 真机连接 Windows Gateway。
3. 使用本机真实 Claude Code 完成只读任务、文件修改审批、命令审批、拒绝、停止和恢复冒烟测试。

真实 Claude 冒烟测试不得自动批准写操作，也不得运行破坏性命令。

## 15. 首版验收标准

只有以下证据全部成立，首版才算完成：

1. Android APK 能安装到真机并正常启动。
2. 真机和 Windows Gateway 在同一局域网内使用一次性配对码配对成功。
3. 未配对设备、无效令牌和已撤销令牌均被拒绝。
4. App 只能看到配置允许的项目，越权路径请求被拒绝。
5. 用户可以创建项目会话并看到 Claude 流式回复。
6. 会话列表和聊天历史在 App 重启后仍可读取。
7. 文件修改和命令执行请求可在手机端允许或拒绝。
8. 用户可以停止正在运行的回合并继续同一 Claude 会话。
9. 手机断网后重连，持久化消息不丢失、不重复。
10. Gateway 重启后历史仍存在，残留运行会话正确显示为中断。
11. FakeClaudeAdapter 自动化测试全部通过。
12. 本机真实 Claude Code 冒烟流程通过。

## 16. 后续云端演进

未来购买 VPS 后，不直接把唯一 Gateway 搬到云服务器。云服务器无法访问用户电脑上的项目和 Claude 登录态。

正确演进方式是：

```text
Android App
    │ HTTPS/WSS
Cloud Relay（VPS）
    │ 长连接、端到端加密或严格 TLS
Local Gateway（仍运行在电脑）
    │
Claude Code + 本机项目
```

V2 需要单独设计：

- Local Gateway 主动向 Cloud Relay 建立出站连接，无需路由器端口映射。
- App 与 Local Gateway 使用设备身份和会话密钥。
- Relay 只路由加密事件，尽量不读取代码和对话明文。
- HTTP/WebSocket 领域协议保持版本兼容，聊天 UI 不因传输路径变化而重写。

Tailscale 可以作为 Cloud Relay 之前的低成本远程访问方案，但不属于首版验收范围。

## 17. Git 分支和合并流程

所有代码和文档更新都遵循以下流程：

1. 开始更新前执行 `git fetch origin`，确认远端 `main` 的最新状态。
2. 从最新 `origin/main` 创建一个目标单一的新分支，不复用已合并的旧分支。
3. 分支名称使用类型和主题，例如 `docs/claudechatapp-design`、`feat/gateway-pairing`、`fix/mobile-reconnect`。
4. 只提交与当前更新有关的文件，不混入本机配置、凭据或无关修改。
5. 在分支上运行与变更范围匹配的测试、类型检查和构建。
6. 提交信息说明变更目的；功能、修复和文档使用 `feat:`、`fix:`、`docs:` 等前缀。
7. 推送分支并通过 Pull Request 合并到 `main`。PR 必须包含变更摘要和验证证据。
8. 合并前确认分支仍基于最新 `main`，有冲突时在分支上解决并重新验证。
9. 不直接向 `main` 提交，不使用 force push，不在未经用户授权时自动合并或删除远端分支。

当前设计文档使用独立 `docs/claudechatapp-design` 分支。用户复核规格后，再决定是否创建 PR 和合并。

## 18. 参考资料

- Happy：<https://github.com/slopus/happy>
- Claude Agent SDK TypeScript：<https://github.com/anthropics/claude-agent-sdk-typescript>
- Claude Code CLI Reference：<https://docs.anthropic.com/en/docs/claude-code/cli-usage>
- React Native：<https://reactnative.dev/docs/getting-started>
- Expo Development Builds：<https://docs.expo.dev/develop/development-builds/introduction/>
- Expo SecureStore：<https://docs.expo.dev/versions/latest/sdk/securestore/>
