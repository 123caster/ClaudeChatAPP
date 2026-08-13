# ClaudeChatAPP 实现计划

- 设计规格：`docs/superpowers/specs/2026-08-13-claude-chat-app-design.md`
- 目标仓库：`123caster/ClaudeChatAPP`
- 基础分支：`main`
- 计划日期：2026-08-13
- 实施方式：每个阶段从最新 `origin/main` 创建独立分支，通过 PR 验证和合并

## 1. 目标

交付一个可安装到 Android 真机的个人 Claude Code 远程控制 App，并提供运行在 Windows 电脑上的本机 Gateway。首版在可信局域网内工作，支持配对、项目选择、微信式会话列表和聊天页、流式回复、工具调用、权限允许/拒绝、停止生成、历史持久化和断线恢复。

本计划不以“项目能启动”作为完成标准。最终必须通过设计规格第 15 节的全部验收项，包括真实 Claude Code 冒烟测试和 Android APK 真机安装。

## 2. 当前环境证据

已确认：

```text
Windows
Node.js  v24.16.0
npm      11.13.0
pnpm     10.26.2
Claude   2.1.212
```

PowerShell 会阻止执行 npm 全局安装生成的 `.ps1` 文件，因此所有自动化命令使用 `.cmd` 入口：

```text
C:\Program Files\nodejs\npm.cmd
C:\Users\ouyang\AppData\Roaming\npm\pnpm.cmd
C:\Users\ouyang\AppData\Roaming\npm\claude.cmd
```

Codex 自带 pnpm 可作为备用：

```text
C:\Users\ouyang\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd
```

当前缺失：

- Android Studio。
- Android SDK。
- Android Platform Tools / ADB。
- 可供 Gradle 使用的 JDK。

这些缺失项不会阻塞 Gateway、协议和大部分 React Native 逻辑开发，但会阻塞原生开发构建、APK 生成和真机 ADB 验收。

## 3. 分支与合并纪律

每个阶段严格执行：

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <branch-name>
```

阶段完成后：

1. 检查 `git status`，只保留当前阶段文件。
2. 运行该阶段列出的验证命令。
3. 使用 Conventional Commit 提交。
4. 推送分支并创建 PR。
5. 检查 PR 文件范围、冲突状态和 CI。
6. 满足验证条件后合并，不 force push，不直接提交 `main`。
7. 下一阶段重新从最新 `origin/main` 创建分支。

阶段按顺序合并，后续分支不从未合并的功能分支继续分叉。

## 4. PR 序列

| 顺序 | 分支 | 目的 | 主要验证 |
| --- | --- | --- | --- |
| 1 | `docs/implementation-plan` | 落地本实现计划 | 文档自检、diff check |
| 2 | `chore/monorepo-bootstrap` | 建立 pnpm Monorepo、协议包、Gateway 和 Expo 基线 | install、lint、typecheck、unit test |
| 3 | `feat/gateway-pairing-projects` | Gateway 配置、SQLite、配对认证和项目边界 | Gateway 集成测试 |
| 4 | `feat/gateway-sessions-events` | Fake Claude 会话、消息、事件持久化和 WebSocket 补发 | API/WebSocket 集成测试 |
| 5 | `feat/claude-agent-adapter` | 接入真实 Claude Agent SDK、权限回调和取消 | Adapter 契约测试、真实 CLI 冒烟 |
| 6 | `feat/mobile-connection-sessions` | Android 配对、连接状态、会话列表和新建会话 | 组件测试、Expo export |
| 7 | `feat/mobile-chat-control` | 微信式聊天、工具详情、权限审批、取消和重连 | 组件测试、Fake Gateway E2E |
| 8 | `test/android-release-hardening` | Android 环境、真机 APK、全链路验收和运行文档 | APK、ADB 真机、真实 Claude 验收 |

## 5. PR 1：实现计划

### 分支

`docs/implementation-plan`

### 文件

- 新增：`docs/superpowers/plans/2026-08-13-claude-chat-app-implementation.md`

### 步骤

1. 从已合并设计规格的最新 `origin/main` 创建分支。
2. 写入本计划，确保每个阶段都有文件范围、测试和完成证据。
3. 扫描未完成标记和模糊占位内容。
4. 运行 `git diff --check`。
5. 提交：`docs: add ClaudeChatAPP implementation plan`。
6. 推送并通过 PR 合并。

## 6. PR 2：Monorepo 和契约基线

### 分支

`chore/monorepo-bootstrap`

### 目标

建立所有后续功能共享的构建、类型和测试基础。该阶段不实现真实 Claude 会话，也不实现完整 UI。

### 文件

根目录：

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.base.json`
- `eslint.config.mjs`
- `.prettierrc.json`
- `.gitignore`
- `.npmrc`
- `README.md`

协议包：

- `packages/protocol/package.json`
- `packages/protocol/tsconfig.json`
- `packages/protocol/src/envelope.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/http.ts`
- `packages/protocol/src/errors.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/__tests__/protocol.test.ts`

Gateway 基线：

- `apps/gateway/package.json`
- `apps/gateway/tsconfig.json`
- `apps/gateway/src/app.ts`
- `apps/gateway/src/server.ts`
- `apps/gateway/src/routes/health.ts`
- `apps/gateway/src/__tests__/health.test.ts`

Mobile 基线：

- `apps/mobile/package.json`
- `apps/mobile/app.json`
- `apps/mobile/tsconfig.json`
- `apps/mobile/index.ts`
- `apps/mobile/App.tsx`
- `apps/mobile/src/theme/colors.ts`
- `apps/mobile/src/theme/spacing.ts`
- `apps/mobile/src/screens/BootstrapScreen.tsx`
- `apps/mobile/src/__tests__/BootstrapScreen.test.tsx`

### 实施步骤

1. 创建根 `package.json`，要求 Node `>=22`，固定 pnpm major 为 10。
2. 配置 `pnpm` workspace，包含 `apps/*` 和 `packages/*`。
3. 创建共享 TypeScript、ESLint、Prettier 和测试脚本。
4. 创建 `@claude-chat/protocol` 包，使用 Zod 定义协议版本 1。
5. 先写协议失败测试：拒绝错误版本、缺失字段和未知事件负载。
6. 实现事件信封、HTTP DTO、错误码和导出入口，使测试通过。
7. 创建 Fastify Gateway，首个接口只实现 `GET /v1/health`，返回 Gateway 版本和 `starting` Claude 状态。
8. 创建 Expo TypeScript App，首屏仅显示稳定的启动状态，不做营销页。
9. 确保 mobile 和 gateway 均从 workspace 引用协议包，不复制类型。
10. 更新 README，说明此阶段仅为开发基线。

### 验证

```powershell
pnpm.cmd install --frozen-lockfile=false
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd --filter @claude-chat/gateway build
pnpm.cmd --filter @claude-chat/mobile exec expo export --platform android
```

### 完成证据

- 全 workspace 安装成功并生成 lockfile。
- 协议非法输入测试通过。
- Gateway health 测试通过。
- Expo Android JS bundle 可导出。
- 未声称已生成 APK。

### 提交

`chore: bootstrap ClaudeChatAPP monorepo`

## 7. PR 3：Gateway 配对、认证和项目边界

### 分支

`feat/gateway-pairing-projects`

### 目标

建立 Gateway 的配置、SQLite 数据层、一次性配对、设备令牌和允许项目目录。该阶段不启动 Claude。

### 文件

Database：

- `packages/database/package.json`
- `packages/database/tsconfig.json`
- `packages/database/src/client.ts`
- `packages/database/src/migrate.ts`
- `packages/database/src/migrations/001_initial.sql`
- `packages/database/src/repositories/device-repository.ts`
- `packages/database/src/repositories/project-repository.ts`
- `packages/database/src/index.ts`
- `packages/database/src/__tests__/database.test.ts`

Gateway：

- `apps/gateway/src/config.ts`
- `apps/gateway/src/errors.ts`
- `apps/gateway/src/auth/pairing-code-service.ts`
- `apps/gateway/src/auth/device-auth.ts`
- `apps/gateway/src/projects/path-policy.ts`
- `apps/gateway/src/routes/pairing.ts`
- `apps/gateway/src/routes/projects.ts`
- `apps/gateway/src/__tests__/pairing.test.ts`
- `apps/gateway/src/__tests__/projects.test.ts`
- `apps/gateway/src/__tests__/path-policy.test.ts`

配置示例：

- `apps/gateway/config.example.json`

### 实施步骤

1. 先写 SQLite 迁移测试，覆盖 `devices`、`projects`、`sessions`、`messages`、`tool_calls`、`permission_requests` 和 `events` 表。
2. 实现数据库初始化、迁移事务和测试临时数据库。
3. 先写配对服务测试：六位码、5 分钟过期、一次使用、失败限流。
4. 使用 `crypto.randomBytes(32)` 生成设备令牌，只持久化 SHA-256 哈希。
5. 实现 `POST /v1/pairing/exchange`。
6. 实现 Bearer Token 认证钩子和令牌撤销检查。
7. 先写路径策略攻击测试：`..`、大小写差异、junction/symlink 和非允许目录。
8. 实现 Windows 真实路径规范化和允许根目录校验。
9. 实现认证后的 `GET /v1/projects`。
10. `/v1/health` 增加数据库、配置和配对状态，不返回敏感信息。

### 验证

```powershell
pnpm.cmd --filter @claude-chat/database test
pnpm.cmd --filter @claude-chat/gateway test
pnpm.cmd --filter @claude-chat/gateway typecheck
pnpm.cmd --filter @claude-chat/gateway build
pnpm.cmd lint
```

### 完成证据

- 配对码不能重复使用。
- 数据库不含明文设备令牌。
- 未认证请求无法读取项目列表。
- 越权路径测试全部被拒绝。

### 提交

`feat: add gateway pairing and project access control`

## 8. PR 4：Gateway 会话、消息和事件恢复

### 分支

`feat/gateway-sessions-events`

### 目标

使用 Fake Claude Adapter 完成 Gateway 全部会话和实时事件闭环，在接入真实 Claude 前固定上层协议。

### 文件

Gateway 领域层：

- `apps/gateway/src/claude/claude-adapter.ts`
- `apps/gateway/src/claude/fake-claude-adapter.ts`
- `apps/gateway/src/sessions/session-state-machine.ts`
- `apps/gateway/src/sessions/session-service.ts`
- `apps/gateway/src/sessions/permission-service.ts`
- `apps/gateway/src/events/event-store.ts`
- `apps/gateway/src/events/event-stream.ts`
- `apps/gateway/src/routes/sessions.ts`
- `apps/gateway/src/routes/permissions.ts`
- `apps/gateway/src/routes/events.ts`

Database repositories：

- `packages/database/src/repositories/session-repository.ts`
- `packages/database/src/repositories/message-repository.ts`
- `packages/database/src/repositories/event-repository.ts`
- `packages/database/src/repositories/permission-repository.ts`

测试：

- `apps/gateway/src/__tests__/sessions.test.ts`
- `apps/gateway/src/__tests__/permissions.test.ts`
- `apps/gateway/src/__tests__/events.test.ts`
- `apps/gateway/src/__tests__/restart-recovery.test.ts`

### 实施步骤

1. 先写状态机测试，只允许设计规格中的状态转换。
2. 定义与 SDK 无关的 `ClaudeAdapter` 和 `ClaudeDomainEvent`。
3. 实现可脚本化的 Fake Adapter，支持文本 delta、工具、权限、失败和取消。
4. 先写创建会话 API 测试，验证项目边界、初始消息和幂等 `requestId`。
5. 实现会话、消息、工具和事件仓储。
6. 实现会话列表、详情、发送消息、取消和归档接口。
7. 先写 WebSocket 补发测试：`after` 游标、重复事件、游标失效快照。
8. 实现 `/v1/events` WebSocket 认证、补发和实时广播。
9. 实现权限请求原子决策和 10 分钟超时拒绝。
10. 实现 Gateway 重启恢复：遗留运行状态转为 `interrupted`，未解决权限转为取消。

### 验证

```powershell
pnpm.cmd --filter @claude-chat/gateway test
pnpm.cmd --filter @claude-chat/gateway typecheck
pnpm.cmd --filter @claude-chat/gateway build
pnpm.cmd test
```

### 完成证据

- Fake Adapter 完整流程测试通过。
- 重复请求不会重复发送消息或重复解决权限。
- 断线补发后消息不丢失、不重复。
- Gateway 重启不保留虚假的 `running` 状态。

### 提交

`feat: add gateway sessions and resumable event stream`

## 9. PR 5：真实 Claude Agent SDK Adapter

### 分支

`feat/claude-agent-adapter`

### 目标

让 Gateway 使用本机 Claude Code 登录态和项目目录完成真实会话，同时保持现有 HTTP/WebSocket 协议不变。

### 文件

- `apps/gateway/src/claude/agent-sdk-adapter.ts`
- `apps/gateway/src/claude/agent-event-mapper.ts`
- `apps/gateway/src/claude/permission-coordinator.ts`
- `apps/gateway/src/claude/claude-health.ts`
- `apps/gateway/src/claude/__tests__/agent-event-mapper.test.ts`
- `apps/gateway/src/claude/__tests__/agent-sdk-contract.test.ts`
- `apps/gateway/scripts/claude-smoke.ts`
- `apps/gateway/src/config.ts`
- `apps/gateway/src/routes/health.ts`
- `README.md`

### 实施步骤

1. 安装并锁定 `@anthropic-ai/claude-agent-sdk`，记录锁定版本。
2. 写事件映射契约测试，使用录制后脱敏的 SDK 事件 fixture。
3. 使用 SDK 流式 `query()` 实现启动和恢复会话。
4. 从系统初始化事件提取并保存 Claude Session ID。
5. 将文本、工具、结果、错误和回合完成映射为领域事件。
6. 使用 `canUseTool` 权限回调等待 `PermissionCoordinator` 的一次性决定。
7. 使用 `AbortController` 实现取消，不杀死无关 Claude 进程。
8. 健康检查区分 CLI/SDK 不可启动、未认证和版本不兼容。
9. 默认使用 Fake Adapter 测试；真实 Adapter 只在显式配置时启用。
10. 运行只读真实冒烟，再运行一个临时目录写入审批、拒绝和取消冒烟。

### 风险验证

Agent SDK 更新频繁。必须额外验证：

- `canUseTool` 在普通工具调用和子任务事件中不会因输入流关闭失效。
- 取消当前回合不会破坏之后的 resume。
- 未知 SDK 事件只记录诊断，不导致进程退出。
- SDK 升级只改变 Adapter 和 fixture，不改变公共协议。

若当前 SDK 的后台子任务权限通道存在已知缺陷，首版在 Gateway 配置中禁用后台 Agent 工具，并在 README 明确限制；普通 Claude Code 会话、文件和命令权限控制仍必须通过。

### 验证

```powershell
pnpm.cmd --filter @claude-chat/gateway test
pnpm.cmd --filter @claude-chat/gateway typecheck
pnpm.cmd --filter @claude-chat/gateway build
pnpm.cmd --filter @claude-chat/gateway claude:smoke:readonly
```

写入和权限冒烟使用临时项目目录，并由本机用户现场确认，不自动运行破坏性命令。

### 完成证据

- 本机 Claude 登录态可被 Adapter 使用。
- 真实流式回复进入既有事件协议。
- 文件和 Bash 权限能等待手机或测试协调器的允许/拒绝。
- 取消后可继续同一 Claude Session ID。

### 提交

`feat: connect gateway to Claude Agent SDK`

## 10. PR 6：Android 连接、配对和会话列表

### 分支

`feat/mobile-connection-sessions`

### 目标

完成 Android App 从未配对状态到会话列表和创建会话的闭环。聊天内容先使用基础呈现，复杂控制留到下一 PR。

### 文件

导航和状态：

- `apps/mobile/src/navigation/RootNavigator.tsx`
- `apps/mobile/src/state/connection-store.ts`
- `apps/mobile/src/state/session-store.ts`
- `apps/mobile/src/api/gateway-client.ts`
- `apps/mobile/src/api/event-client.ts`
- `apps/mobile/src/storage/device-credentials.ts`

页面：

- `apps/mobile/src/screens/ConnectionScreen.tsx`
- `apps/mobile/src/screens/SessionListScreen.tsx`
- `apps/mobile/src/screens/NewSessionScreen.tsx`
- `apps/mobile/src/screens/ChatScreen.tsx`

组件：

- `apps/mobile/src/components/ConnectionBanner.tsx`
- `apps/mobile/src/components/SessionRow.tsx`
- `apps/mobile/src/components/SessionStatus.tsx`
- `apps/mobile/src/components/ProjectPicker.tsx`

测试：

- `apps/mobile/src/__tests__/ConnectionScreen.test.tsx`
- `apps/mobile/src/__tests__/SessionListScreen.test.tsx`
- `apps/mobile/src/__tests__/NewSessionScreen.test.tsx`
- `apps/mobile/src/__tests__/event-client.test.ts`

### 实施步骤

1. 配置 React Navigation 和稳定的 Android 页面容器。
2. 使用 SecureStore 保存设备令牌；服务器地址使用普通本地存储。
3. 先写连接页测试：地址校验、六位码、错误显示和成功导航。
4. 实现配对 API 和凭据持久化。
5. 实现 WebSocket 客户端、Authorization 头、事件校验和指数退避。
6. 先写会话列表状态测试：空列表、运行、待审批、离线和错误。
7. 实现微信式会话行、稳定图标尺寸和审批角标。
8. 实现项目列表和新建会话流程。
9. 创建会话后导航到基础聊天页。
10. 增加事件 ID 去重和 App 前台立即重连。

### 验证

```powershell
pnpm.cmd --filter @claude-chat/mobile test
pnpm.cmd --filter @claude-chat/mobile typecheck
pnpm.cmd --filter @claude-chat/mobile lint
pnpm.cmd --filter @claude-chat/mobile exec expo export --platform android
```

使用 Fake Gateway 手工验证窄屏和常见 Android 屏幕宽度，不允许文本溢出或控件重叠。

### 完成证据

- 配对令牌存入 SecureStore。
- 无令牌时不能访问会话。
- 会话列表可显示状态和审批角标。
- 新会话只能选择 Gateway 返回的项目。

### 提交

`feat: add Android pairing and session list`

## 11. PR 7：微信式聊天和完整远程控制

### 分支

`feat/mobile-chat-control`

### 目标

完成聊天流、工具详情、权限审批、停止、离线缓存和断线恢复，使手机端达到完整远程控制范围。

### 文件

状态和同步：

- `apps/mobile/src/state/chat-store.ts`
- `apps/mobile/src/sync/session-sync.ts`
- `apps/mobile/src/storage/session-cache.ts`

聊天组件：

- `apps/mobile/src/components/chat/MessageList.tsx`
- `apps/mobile/src/components/chat/UserBubble.tsx`
- `apps/mobile/src/components/chat/AssistantBubble.tsx`
- `apps/mobile/src/components/chat/MarkdownContent.tsx`
- `apps/mobile/src/components/chat/CodeBlock.tsx`
- `apps/mobile/src/components/chat/ToolCallRow.tsx`
- `apps/mobile/src/components/chat/Composer.tsx`
- `apps/mobile/src/components/chat/PermissionSheet.tsx`
- `apps/mobile/src/components/chat/HighRiskConfirmation.tsx`

页面和测试：

- `apps/mobile/src/screens/ChatScreen.tsx`
- `apps/mobile/src/__tests__/ChatScreen.test.tsx`
- `apps/mobile/src/__tests__/PermissionSheet.test.tsx`
- `apps/mobile/src/__tests__/session-sync.test.ts`
- `apps/mobile/e2e/fake-gateway-flow.test.ts`

### 实施步骤

1. 先写消息归并测试，保证 delta、完整消息和重放事件不会重复。
2. 实现左侧 Claude、右侧用户的微信式气泡和 Markdown。
3. 代码块支持横向滚动、复制和长文本选择。
4. 工具调用默认紧凑显示，展开后展示命令、路径、输入和输出摘要。
5. 先写权限面板测试：允许一次、拒绝、已解决、超时和高风险二次确认。
6. 实现权限底部面板，不提供“一直允许”。
7. 实现运行时发送按钮到停止图标的固定尺寸切换。
8. 实现取消请求和 `interrupted` 状态展示。
9. 实现有限离线缓存、快照替换、事件补发和前后台切换同步。
10. 使用 Fake Gateway 跑配对、创建、回复、工具、审批、取消、断线和恢复全流程。

### 验证

```powershell
pnpm.cmd --filter @claude-chat/mobile test
pnpm.cmd --filter @claude-chat/mobile typecheck
pnpm.cmd --filter @claude-chat/mobile lint
pnpm.cmd --filter @claude-chat/mobile exec expo export --platform android
pnpm.cmd test
```

### 视觉验收

- 360x800、412x915 和常见平板宽度下无重叠。
- 长项目名、长中文、长英文路径和代码块不撑破容器。
- 键盘弹出后输入框和最新消息可见。
- 运行、离线、待审批和中断状态不会改变工具栏高度。
- 颜色不依赖单一色相，微信绿只用于用户气泡和明确主操作。

### 完成证据

- Fake Gateway E2E 全流程通过。
- 权限只可决定一次。
- 断线重连无持久化消息丢失或重复。
- 用户可停止并继续会话。

### 提交

`feat: add mobile chat and remote Claude controls`

## 12. PR 8：Android 真机、发布构建和全链路加固

### 分支

`test/android-release-hardening`

### 环境门槛

该阶段开始前安装：

- 当前稳定版 Android Studio。
- Android SDK Platform 和 Build Tools，版本与 Expo 生成项目一致。
- Android Platform Tools / ADB。
- Android Studio 内置 JBR 或兼容 JDK。

安装属于大型外部下载和系统级工具变更，执行前需要用户批准具体安装范围。安装后记录实际路径，不依赖模糊的全局 `PATH`。

### 文件

- `apps/mobile/eas.json` 或本地构建配置，仅在实际选择 EAS 时添加。
- `apps/mobile/app.json`
- `apps/mobile/android/`，仅在 Expo prebuild 后需要提交原生配置时加入。
- `scripts/start-gateway.ps1`
- `scripts/verify-environment.ps1`
- `docs/setup-windows.md`
- `docs/setup-android.md`
- `docs/security.md`
- `README.md`
- `.github/workflows/ci.yml`

### 实施步骤

1. 安装并验证 Java、SDK、ADB 和 Gradle 所需环境。
2. 创建 Android Emulator，并连接一台真实 Android 手机进行 USB 调试。
3. 配置 Android 局域网 cleartext 开发策略；文档明确只允许可信局域网。
4. 运行 Expo prebuild，审查生成的 Android 权限和网络配置。
5. 构建 debug APK，安装到模拟器和真机。
6. 启动 Windows Gateway，通过 Windows 防火墙仅开放所需私有网络端口。
7. 用 Fake Adapter 跑自动化完整流程。
8. 用真实 Claude Code 跑只读、写入审批、命令审批、拒绝、停止和恢复流程。
9. 重启 App、关闭 Wi-Fi、恢复 Wi-Fi、重启 Gateway，逐项核对历史和状态。
10. 添加 GitHub Actions：install、lint、typecheck、unit test、Gateway build；Android 构建根据运行时间和密钥条件选择是否进入 CI。
11. 更新 README，给出个人用户可执行的安装、启动、配对和安全说明。
12. 生成最终 APK 并记录文件 SHA-256。

### 自动验证

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd --filter @claude-chat/gateway build
pnpm.cmd --filter @claude-chat/mobile exec expo export --platform android
pnpm.cmd --filter @claude-chat/mobile exec expo run:android
```

### 真机验收清单

- [ ] APK 安装成功，冷启动无崩溃。
- [ ] 一次性配对码成功且不能复用。
- [ ] 未配对设备和无效令牌被拒绝。
- [ ] 只能选择允许项目。
- [ ] 创建真实 Claude 会话并显示流式回复。
- [ ] 文件修改请求允许和拒绝均生效。
- [ ] Bash 请求允许和拒绝均生效。
- [ ] 停止当前回合后能继续同一会话。
- [ ] App 重启后历史仍在。
- [ ] 断网重连后消息不丢失、不重复。
- [ ] Gateway 重启后运行会话显示中断。
- [ ] 公共日志中没有令牌、凭据或完整文件内容。

### 完成证据

- APK 绝对路径、大小和 SHA-256。
- ADB 安装和启动成功输出。
- 自动化测试结果。
- 真实 Claude 冒烟操作记录，不包含敏感内容。
- PR 文件范围和合并提交。

### 提交

`test: verify Android release and Claude control flow`

## 13. 实施过程中的停止条件

遇到以下情况时停止当前分支，不用临时绕过方案掩盖问题：

- Agent SDK 无法使用本机 Claude 登录态。
- 权限回调无法等待并恢复，或只能通过跳过权限工作。
- Claude Session ID 无法可靠恢复。
- Android cleartext 网络策略需要扩大到不合理范围。
- 数据库迁移会破坏现有历史。
- PR 包含其他分支或用户的无关修改。
- 真机 APK 未生成，却只有 Expo JS bundle。

停止后保留最小复现、日志摘要和当前分支，不向 `main` 合并不完整或高风险变更。

## 14. 最终完成审计

最终合并前，逐项映射设计规格第 15 节验收标准到以下权威证据：

- GitHub PR 和合并提交。
- 工作区 test、lint、typecheck、build 输出。
- Gateway API/WebSocket 集成测试。
- Fake Gateway Android E2E。
- APK 文件和 SHA-256。
- ADB 真机安装及启动。
- 真实 Claude Code 只读、审批、拒绝、停止和恢复冒烟。
- 配对、越权路径、令牌撤销、断网和重启场景。

任何一项缺失都视为未完成，不以 README、类型检查或单个冒烟结果代替全链路证明。
