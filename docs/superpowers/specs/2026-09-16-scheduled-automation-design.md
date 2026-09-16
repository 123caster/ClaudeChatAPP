# ClaudeChatAPP 通用定时任务设计

## 1. 目标

为 ClaudeChatAPP 增加一套由服务器 Gateway 驱动的通用定时任务系统。用户可以保存任意自然语言指令，按一次性、每天、工作日、每周或每月规则自动执行；即使 App 已退出或手机锁屏，任务仍可运行并通过 Android 系统通知提醒用户。

GitHub 榜单、项目依赖检查和日报生成都只是任务示例，不在代码中固化任何特定业务行为。

本设计参考 Codex Scheduled Tasks 的任务收件箱、活动/暂停状态、立即运行、近期运行记录、会话内持续任务和最小权限原则，但执行环境使用本项目自己的 Gateway、SQLite、Claude Agent SDK 和 Android App。

参考资料：

- [OpenAI Scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [OpenAI Notifications](https://learn.chatgpt.com/docs/notifications)
- [Expo push notifications setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- [Expo notification handling](https://docs.expo.dev/push-notifications/receiving-notifications/)

## 2. 已确认的产品决策

- 每个定时任务拥有一个独立的长期会话，每次运行的指令和结果持续追加到该会话。
- 第一版支持一次性、每天、工作日、每周、每月，可选择时间和 IANA 时区；不向用户暴露 Cron 或 RRULE 编辑器。
- Gateway 停机后只补执行最近遗漏的一次，不追赶全部历史周期。
- 同一任务禁止并发。到期时若上次仍在运行或等待权限，本次记录为已跳过。
- 每个任务提供“允许自动写入”开关，默认关闭。
- 开启自动写入后，仅允许在选定工作目录内创建和编辑文件；删除、批量移动、Bash、安装依赖、远端推送和越界操作仍需手机确认。
- 支持“定时任务”管理页面和聊天内 `/schedule` 双入口；自然语言解析只生成草稿，必须由用户确认。
- App 退出或手机锁屏时仍应接收 Android 系统通知；SQLite 中的任务与运行记录是最终事实来源，推送只负责提醒。
- 第一版只实现时间触发，不实现 Gmail、Slack、GitHub PR 等事件触发。

## 3. 总体架构

### 3.1 Gateway 模块

- `ScheduleService`：校验任务配置、计算重复规则和下一次执行时间。
- `TaskScheduler`：领取到期任务、创建运行记录、处理补执行与禁止并发。
- `ScheduledRunService`：把任务提示词送入专属会话，并将会话终态映射到运行状态。
- `ScheduledPermissionPolicy`：为每次定时运行计算独立权限，不修改当前全局模式。
- `PushService`：发送 Expo/FCM 通知、查询回执、处理无效令牌和有限重试。

Gateway 作为常驻 systemd 服务运行。调度器位于 Gateway 进程内，不为每个任务动态创建 systemd Timer；systemd 只负责 Gateway 自身的启动、重启和存活。

### 3.2 App 模块

- 定时任务列表与“需要处理”收件箱。
- 任务创建、编辑和确认页面。
- 任务详情、运行历史和专属会话入口。
- `/schedule` 草稿创建入口。
- 推送权限、令牌注册、通知点击与 Deep Link 路由。

### 3.3 共享协议与数据库

`packages/protocol` 定义任务、运行、推送订阅、HTTP 请求和事件 Schema；`packages/database` 增加迁移和 Repository。所有写接口继续使用 `requestId` 做幂等控制。

## 4. 数据模型

### 4.1 `scheduled_tasks`

| 字段 | 说明 |
| --- | --- |
| `id` | 任务 ID |
| `name` | 用户可读名称 |
| `prompt` | 每次执行的持久指令 |
| `status` | `active`、`paused`、`completed`、`deleted` |
| `trigger_type` | 第一版固定为 `time`，为事件触发预留 |
| `schedule_json` | 结构化周期配置 |
| `timezone` | IANA 时区，默认 `Asia/Shanghai` |
| `next_run_at` | 下一次 UTC 执行时间；无下次运行时为空 |
| `last_run_at` | 最近一次实际运行时间 |
| `session_id` | 专属长期会话 ID |
| `project_id` | 项目 ID |
| `working_directory` | 项目内相对工作目录 |
| `model_id` | 指定模型；为空时每次运行使用 Gateway 当前默认模型，确认页必须明确显示“默认模型” |
| `allow_auto_write` | 是否允许受限的自动创建和编辑 |
| `notification_policy` | 第一版固定发送成功、失败和需处理通知，跳过不通知 |
| `created_at` / `updated_at` / `deleted_at` | 生命周期时间 |

`schedule_json` 只允许以下结构：

- `once`：本地日期与时间。
- `daily`：每天的时、分。
- `weekdays`：周一至周五的时、分。
- `weekly`：星期、时、分。
- `monthly`：每月日期、时、分；不存在该日期的月份跳过，不自动改到月末。

Gateway 可以在内部将结构化规则编译成 RRULE，但协议和 App 不接受用户提交原始 RRULE。

### 4.2 `scheduled_runs`

| 字段 | 说明 |
| --- | --- |
| `id` | 运行 ID |
| `task_id` | 所属任务 |
| `scheduled_for` | 本次原计划 UTC 时间 |
| `trigger_source` | `scheduled`、`manual`、`recovery` |
| `status` | `queued`、`running`、`waiting_permission`、`succeeded`、`failed`、`skipped`、`cancelled` |
| `request_id` | 发送会话消息时使用的确定性请求 ID |
| `user_message_id` / `assistant_message_id` | 对应消息 |
| `attempt_count` | 同一次运行的临时故障尝试次数 |
| `started_at` / `completed_at` | 实际运行时间 |
| `error_code` / `error_message` | 可阅读失败信息 |
| `lease_owner` / `lease_expires_at` | 防止重复领取的租约 |
| `notification_status` | 推送状态，不影响任务执行结果 |

数据库对 `(task_id, scheduled_for)` 建立唯一约束，确保正常调度和恢复调度不能为同一计划时间创建两条运行。手动运行使用独立的即时计划时间；调度与恢复使用规则计算出的计划时间。

### 4.3 `push_subscriptions`

保存配对设备、推送提供方、Push Token、平台、启用状态和更新时间。Push Token 变化时覆盖旧值；Expo 回执报告永久无效后停用该订阅，App 下次启动时重新注册。

## 5. 调度语义

### 5.1 正常执行

1. 调度器使用可注入时钟周期性检查 `next_run_at <= now` 的活动任务。
2. 在 SQLite `BEGIN IMMEDIATE` 事务中创建运行记录、写入租约并推进 `next_run_at`。
3. 确认专属会话不存在活动回合后，以确定性 `requestId` 调用内部会话执行入口。
4. 消息、流式事件、工具调用和权限请求继续走现有持久化链路。
5. `turn.completed`、`turn.failed` 或权限事件同步更新 `scheduled_runs`。

### 5.2 停机恢复

Gateway 启动时重新计算所有活动任务：

- 若仅错过一次，创建一条 `recovery` 运行。
- 若错过多次，只选择最近一次计划时间创建 `recovery` 运行。
- 未来的 `next_run_at` 直接推进到下一次正常周期。
- 已存在唯一运行记录时不重复创建。
- 重启前处于 `running` 或 `waiting_permission` 的运行，先与现有会话恢复状态对账，不重新追加同一条用户消息。

### 5.3 禁止重叠

任务到期时若存在 `queued`、`running` 或 `waiting_permission` 运行，则为本周期创建 `skipped` 记录并推进下次时间。不会排队补跑，也不会启动第二个实例。跳过仅进入任务历史，默认不发送系统通知。

### 5.4 立即运行

活动、暂停和已完成但未删除的任务均可“立即运行”。立即运行不改变原周期；若任务已有活动运行，则返回 `409 TASK_ALREADY_RUNNING`。一次性任务完成后保持 `completed`，手动运行不会重新激活其时间计划。

## 6. 会话与上下文

创建任务时同时创建一个 `kind=scheduled` 的专属会话。该会话继承用户确认的项目、工作目录和模型，但不显示在普通会话列表，主要从任务详情和通知进入。

每次运行在会话中追加：

- 一条带运行元数据的任务消息。
- 模型流式回答、工具调用和权限记录。
- 日期、计划时间、触发来源和终态分隔信息。

任务专属会话沿用既有 Claude 会话上下文，因此后续运行可以理解之前结果。任务提示词必须具备持久性，明确每次运行要做什么、何时无须报告、何时请求用户输入。

删除任务采用软删除：停止未来运行，并将专属会话归档，保留可阅读历史。第一版不提供同时物理清除任务、运行和消息的操作。

## 7. 权限设计

定时任务运行不修改 `ModeService` 的全局设置，而是向每个回合注入任务级权限策略。

### 7.1 自动写入关闭

- 文件读取、目录查看、代码搜索和普通网络查询可自动执行。
- 所有创建、编辑、删除、移动、Shell 命令和外部副作用均进入手机审批。

### 7.2 自动写入开启

- 只自动允许明确的 `Write`、`Edit` 类操作。
- 目标必须经过真实路径解析，且位于任务的项目根目录和选定工作目录内。
- 删除、批量移动、Bash、安装依赖、服务控制、Git 远端写入和越界路径始终请求审批。
- 符号链接、`..`、大小写变体和平台路径分隔符必须经过现有路径策略校验，不能绕过目录边界。

权限请求使运行进入 `waiting_permission`，并发送高优先级通知。用户允许后继续同一回合；拒绝、超时或取消后记录明确终态，不把下一周期永久停用。

## 8. App 交互

### 8.1 定时任务首页

新增“定时任务”入口，包含：

- `需要处理`：等待权限、等待回答和连续失败。
- `进行中`：活动任务及下次执行时间。
- `已暂停`：暂停任务。
- `已完成`：一次性任务和软删除前可阅读记录。

任务卡显示名称、周期、下次运行、最近状态和未读标记。支持搜索、立即运行、暂停/恢复、编辑和删除。

### 8.2 表单创建

创建页字段顺序为：任务名称、指令、周期、时间与时区、项目、工作目录、模型、自动写入开关、通知说明。提交前展示完整摘要；自动写入开关旁明确说明删除和 Bash 仍需审批。

### 8.3 聊天内创建

用户输入 `/schedule ...` 或从常用命令选择“创建定时任务”。Gateway 使用确定性规则解析支持的中文时间表达：一次性日期时间、每天、工作日、每周某日和每月某日。

解析结果只生成草稿并打开确认页，不直接保存任务。解析不完整或存在歧义时，保留原始任务文字并要求用户在表单中选择时间。项目、工作目录和模型默认继承当前会话，但均可修改。

### 8.4 运行详情

详情展示计划时间、实际开始时间、耗时、触发来源、模型、文件变更、权限记录和错误。支持重新执行、进入专属会话和标记已读。

## 9. 系统通知

第一版使用 `expo-notifications + Expo Push Service + FCM V1`：

1. App 在用户首次启用定时任务时申请通知权限。
2. App 获取 Expo Push Token 并绑定到当前配对设备。
3. Gateway 将通知提交给 Expo Push Service，并查询 Push Ticket/Receipt。
4. 通知点击数据携带 `taskId`、`runId`、`sessionId` 和事件类型。
5. App 在前台、后台和冷启动时均解析通知响应并跳转到对应运行。

Android 建立三个通知频道：

- `task-results`：任务完成，普通优先级。
- `task-attention`：权限或回答请求，高优先级。
- `task-failures`：任务失败，普通优先级。

锁屏通知默认只显示通用文案，不携带完整回答、文件名、提示词或项目路径。App 前台时使用应用内状态更新，避免同一事件重复弹窗。

推送失败不会改变已成功的任务状态。SQLite 运行记录和现有事件回放负责离线兜底；Android 厂商省电策略可能影响系统通知送达，不能把 Push 当作唯一数据通道。

外部配置要求：Expo 项目 ID、Firebase Android 应用、FCM V1 凭据、`google-services.json` 和推送服务访问配置。凭据由安全环境或构建脚本注入，不提交到 Git。

## 10. HTTP 与事件协议

### 10.1 HTTP

- `GET /v1/scheduled-tasks`
- `POST /v1/scheduled-tasks`
- `GET /v1/scheduled-tasks/:taskId`
- `PATCH /v1/scheduled-tasks/:taskId`
- `DELETE /v1/scheduled-tasks/:taskId`
- `POST /v1/scheduled-tasks/:taskId/run`
- `GET /v1/scheduled-tasks/:taskId/runs`
- `POST /v1/scheduled-tasks/draft`
- `PUT /v1/devices/push-subscription`
- `DELETE /v1/devices/push-subscription`

### 10.2 事件

- `scheduled-task.created`
- `scheduled-task.updated`
- `scheduled-task.deleted`
- `scheduled-run.created`
- `scheduled-run.updated`
- `scheduled-run.needs-attention`

事件写入现有 `events` 表并通过 WebSocket 推送。App 按 `eventId` 去重；通知与 WebSocket 同时到达时，以 `runId + status` 合并，不创建重复未读项。

## 11. 错误处理与重试

- 网络中断、模型 `429` 或供应商 `5xx`：同一次运行最多重试两次，间隔 1 分钟和 5 分钟。
- 参数无效、项目不存在、模型已删除、路径无效：立即失败，不自动循环。
- 权限拒绝或超时：本次运行失败或取消，下一周期仍可运行。
- 推送 `429` 或 `5xx`：有限重试；永久无效 Token 停用。
- 连续三次周期运行失败：任务保持活动，但进入“需要处理”，不擅自暂停。
- 删除被任务引用的项目或模型前，接口返回受影响任务；用户必须先改绑或确认暂停。

所有用户可见错误使用稳定错误码和中文消息。日志记录任务 ID、运行 ID、状态、耗时和安全错误码，不记录完整提示词、模型回答、Push Token、API Key 或文件正文。

## 12. 测试与验收

### 12.1 自动化测试

- Protocol：任务、运行、周期、推送订阅和事件 Schema。
- Database：迁移、Repository、唯一约束、软删除和事务领取。
- Scheduler：一次性、每天、工作日、每周、每月、月底、跨年、时区和夏令时。
- Recovery：最近一次补执行、崩溃恢复、过期租约、幂等请求和禁止重叠。
- Permissions：自动写入开关、工作目录边界、符号链接、删除和 Bash 审批。
- Sessions：专属会话持续追加、权限恢复、成功与失败终态。
- Push：发送成功、超时、`429`、无效令牌、令牌轮换和回执处理。
- Mobile：双入口创建、确认页、任务筛选、运行详情、未读合并和 Deep Link。

### 12.2 集成与真机验收

1. 使用 Fake Claude 创建两分钟后执行的一次性任务。
2. 验证 Gateway 到点执行、消息进入专属会话且不会重复。
3. 验证立即运行、暂停、恢复、编辑和软删除。
4. 验证自动写入关闭时请求审批；开启时只自动创建或编辑工作目录内文件。
5. 验证删除和 Bash 始终请求审批。
6. 验证 Gateway 停机后只补最近一次，运行中到期时记录跳过。
7. 在 App 前台、后台、被划掉、手机锁屏和手机重启后验证通知。
8. 点击通知必须打开正确任务和运行位置。
9. 推送不可用时，重新打开 App 仍能看到未读结果。
10. 最后使用真实模型运行一个无写入的周期任务，确认完整链路。

## 13. 发布与迁移

- 部署前生成 SQLite 在线一致性备份并记录逻辑摘要。
- 先部署向后兼容的数据库、Protocol 和 Gateway，再发布包含定时任务 UI 与推送配置的新 APK。
- Gateway 在 App 尚未升级时仍保持现有会话、消息和事件接口可用。
- 新 APK 首次启动完成推送令牌注册；推送配置失败不得阻止普通聊天使用。
- 服务端部署后验证健康检查、调度器启动、数据库迁移、日志脱敏和 systemd 自动重启。
- Android 构建结束继续删除临时源码、Gradle 缓存和共享包 `dist`，只保留最终 APK。

## 14. 第一版不包含

- Gmail、Slack、GitHub PR 或 Webhook 事件触发。
- 用户编辑原始 Cron/RRULE。
- 多设备推送与团队共享任务。
- 邮件、短信或第三方聊天软件通知。
- 多任务依赖、任务链和并行工作流。
- 自动删除、自动 Bash、自动安装依赖或自动远端推送。
- 物理清除任务专属会话和历史运行记录。

这些能力只能在后续独立设计确认后加入，不能通过第一版的通用字段隐式开放。
