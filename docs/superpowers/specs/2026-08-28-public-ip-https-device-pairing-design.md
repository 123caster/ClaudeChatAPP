# ClaudeChatAPP 公网 IP HTTPS 与设备配对设计

## 状态

用户已于 2026-08-28 确认本设计。本文定义第一个安全加固阶段。本阶段不允许发布不完整的手机端或 Gateway：必须先在本地完成实现和验证，再统一交付服务器与 Android App。

## 目标

- 加密手机到 Gateway 的全部 HTTP 和 WebSocket 请求。
- 停止将 Gateway 进程直接暴露在公网。
- 使用每台设备独立的随机令牌，替换当前 6 字符共享 API Key。
- 实现无人值守的证书续期、到期检测和 Nginx 安全重载。
- 迁移期间保留现有项目、模型、会话、消息和手机本地数据。

## 非目标

- 不建设多用户账户、云身份提供商或组织角色系统。
- 本阶段不支持多台设备同时保持配对。
- 本阶段不处理模型厂商 API Key 的落库加密，该事项属于下一个 P0 阶段。
- 不改变聊天、Markdown、工作区、模型和权限流程的业务行为。

## 目标架构

Android App 只连接 `https://gateway.example.com` 和 `wss://gateway.example.com/v1/events`。Nginx 监听 80 和 443 端口：80 端口只提供 ACME HTTP-01 验证，其余请求全部跳转到 HTTPS；443 端口终止 TLS，并将 HTTP 和 WebSocket 请求代理到 `127.0.0.1:43110`。

最终切换后，Gateway 只绑定本机回环地址。Nginx 对流式响应关闭代理缓冲，转发原始客户端地址，并正确设置 WebSocket Upgrade 请求头。只有当新 App 完成配对并通过端到端检查后，才取消公网对 43110 端口的访问。

## 公网 IP 证书

使用 Certbot 5.4 或更高版本，通过 Webroot HTTP-01 流程为 `gateway.example.com` 申请 Let's Encrypt `shortlived` 公网 IP 证书。服务器 Ubuntu 软件源候选版本过旧，因此必须使用官方 Snap 等受支持的新版发行方式。正式申请前必须先通过 Let's Encrypt Staging 环境验证，正式证书只能申请一次。

systemd Timer 每 12 小时执行一次 `certbot renew --quiet`，加入随机延迟并设置 `Persistent=true`。只有续期成功后才运行 Deploy Hook；Hook 先执行 `nginx -t`，仅在配置验证成功时平滑重载 Nginx。

另设独立的每日证书监控任务，检查证书剩余有效期是否至少为 48 小时。检查失败时写入 journald，并通过 Gateway 健康接口返回证书降级状态。监控任务不得替换或删除当前正在使用的证书。

证书验收必须包含：Staging 申请、正式申请、续期 Dry Run、Nginx 重载、服务重启和 Timer 重启补跑能力。

## 设备鉴权

复用现有设备仓库、`DeviceAuthService`、配对码服务和协议 Schema。迁移完成后，使用设备令牌鉴权替换当前全局 API Key Hook。

### 配对流程

1. 运维人员通过服务器命令打开一个 5 分钟配对窗口。
2. 服务器生成 6 位一次性配对码，并且只在该服务器终端显示。
3. App 通过 HTTPS 提交配对码和长度受限的设备名称。
4. 配对码在 5 分钟窗口内最多允许失败 5 次。
5. Gateway 生成 32 字节 Base64URL 设备令牌，数据库只保存其 SHA-256。
6. 明文令牌只通过 HTTPS 返回一次，并使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY` 策略保存到 Android SecureStore。
7. 交换成功后立即消费配对码并关闭配对窗口。

第一阶段保留现有的单活动设备规则。已配对设备可以由运维人员撤销，撤销后才允许重新打开配对窗口。

### 请求鉴权

HTTP 请求使用 `Authorization: Bearer <device-token>`。WebSocket Upgrade 使用同一请求头。只有健康检查和配对交换接口无需鉴权。健康检查不得暴露项目列表、现有公开字段以外的内部版本、敏感信息或证书路径。

Gateway 对令牌计算 SHA-256，并通过设备仓库匹配令牌哈希。日志必须脱敏 Authorization、旧 API Key、配对码、设备令牌和模型厂商 Key。

HTTP 与 WebSocket 共享同一个内存鉴权失败限流器。限流器按标准化客户端地址统计，5 分钟内最多允许 5 次错误凭据，封禁期间返回 HTTP 429；一次成功鉴权会清除该地址的失败状态。Nginx 同时提供较宽松的外层请求速率限制，但不得中断已经建立的 WebSocket 和流式连接。

## 协议与手机端修改

Protocol Schema 新增或恢复以下结构：配对状态、配对交换请求与响应、已认证设备、证书健康状态以及结构化 401/429 错误。移动端 API 使用共享 Schema，不再将长期凭据命名为 `apiKey`，统一改为 `deviceToken`。

连接页面只接收 6 位配对码，不再要求用户输入永久密钥。旧凭据仅在迁移兼容窗口内可读，成功配对后必须立即从 SecureStore 删除。生产 Gateway 地址切换为 HTTPS，并关闭 Android 明文网络流量。

连接、重连、会话刷新、WebSocket 续传、模型操作、工作区操作、文件预览和权限回复全部使用设备令牌。收到 401 时，App 进入未配对状态，但不得删除本地聊天缓存；收到 429 时显示有边界的重试提示，不得进入紧密重试循环。

## 迁移与切换

发布过程使用明确的兼容窗口，防止手机被锁在 Gateway 外：

1. 备份 Gateway 代码，并生成一致性的 SQLite 备份。
2. 安装并验证 Certbot、证书、Nginx HTTPS、自动续期和证书监控。
3. 暂时保留现有 HTTP 入口和旧 Key。
4. 部署同时支持旧鉴权与设备配对的 Gateway 代码。
5. 构建支持 HTTPS、配对和设备令牌的 Android `1.1.1`。
6. 不清除 App 数据，覆盖安装新版本并完成一次性配对。
7. 使用设备令牌验证健康检查、HTTP、WebSocket、流式输出、模型、工作区、文件、命令和权限流程。
8. 删除 6 字符旧 Key、关闭旧鉴权、将 Gateway 改为仅监听回环地址，并取消公网 43110 端口访问。
9. 重启 Nginx 和 Gateway，再次执行全部端到端检查。

第 7 步成功之前不得执行破坏性切换。最终切换前失败时，旧连接必须继续可用；最终切换后失败时，从本阶段备份恢复上一版 Nginx 和 Gateway 配置，同时不得修改数据库。

## 数据与部署安全

Gateway 必须使用源码白名单部署。归档必须排除 `apps/gateway/data`、配置文件、`.env`、证书、私钥、SQLite 数据库、WAL/SHM、日志和 Android 产物。服务器配置备份保存在仓库外，只有阶段验收完成后才能删除。

部署前后使用全部业务表逻辑摘要验证数据库一致性。不得使用 SQLite 物理文件哈希作为数据一致性依据，因为 WAL Checkpoint 可能在逻辑数据不变时改变主数据库文件。

证书私钥只能保存在 `/etc/letsencrypt`，并保持 Root Only 权限。私钥不得复制进仓库、部署归档、App、日志或聊天消息。

## 测试

自动化测试覆盖：

- 配对码过期、消费、失败限流和单设备约束。
- 设备令牌的 HTTP 与 WebSocket 鉴权。
- HTTP/WebSocket 共享失败限流，以及成功鉴权后的计数清除。
- 只在迁移配置启用时支持旧鉴权。
- SecureStore 凭据迁移和旧凭据删除。
- 401、429、重连、WebSocket 续传和本地聊天缓存保留。
- 证书健康协议解析和健康降级状态显示。
- 现有流式输出、滚动、Markdown、命令、模型、工作区、文件与权限功能。

本地质量门禁包括：`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm typecheck`、Gateway 生产构建、Android Release 构建、APK 元数据与签名验证，以及 `git diff --check`。

## 阶段完成条件

只有同时满足以下条件，第一大阶段才算完成：手机 HTTPS 和 WSS 连接正常；公网无法访问 43110；6 字符旧 Key 被拒绝；数据库不存在设备令牌明文；证书自动化能够跨服务重启恢复；全部质量门禁通过；Android `1.1.1` 已安装并保持连接；优化清单已填写完成日期和验证证据。
