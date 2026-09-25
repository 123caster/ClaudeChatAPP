# Happy 风格流式消息滚动稳定性实施计划

- 设计规格：`docs/superpowers/specs/2026-09-16-happy-style-streaming-scroll-design.md`
- 影响范围：仅 `apps/mobile`
- 不包含：Gateway、协议、数据库、版本号、APK 构建与安装

## 1. 倒置滚动纯函数与回归测试

先修改 `apps/mobile/src/__tests__/chat-scroll.test.ts`，为以下行为增加失败测试：

1. 倒置列表偏移 `0` 代表最新消息，阈值之外代表阅读历史。
2. 用户拖动期间即使回到阈值内，也不恢复自动跟随。
3. 点击“最新消息”只需要定位到偏移 `0`，不依赖内容总高度。
4. 倒置展示窗口保持“最新数据在索引 0”，但领域时间线顺序不变。

随后修改 `apps/mobile/src/state/chat-scroll.ts`，增加倒置偏移判断和窗口转换纯函数，并删除仅服务于定时 `scrollToEnd` 的任务判断函数。

## 2. 将聊天列表改为原生倒置锚点

修改 `apps/mobile/src/screens/BasicChatScreen.tsx`：

1. 将可见消息窗口反转后交给 `FlatList`，启用 `inverted`。
2. 配置 `maintainVisibleContentPosition`，最新消息附近由原生列表保持锚点。
3. 将“加载更早消息”从 `ListHeaderComponent` 移到视觉顶部对应的 `ListFooterComponent`。
4. 将消息末端留白改到倒置容器对应的 `paddingTop`。
5. 进入会话依赖默认偏移 `0`；发送消息和“最新消息”按钮只执行一次 `scrollToOffset({ offset: 0 })`。
6. 用 `contentOffset.y` 判断距最新消息的距离，控制历史阅读状态和“↓ 最新消息”按钮。

## 3. 删除流式尾部重定位链路

从 `BasicChatScreen.tsx` 删除 `STREAM_FOLLOW_INTERVAL_MS`、流式跟随定时器、动画帧滚动队列、滚动任务序号以及 `onContentSizeChange → scrollToEnd`。输入框和键盘高度变化不得主动滚动列表。

保留 `assistant.delta` 的 50ms 合并窗口，流式文本仍实时更新同一条消息。

## 4. 定向与全量验证

依次运行：

1. `pnpm --filter @claude-chat/mobile test -- chat-scroll.test.ts`
2. `pnpm --filter @claude-chat/mobile test`
3. `pnpm --filter @claude-chat/mobile typecheck`
4. `pnpm --filter @claude-chat/mobile lint`
5. Mobile Prettier 检查和 `git diff --check`

最后人工核对源码中不存在流式 `scrollToEnd` 或 `onContentSizeChange` 自动滚动链路。本阶段不构建 APK，待代码验证通过后再由用户决定是否打包安装。
