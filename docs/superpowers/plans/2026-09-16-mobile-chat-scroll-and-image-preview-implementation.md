# 手机聊天滚动稳定与图片预览实施计划

- 设计规格：`docs/superpowers/specs/2026-09-16-mobile-chat-scroll-and-image-preview-design.md`
- 影响范围：仅 `apps/mobile`
- 不包含：Gateway、数据库、协议、Android 版本和 APK 构建

## 1. 滚动回归测试

修改 `apps/mobile/src/__tests__/chat-scroll.test.ts`，增加以下场景：用户仍在拖动时即使靠近底部也保持 `READING_HISTORY`；滚动任务序号变化后旧任务不得执行；用户交互期间强制任务也不得执行；交互结束且真正到达底部后恢复跟随。

## 2. 滚动协调器

修改 `apps/mobile/src/state/chat-scroll.ts` 和 `apps/mobile/src/screens/BasicChatScreen.tsx`：

1. 为状态转换加入用户交互锁。
2. 用递增序号使已排队的定时器和动画帧失效。
3. 拖动开始时取消补位；拖动结束后延迟一个动画帧确认是否进入惯性滚动。
4. 流式高度变化按 120ms 合并，并在执行前重新检查状态。
5. 进入会话、发送消息和点击“最新消息”都在列表内容提交后执行一次显式跳转。

## 3. 图片缩略图与预览

修改 `apps/mobile/src/components/chat/MessageAttachments.tsx`，并新增组件测试：

1. 图片外框固定为 `132 x 98dp`，单图和多图均不随加载状态改变高度。
2. 加载失败在原外框中显示重试入口。
3. 点击成功缩略图打开深色全屏 `Modal`，使用 `contain` 展示。
4. 支持关闭按钮、背景点击和 Android 返回键关闭。

## 4. 验证

运行 Mobile 的定向 Jest、完整 Jest、TypeScript、ESLint、Prettier 检查和 `git diff --check`。检查仅包含本阶段文件，不覆盖工作区原有改动；本阶段不构建或安装 APK。
