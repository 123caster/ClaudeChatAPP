# ClaudeChatAPP 多附件、语音输入与舒适界面实施计划

- 设计规格：`docs/superpowers/specs/2026-09-14-claudechat-multimodal-attachments-voice-and-comfort-ui-design.md`
- 目标版本：Android `1.2.0`，`versionCode 19`
- 计划日期：2026-09-14
- 实施原则：测试先行、数据库只增量迁移、服务器数据不随代码部署、保留当前工作区已有改动

## 1. 完成定义

完成必须同时满足：多图片与多文件可上传并被模型实际读取；语音可实时转成可编辑文字；会话列表和聊天页达到已确认的视觉方向 A；键盘、附件托盘和流式回答不遮挡或抢夺滚动；Gateway 安全部署；Android Release APK 安装到真机并完成端到端验收。

## 2. 阶段一：基线与依赖

### 文件

- `apps/mobile/package.json`
- `apps/gateway/package.json`
- `pnpm-lock.yaml`
- `apps/mobile/app.json`

### 步骤

1. 记录当前 `git status`、版本、测试数量和服务器业务数据逻辑摘要，保留现有改动。
2. 运行 Protocol、Database、Gateway、Mobile 的现有测试、类型检查和 lint，区分基线失败与本阶段回归。
3. Mobile 使用 Expo 兼容版本加入 `expo-image-picker`、`expo-document-picker`、`expo-image-manipulator`；沿用已有 `expo-speech-recognition`。
4. Gateway 加入 multipart、真实文件类型识别、图片缩略图和 Office 结构化提取依赖；锁定版本并检查生产安装。
5. 将 App 版本更新为 `1.2.0 / 19`，原生版本由现有 Release 脚本动态同步。

### 验证

`pnpm install`、四个 workspace 的 `typecheck`，以及 `expo config --type public`。

## 3. 阶段二：协议与数据库

### 文件

- `packages/protocol/src/models.ts`
- `packages/protocol/src/http.ts`
- `packages/protocol/src/errors.ts`
- `packages/protocol/src/__tests__/protocol.test.ts`
- `packages/protocol/src/__tests__/sessions.test.ts`
- `packages/database/src/migrations/010-attachments-and-model-capabilities.ts`
- `packages/database/src/repositories/attachment-repository.ts`
- `packages/database/src/repositories/message-repository.ts`
- `packages/database/src/repositories/model-repository.ts`
- `packages/database/src/client.ts`
- `packages/database/src/migrate.ts`
- `packages/database/src/__tests__/attachments.test.ts`

### 测试先行

1. 写失败测试：文字和附件不能同时为空；最多 9 个 ID；附件摘要严格解析；模型能力与默认多模态标记可往返。
2. 写迁移测试：旧数据库升级后原模型、会话和消息数量不变；附件表、索引和新模型列存在。
3. 写仓储测试：创建、上传完成、消息事务绑定、跨设备拒绝、过期查询、会话删除级联和默认多模态唯一性。

### 实现

新增附件 DTO、消息附件数组、上传/预览/删除响应和模型能力字段。数据库新增附件表及必要索引；模型表只增列。消息查询批量装配附件，避免逐消息查询。

## 4. 阶段三：Gateway 附件上传与生命周期

### 文件

- `apps/gateway/src/attachments/attachment-policy.ts`
- `apps/gateway/src/attachments/attachment-service.ts`
- `apps/gateway/src/attachments/attachment-storage.ts`
- `apps/gateway/src/attachments/attachment-content-service.ts`
- `apps/gateway/src/routes/attachments.ts`
- `apps/gateway/src/app.ts`
- `apps/gateway/src/config.ts`
- `apps/gateway/src/logging/gateway-logs.ts`
- `apps/gateway/src/__tests__/attachment-route.test.ts`
- `apps/gateway/src/__tests__/attachment-cleanup.test.ts`

### 测试先行

覆盖未认证请求、超限、伪造 MIME、双扩展名、路径字符、可执行文件、压缩包、Office 解包膨胀、重复 requestId、跨设备预览/删除、失败清理和 24 小时过期清理。

### 实现

1. `POST /v1/attachments` 每次接收一个 multipart 文件，以服务端计数限制字节数。
2. 原件和预览使用 UUID 文件名，目录权限最小化；图片生成 320 px 无 EXIF 缩略图。
3. `POST /v1/attachments/:id/delete` 只允许删除未绑定附件；`GET /v1/attachments/:id/preview` 校验设备和会话归属。
4. 清理任务在 Gateway 启动和固定间隔运行，删除过期原件、孤立预览及对应记录；单项失败不终止后续清理。
5. 日志仅保留 ID、类型、大小、耗时和错误码。

## 5. 阶段四：Claude 内容与多模态路由

### 文件

- `apps/gateway/src/claude/claude-adapter.ts`
- `apps/gateway/src/claude/agent-sdk-adapter.ts`
- `apps/gateway/src/claude/multimodal-router.ts`
- `apps/gateway/src/models/model-service.ts`
- `apps/gateway/src/sessions/session-service.ts`
- `apps/gateway/src/sessions/serializers.ts`
- `apps/gateway/src/routes/models.ts`
- `apps/gateway/src/__tests__/agent-sdk-adapter.test.ts`
- `apps/gateway/src/__tests__/multimodal-router.test.ts`
- `apps/gateway/src/__tests__/session-events.test.ts`

### 测试先行

1. 图片生成合法 `image` 内容块，PDF 生成 `document` 内容块，文本和 Office 转换为有名称边界的文档文本块。
2. 支持图片的会话模型直接处理；不支持时调用唯一默认多模态模型，并把结构化识别结果传给原会话模型。
3. 默认模型缺失、调用失败、附件过期或解析失败时，用户消息不被静默降级，并返回可恢复错误。
4. 成功、失败、取消和权限等待期间验证原件释放时点，避免 Claude 尚未读取就提前删除。

### 实现

将 Adapter 提示扩展为 `string | AsyncIterable<SDKUserMessage>`，保持纯文本路径不变。模型管理新增“支持图片”“支持文档”“设为默认多模态”控制；默认多模态模型删除前必须先取消或替换。原件在 Adapter 完全结束后释放，缩略图和元数据随消息保留。

## 6. 阶段五：移动端附件与语音

### 文件

- `apps/mobile/src/api/gateway-client.ts`
- `apps/mobile/src/state/attachment-upload-queue.ts`
- `apps/mobile/src/storage/composer-draft.ts`
- `apps/mobile/src/components/chat/AttachmentPicker.tsx`
- `apps/mobile/src/components/chat/AttachmentTray.tsx`
- `apps/mobile/src/components/chat/MessageAttachments.tsx`
- `apps/mobile/src/components/chat/VoiceComposer.tsx`
- `apps/mobile/src/components/chat/ChatComposer.tsx`
- `apps/mobile/src/screens/BasicChatScreen.tsx`
- `apps/mobile/src/screens/ModelScreen.tsx`
- `apps/mobile/src/__tests__/attachment-upload.test.tsx`
- `apps/mobile/src/__tests__/voice-composer.test.tsx`
- `apps/mobile/src/__tests__/gateway-client.test.ts`

### 测试先行

覆盖多选合并、重复项、9 项/10 MB/20 MB/40 MB 边界、逐项进度、取消、失败重试、离线恢复、成功发送后清空、失败发送后保留，以及麦克风权限、识别不可用、部分转写、最终转写、取消和确认。

### 实现

1. `+` 菜单提供相册与文件；相册允许多选，文件选择器允许多选。
2. 上传队列以一项一个请求工作，限制并发，支持 Abort 和幂等 requestId；本地草稿只保存可恢复元数据，不复制原文件。
3. 输入区显示横向附件托盘；历史用户消息显示图片缩略图和文件行。
4. 语音使用 `zh-CN`、连续部分结果和系统可用性检查，只在用户确认后合入当前文字。

## 7. 阶段六：视觉方向 A 与滚动稳定性

### 文件

- `apps/mobile/src/theme/colors.ts`
- `apps/mobile/src/theme/spacing.ts`
- `apps/mobile/src/components/SessionRow.tsx`
- `apps/mobile/src/screens/SessionListScreen.tsx`
- `apps/mobile/src/screens/BasicChatScreen.tsx`
- `apps/mobile/src/state/chat-scroll.ts`
- `apps/mobile/src/__tests__/session-list.test.ts`
- `apps/mobile/src/__tests__/chat-scroll.test.ts`

### 实现与验证

采用暖白背景、白色内容面、深灰正文和克制青绿色主操作；AI 消息近乎全宽，用户消息右侧浅色气泡。会话列表按日期分组，底部为悬浮新任务入口。所有图标使用现有图标库或平台符号并提供无障碍名称。

输入区通过实测高度更新列表底部 inset，Android 保持 `adjustResize`。附件、听写、键盘和流式消息引起的尺寸变化不得覆盖 `READING_HISTORY`。测试覆盖输入区从 1 行到 6 行、附件托盘出现/消失、键盘开关、历史阅读和“最新消息”跳转。

## 8. 阶段七：集成、部署与交付

### 本地质量门

```powershell
pnpm --filter @claude-chat/protocol build
pnpm --filter @claude-chat/database build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
git diff --check
```

### Gateway 部署

1. 生成不含 `.env`、配置、数据库、附件、日志、证书、密钥、`node_modules` 和 `dist` 的白名单源码包。
2. 部署前后比较业务表逻辑摘要；只允许新增迁移结构，不允许现有业务行丢失或变化。
3. 服务器安装锁定依赖、构建、迁移并重启服务；验证本地 Gateway、Nginx、公网 HTTPS、WebSocket 和附件 24 小时清理配置。
4. 使用临时、无敏感内容的附件执行真实图片和文档冒烟，结束后验证原件已删除。

### Android 交付

1. 使用现有 `scripts/build-android-release.ps1` 构建 `ClaudeChatAPP-1.2.0.apk`。
2. 校验包名、`versionName=1.2.0`、`versionCode=19`、V2 签名、SHA-256 和 Bundle 关键文案。
3. 通过指定 ADB 覆盖安装；用 `dumpsys package` 核对手机实际版本。
4. 真机完成设计规格第 6 节全部场景，重点录入多图、多文件、默认多模态回退、语音、弱网和键盘滚动证据。
5. 删除临时源码副本、临时 Gradle 缓存、共享包 `dist`、同步归档和服务器临时备份，只保留最终 APK；不删除用户数据库、附件预览或项目文件。

## 9. 回退策略

移动端安装前保留上一版 APK。Gateway 部署前备份当前代码和一致性数据库快照；新迁移只增表/增列。若运行失败，恢复旧 Gateway 代码并保留新列，数据库无需降级。附件功能通过协议可选字段保持旧客户端兼容，旧 App 仍可发送纯文本。
