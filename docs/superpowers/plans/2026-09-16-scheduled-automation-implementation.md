# ClaudeChatAPP 通用定时任务实施计划

- 设计规格：`docs/superpowers/specs/2026-09-16-scheduled-automation-design.md`
- 影响范围：Protocol、Database、Gateway、Mobile、Android 推送配置
- 发布原则：完成一个完整大阶段并通过全量验证后，才部署 Gateway 和构建 APK
- 安全原则：不提交 Firebase/Expo 凭据、Push Token、API Key、服务器配置或 SQLite 数据

## 1. Protocol 与数据库基础

先写失败测试，再增加共享协议和数据库迁移。

### Protocol

修改：

- `packages/protocol/src/models.ts`
- `packages/protocol/src/http.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/errors.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/__tests__/protocol.test.ts`

增加：

- 任务、周期、运行、推送订阅的严格 Zod Schema。
- 创建、编辑、立即运行、软删除、草稿解析和 Push Token 注册请求。
- `scheduled-task.*`、`scheduled-run.*` 持久化事件。
- 稳定错误码与共享 TypeScript 类型。

### Database

新增：

- `packages/database/src/migrations/011-scheduled-automations.ts`
- `packages/database/src/repositories/scheduled-task-repository.ts`
- `packages/database/src/repositories/scheduled-run-repository.ts`
- `packages/database/src/repositories/push-subscription-repository.ts`
- 对应 Repository 测试

修改 `migrate.ts`、`client.ts` 和 `index.ts` 完成装配。测试覆盖迁移、CRUD、软删除、唯一运行约束、事务领取、租约恢复和 Push Token 轮换。

完成标准：Protocol 与 Database 定向测试、构建和类型检查通过；生成的 `dist` 只用于后续验证，最终清理。

## 2. 时间规则与调度核心

新增 Gateway 模块：

- `apps/gateway/src/scheduled/schedule-calculator.ts`
- `apps/gateway/src/scheduled/scheduled-task-service.ts`
- `apps/gateway/src/scheduled/task-scheduler.ts`
- `apps/gateway/src/scheduled/scheduled-run-service.ts`

使用单一、可注入的时间库处理 IANA 时区。优先引入 `luxon`，避免手写时区和夏令时换算。UI 仍只提交结构化周期，不接受原始 Cron/RRULE。

先增加可控时钟测试，覆盖：

1. 一次性、每天、工作日、每周、每月。
2. 月份不存在指定日期时跳过该月。
3. 跨年、时区、夏令时缺失时间和重复时间。
4. 启动后最近一次补执行。
5. 同任务禁止并发、跳过记录和手动运行。
6. 租约过期、进程恢复和 `(task_id, scheduled_for)` 防重。

调度器支持 `start()` / `stop()`，定时器调用 `unref()`；测试使用手动 `tick()`，不依赖真实等待。

## 3. Gateway CRUD 与事件

新增：

- `apps/gateway/src/routes/scheduled-tasks.ts`
- `apps/gateway/src/__tests__/scheduled-task-routes.test.ts`
- `apps/gateway/src/__tests__/task-scheduler.test.ts`

修改：

- `apps/gateway/src/app.ts`
- `apps/gateway/src/server.ts`
- `apps/gateway/src/events/event-store.ts`（仅在现有接口不足时扩展）

实现任务列表、详情、创建、编辑、暂停/恢复、软删除、立即运行、运行历史和 `/schedule` 草稿解析。所有写操作走 `requestId` 幂等事务。草稿解析只支持规格中的确定性中文时间表达，歧义时返回部分草稿和需要补全的字段，不调用模型静默决定时间。

任务事件写入现有事件表并通过 EventStream 发布；App 可在断线后按 `eventId` 回放。

## 4. 会话执行与任务级权限

扩展 `SessionService`，增加仅供 Gateway 内部使用的计划任务执行上下文，不新增绕过鉴权的公网接口。

新增：

- `apps/gateway/src/scheduled/scheduled-permission-policy.ts`
- 权限策略和计划任务会话测试

实现：

1. 创建任务时创建并绑定 `kind=scheduled` 的专属会话。
2. 任务消息复用现有消息、流式事件、工具、权限和终态链路。
3. 使用确定性 `requestId`，重启恢复不重复插入用户消息。
4. EventStream 监听 `turn.completed`、`turn.failed`、`permission.requested` 和 `permission.resolved`，更新运行记录。
5. 自动写入关闭时，写操作进入审批。
6. 自动写入开启时，只自动允许工作目录内的明确 Write/Edit；Bash、删除、移动、安装、远端写入和越界操作继续审批。
7. 任务权限不得修改全局 Mode，普通聊天行为保持不变。

## 5. Expo/FCM 推送后端

新增：

- `apps/gateway/src/push/push-service.ts`
- `apps/gateway/src/push/expo-push-client.ts`
- `apps/gateway/src/routes/push-subscriptions.ts`
- Push Service 与路由测试

修改 Gateway 配置和健康状态，支持“禁用、就绪、配置错误”三种 Push 状态。Gateway 使用原生 `fetch` 调用 Expo Push API，保存 Ticket/Receipt 状态；`429` 和 `5xx` 有界重试，永久无效 Token 停用。

日志只记录任务 ID、运行 ID、提供方状态和错误码，不记录 Push Token、提示词或回答。Push 失败不得覆盖任务成功状态。

## 6. Mobile 任务管理与专属会话

新增：

- `apps/mobile/src/app/scheduled.tsx`
- `apps/mobile/src/app/scheduled/new.tsx`
- `apps/mobile/src/app/scheduled/[taskId].tsx`
- `apps/mobile/src/screens/ScheduledTaskListScreen.tsx`
- `apps/mobile/src/screens/ScheduledTaskEditorScreen.tsx`
- `apps/mobile/src/screens/ScheduledTaskDetailScreen.tsx`
- `apps/mobile/src/state/scheduled-task-store.tsx`
- 定时任务页面与状态测试

修改 Gateway Client、根布局和底部导航，加入定时任务入口。页面实现活动/暂停/完成筛选、需要处理、未读状态、立即运行、暂停/恢复、编辑和软删除。

专属会话复用现有聊天渲染与稳定滚动逻辑，但从任务详情和通知进入，不出现在普通会话列表。

## 7. 聊天内创建与通知 Deep Link

修改命令列表和聊天输入处理：

- `/schedule ...` 请求 Gateway 生成草稿。
- 草稿只打开确认页，不直接创建。
- 当前会话项目、工作目录和模型作为可编辑默认值。
- 解析失败时保留原任务文字，并要求用户补全周期。

新增 `expo-notifications`，配置 Android 通知权限、图标和三个通知频道。实现 Push Token 注册/轮换、前台去重、后台点击和冷启动 Deep Link。通知只携带任务、运行和会话 ID，不含敏感正文。

Firebase/Expo 外部凭据通过安全构建配置注入。无凭据时，普通聊天和定时任务执行仍可工作，健康页和 App 明确显示“系统推送未配置”，不得伪装成已启用。

## 8. 全量验证与发布门禁

依次执行：

1. Protocol、Database、Gateway、Mobile 定向测试。
2. Protocol 与 Database build。
3. 全仓 `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`。
4. `git diff --check` 和凭据/敏感文件扫描。
5. Fake Claude 两分钟定时任务端到端测试。
6. 临时 SQLite 验证停机补执行、禁止重叠和崩溃恢复。
7. 真机验证前台、后台、划掉 App、锁屏和冷启动通知。
8. 真实模型执行一个无写入任务，并验证专属会话和通知跳转。

只有以上代码与本地集成验证通过后，才进行服务器数据库在线备份、Gateway 白名单部署、健康检查、Android 版本升级、Release APK 构建和覆盖安装。构建后删除临时源码、Gradle 缓存和共享包 `dist`，保留最终 APK 与必要的服务器回退备份。
