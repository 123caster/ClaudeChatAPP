import type {
  EventEnvelope,
  PermissionDecision,
  PermissionRequest,
  SkillSummary,
  ToolCall,
} from '@claude-chat/protocol';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  connectionErrorMessage,
  GatewayClient,
  GatewayRequestError,
  createRequestId,
} from '@/api/gateway-client';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { MessageAttachments } from '@/components/chat/MessageAttachments';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { MarkdownMessage } from '@/components/MarkdownMessage';
import { BUILTIN_COMMANDS } from '@/constants/commands';
import { useConnection } from '@/state/connection-store';
import { useAttachmentUploadQueue } from '@/state/use-attachment-upload-queue';
import { useModels } from '@/state/model-store';
import { useMode } from '@/state/mode-store';
import {
  buildTimeline,
  chatReducer,
  initialChatState,
  type TimelineItem,
} from '@/state/chat-state';
import {
  INVERTED_LATEST_OFFSET,
  INVERTED_MAINTAIN_VISIBLE_CONTENT_POSITION,
  invertTimelineWindow,
  isNearInvertedTimelineLatest,
  keyboardAvoidanceInset,
  nextScrollModeOnPosition,
  stableKeyboardInset,
  shouldFollowTimeline,
  type TimelineScrollMode,
} from '@/state/chat-scroll';
import { useSessions } from '@/state/session-store';
import { connectionBannerState } from '@/state/session-list';
import { loadCachedSession, saveCachedSession } from '@/storage/chat-cache';
import { clearComposerDraft, loadComposerDraft, saveComposerDraft } from '@/storage/composer-draft';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

const INITIAL_TIMELINE_WINDOW = 50;
const LOAD_EARLIER_BATCH = 50;
const MESSAGE_END_GUTTER = spacing.xl;
const STREAM_UPDATE_INTERVAL_MS = 50;

export function BasicChatScreen({ sessionId }: { sessionId: string }) {
  const connection = useConnection();
  const sessions = useSessions();
  const models = useModels();
  const mode = useMode();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [infoDialog, setInfoDialog] = useState<{ title: string; body: string } | null>(null);
  const [selectedSkillCommand, setSelectedSkillCommand] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [streamingEnabled, setStreamingEnabled] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [visibleStart, setVisibleStart] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [composerHydrated, setComposerHydrated] = useState(false);
  const loadedRef = useRef(false);
  const pendingEventsRef = useRef<EventEnvelope[]>([]);
  const pendingDeltasRef = useRef<EventEnvelope[]>([]);
  const deltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<TimelineItem>>(null);
  const interactionReleaseFrameRef = useRef<number | null>(null);
  const userInteractingRef = useRef(false);
  const latestAtBottomRef = useRef(true);
  const scrollModeRef = useRef<TimelineScrollMode>('FOLLOWING');
  const previousTimelineLengthRef = useRef(0);
  const streamingEnabledRef = useRef(true);
  const client = useMemo(
    () => (connection.gatewayUrl ? new GatewayClient(connection.gatewayUrl) : null),
    [connection.gatewayUrl],
  );
  const attachmentQueue = useAttachmentUploadQueue({
    apiKey: connection.deviceToken,
    client,
    sessionId,
    onError: setError,
  });

  useEffect(() => {
    let cancelled = false;
    setComposerHydrated(false);
    void loadComposerDraft(sessionId).then((stored) => {
      if (cancelled) return;
      if (stored) {
        setDraft(stored.text);
        attachmentQueue.add(stored.attachments);
      }
      setComposerHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attachmentQueue.add, sessionId]);

  useEffect(() => {
    if (!composerHydrated) return;
    const timer = setTimeout(() => {
      void saveComposerDraft(sessionId, {
        text: draft,
        attachments: attachmentQueue.items.map(({ localId, uri, name, mimeType, size, kind }) => ({
          localId,
          uri,
          name,
          mimeType,
          size,
          kind,
        })),
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [attachmentQueue.items, composerHydrated, draft, sessionId]);

  const flushPendingDeltas = useCallback(() => {
    deltaFlushTimerRef.current = null;
    const deltas = pendingDeltasRef.current;
    pendingDeltasRef.current = [];
    deltas.forEach((event) => dispatch({ type: 'event', event }));
  }, []);

  const enqueueDelta = useCallback(
    (event: EventEnvelope) => {
      pendingDeltasRef.current.push(event);
      if (deltaFlushTimerRef.current) return;
      deltaFlushTimerRef.current = setTimeout(flushPendingDeltas, STREAM_UPDATE_INTERVAL_MS);
    },
    [flushPendingDeltas],
  );

  useEffect(() => {
    if (!client || !connection.deviceToken) return;
    void client
      .skills(connection.deviceToken)
      .then(setSkills)
      .catch(() => setSkills([]));
  }, [client, connection.deviceToken]);

  const insertCommand = (text: string) => {
    setDraft((current) =>
      current.trimStart().startsWith('/')
        ? `${text} `
        : current.trim()
          ? `${current.trimEnd()} ${text}`
          : text,
    );
    setShowCommands(false);
  };

  useEffect(() => {
    streamingEnabledRef.current = streamingEnabled;
    if (streamingEnabled) return;
    pendingDeltasRef.current = [];
    if (deltaFlushTimerRef.current) clearTimeout(deltaFlushTimerRef.current);
    deltaFlushTimerRef.current = null;
  }, [streamingEnabled]);

  useEffect(() => {
    if (interactionReleaseFrameRef.current !== null) {
      cancelAnimationFrame(interactionReleaseFrameRef.current);
    }
    interactionReleaseFrameRef.current = null;
    userInteractingRef.current = false;
    latestAtBottomRef.current = true;
    scrollModeRef.current = 'FOLLOWING';
    setShowScrollToBottom(false);
    setVisibleStart(0);
    loadedRef.current = false;
    pendingEventsRef.current = [];
    pendingDeltasRef.current = [];
    previousTimelineLengthRef.current = 0;
    if (deltaFlushTimerRef.current) clearTimeout(deltaFlushTimerRef.current);
    deltaFlushTimerRef.current = null;
    const unsubscribe = sessions.subscribe((event) => {
      if (event.sessionId !== sessionId && event.type !== 'server.notice') return;
      if (event.type === 'turn.failed') {
        setError(
          `处理失败：${connectionErrorMessage(
            new GatewayRequestError(event.payload.code, event.payload.message, null),
          )}`,
        );
      }
      if (!loadedRef.current) pendingEventsRef.current.push(event);
      else if (event.type === 'assistant.delta') {
        if (streamingEnabledRef.current) enqueueDelta(event);
      } else dispatch({ type: 'event', event });
    });
    void loadCachedSession(sessionId).then((cached) => {
      if (cached && !loadedRef.current) {
        setVisibleStart(Math.max(0, buildTimeline(cached).length - INITIAL_TIMELINE_WINDOW));
        dispatch({ type: 'loaded', detail: cached });
      }
    });
    if (!client || !connection.deviceToken) return unsubscribe;
    void client
      .session(connection.deviceToken, sessionId)
      .then((detail) => {
        setShowScrollToBottom(false);
        setVisibleStart(Math.max(0, buildTimeline(detail).length - INITIAL_TIMELINE_WINDOW));
        dispatch({ type: 'loaded', detail });
        loadedRef.current = true;
        pendingEventsRef.current.forEach((event) => {
          if (event.type === 'assistant.delta') {
            if (streamingEnabledRef.current) enqueueDelta(event);
          } else dispatch({ type: 'event', event });
        });
        pendingEventsRef.current = [];
      })
      .catch(() => setError('无法加载会话详情。'));
    return () => {
      unsubscribe();
      if (deltaFlushTimerRef.current) clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
      pendingDeltasRef.current = [];
    };
  }, [client, connection.deviceToken, enqueueDelta, sessionId, sessions.subscribe]);

  useEffect(() => {
    if (sessions.eventState !== 'open' || !loadedRef.current || !client || !connection.deviceToken)
      return;
    let cancelled = false;
    void client
      .session(connection.deviceToken, sessionId)
      .then((detail) => {
        if (!cancelled) dispatch({ type: 'loaded', detail });
      })
      .catch(() => {
        if (!cancelled) setError('连接已恢复，但会话同步失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [client, connection.deviceToken, sessionId, sessions.eventState]);

  useEffect(() => {
    if (!state.detail) return;
    const timer = setTimeout(() => {
      if (state.detail) void saveCachedSession(state.detail);
    }, 250);
    return () => clearTimeout(timer);
  }, [state.detail]);

  const detail = state.detail;
  const timeline = useMemo(() => (detail ? buildTimeline(detail) : []), [detail]);
  const visibleTimeline = useMemo(
    () => invertTimelineWindow(timeline, visibleStart),
    [timeline, visibleStart],
  );
  const online = connection.phase === 'connected';
  const running = detail?.status === 'running' || detail?.status === 'waiting_permission';
  const bannerState = connectionBannerState(sessions.eventState);

  const cancelInteractionRelease = useCallback(() => {
    if (interactionReleaseFrameRef.current !== null) {
      cancelAnimationFrame(interactionReleaseFrameRef.current);
    }
    interactionReleaseFrameRef.current = null;
  }, []);

  const finishUserScroll = useCallback(() => {
    userInteractingRef.current = false;
    scrollModeRef.current = nextScrollModeOnPosition(
      scrollModeRef.current,
      latestAtBottomRef.current,
    );
    setShowScrollToBottom(!latestAtBottomRef.current);
  }, []);

  const beginUserScroll = useCallback(() => {
    cancelInteractionRelease();
    userInteractingRef.current = true;
    scrollModeRef.current = 'READING_HISTORY';
  }, [cancelInteractionRelease]);

  const deferFinishUserScroll = useCallback(() => {
    cancelInteractionRelease();
    interactionReleaseFrameRef.current = requestAnimationFrame(() => {
      interactionReleaseFrameRef.current = null;
      finishUserScroll();
    });
  }, [cancelInteractionRelease, finishUserScroll]);

  const beginUserMomentum = useCallback(() => {
    if (!userInteractingRef.current) return;
    cancelInteractionRelease();
  }, [cancelInteractionRelease]);

  const requestLatestJump = useCallback(
    (animated: boolean) => {
      cancelInteractionRelease();
      userInteractingRef.current = false;
      scrollModeRef.current = latestAtBottomRef.current ? 'FOLLOWING' : 'JUMPING_LATEST';
      setVisibleStart(Math.max(0, timeline.length - INITIAL_TIMELINE_WINDOW));
      setShowScrollToBottom(false);
      listRef.current?.scrollToOffset({ offset: INVERTED_LATEST_OFFSET, animated });
    },
    [cancelInteractionRelease, timeline.length],
  );

  useEffect(() => {
    const appended = timeline.length > previousTimelineLengthRef.current;
    previousTimelineLengthRef.current = timeline.length;
    if (shouldFollowTimeline(scrollModeRef.current) && appended) {
      setVisibleStart(Math.max(0, timeline.length - INITIAL_TIMELINE_WINDOW));
    }
  }, [timeline.length]);

  const loadEarlier = () => {
    scrollModeRef.current = 'READING_HISTORY';
    setVisibleStart((current) => Math.max(0, current - LOAD_EARLIER_BATCH));
  };

  const send = async () => {
    const message = draft.trim();
    const hasAttachments = attachmentQueue.items.length > 0;
    if (!client || !connection.deviceToken || (!message && !hasAttachments) || busy) return;
    if (attachmentQueue.isUploading) {
      setError('附件仍在上传，请稍候。');
      return;
    }
    if (attachmentQueue.hasFailed) {
      setError('有附件上传失败，请重试或移除后再发送。');
      return;
    }
    const commandOnly = !hasAttachments;
    if (commandOnly && message === '/clear') {
      setBusy(true);
      setError(null);
      try {
        const response = await client.clearSession(
          connection.deviceToken,
          sessionId,
          createRequestId(),
        );
        dispatch({ type: 'loaded', detail: response.session });
        setVisibleStart(0);
        requestLatestJump(false);
        updateDraft('');
        dispatch({ type: 'notice', message: '当前会话已清空。' });
      } catch (error) {
        setError(`清空失败：${connectionErrorMessage(error)}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (running) return;
    if (commandOnly && message === '/help') {
      setShowCommands(false);
      updateDraft('');
      setInfoDialog({
        title: '可用命令',
        body: BUILTIN_COMMANDS.map((item) => `${item.command}  ${item.description}`).join('\n\n'),
      });
      return;
    }
    if (commandOnly && message === '/status') {
      setShowCommands(false);
      updateDraft('');
      const selectedModel = models.models.find((item) => item.id === detail?.modelId);
      setInfoDialog({
        title: '当前状态',
        body: [
          `连接：${online ? '已连接' : '离线'}`,
          `会话：${statusText(detail?.status ?? 'idle')}`,
          `模型：${selectedModel?.model ?? 'Gateway 默认模型'}`,
          `模式：${mode.mode}`,
          `流式输出：${streamingEnabled ? '开启' : '关闭'}`,
          `工作目录：${detail?.workingDirectory ?? '项目根目录'}`,
        ].join('\n'),
      });
      return;
    }
    if (commandOnly && message === '/model') {
      setShowCommands(false);
      setShowModelPicker(true);
      return;
    }
    if (commandOnly && message === '/skill') {
      setShowCommands(false);
      setShowSkillPicker(true);
      return;
    }
    if (commandOnly && (message === '/schedule' || message.startsWith('/schedule '))) {
      setShowCommands(false);
      setBusy(true);
      setError(null);
      try {
        const response = await client.scheduledTaskDraft(connection.deviceToken, {
          requestId: createRequestId(),
          text: message,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
          projectId: detail?.projectId ?? null,
          workingDirectory: detail?.workingDirectory ?? null,
          modelId: detail?.modelId ?? null,
        });
        updateDraft('');
        router.push({
          pathname: '/scheduled/new',
          params: { draft: JSON.stringify(response.draft) },
        });
      } catch (caught) {
        setError(`无法生成定时任务草稿：${connectionErrorMessage(caught)}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (
      commandOnly &&
      message.startsWith('/') &&
      message !== selectedSkillCommand &&
      message !== '/compact'
    ) {
      setError(
        '该命令暂未支持。可使用 /help、/status、/model、/skill、/schedule、/compact 或 /clear。',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await client.sendMessage(
        connection.deviceToken,
        sessionId,
        message,
        createRequestId(),
        attachmentQueue.attachmentIds,
      );
      dispatch({ type: 'message', message: response.message });
      dispatch({ type: 'session', session: response.session });
      requestLatestJump(false);
      updateDraft('');
      attachmentQueue.clearAfterSend();
      void clearComposerDraft(sessionId);
    } catch (caught) {
      setError(`发送失败：${connectionErrorMessage(caught)} 任务内容已保留。`);
    } finally {
      setBusy(false);
    }
  };

  const selectSessionModel = async (modelId: string, modelName: string) => {
    if (!client || !connection.deviceToken || busy || running) return;
    setBusy(true);
    setError(null);
    try {
      const response = await client.setSessionModel(
        connection.deviceToken,
        sessionId,
        modelId,
        createRequestId(),
      );
      dispatch({ type: 'session', session: response.session });
      setShowModelPicker(false);
      updateDraft('');
      dispatch({ type: 'notice', message: `已切换到 ${modelName}` });
    } catch (error) {
      setError(`模型切换失败：${connectionErrorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!client || !connection.deviceToken || busy || !running) return;
    setBusy(true);
    setError(null);
    try {
      const session = await client.cancelSession(
        connection.deviceToken,
        sessionId,
        createRequestId(),
      );
      dispatch({ type: 'session', session });
    } catch {
      setError('停止失败，请检查电脑连接。');
    } finally {
      setBusy(false);
    }
  };

  const decide = useCallback(
    async (permission: PermissionRequest, decision: PermissionDecision, answer?: string) => {
      if (!client || !connection.deviceToken || busy || permission.status !== 'pending') return;
      setBusy(true);
      setError(null);
      try {
        const response = await client.decidePermission(
          connection.deviceToken,
          permission.id,
          decision,
          createRequestId(),
          answer,
        );
        dispatch({ type: 'permission', permission: response.permission });
        dispatch({ type: 'session', session: response.session });
      } catch {
        setError('权限操作失败，可能已在其他设备处理。');
      } finally {
        setBusy(false);
      }
    },
    [busy, client, connection.deviceToken],
  );

  const updateDraft = (value: string) => {
    setDraft(value);
    setSelectedSkillCommand((current) => (current === value.trim() ? current : null));
    setShowCommands(value.trimStart().startsWith('/'));
  };

  const selectSkill = (skill: SkillSummary) => {
    const command =
      skill.kind === 'command' ? `/${skill.name.replace(/^\//, '')}` : `/${skill.name}`;
    setDraft(command);
    setSelectedSkillCommand(command);
    setShowCommands(false);
    setShowSkillPicker(false);
  };

  const scrollToLatest = useCallback(
    (animated: boolean) => {
      requestLatestJump(animated);
    },
    [requestLatestJump],
  );

  useEffect(
    () => () => {
      cancelInteractionRelease();
    },
    [cancelInteractionRelease],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      const incoming = keyboardAvoidanceInset({
        keyboardHeight: event.endCoordinates.height,
        safeAreaBottom: insets.bottom,
      });
      setKeyboardInset((current) => stableKeyboardInset(current, incoming));
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardInset(0));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [insets.bottom]);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
            {detail?.title ?? '会话'}
          </Text>
          {detail ? <Text style={styles.subtitle}>{statusText(detail.status)}</Text> : null}
        </View>
        <View style={styles.streamToggle}>
          <Text style={styles.streamLabel}>实时</Text>
          <Switch
            accessibilityLabel="流式输出"
            onValueChange={setStreamingEnabled}
            thumbColor={streamingEnabled ? colors.brand : colors.surface}
            trackColor={{ false: colors.border, true: colors.brandPressed }}
            value={streamingEnabled}
          />
        </View>
      </View>
      {bannerState ? <ConnectionBanner state={bannerState} /> : null}
      {error || state.notice ? (
        <Pressable
          accessibilityRole="alert"
          onPress={() => {
            setError(null);
            dispatch({ type: 'notice', message: null });
          }}
          style={styles.notice}
        >
          <Text numberOfLines={2} style={styles.noticeText}>
            {error ?? state.notice}
          </Text>
          <Text style={styles.dismiss}>×</Text>
        </Pressable>
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.keyboardViewport, { paddingBottom: keyboardInset }]}
      >
        <View style={styles.chatArea}>
          {!detail ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : (
            <FlatList
              contentContainerStyle={[
                styles.messages,
                { paddingTop: spacing.md + MESSAGE_END_GUTTER },
              ]}
              data={visibleTimeline}
              inverted
              ListFooterComponent={
                visibleStart > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={loadEarlier}
                    style={({ pressed }) => [styles.loadEarlier, pressed && styles.surfacePressed]}
                  >
                    <Text style={styles.loadEarlierText}>加载更早消息</Text>
                  </Pressable>
                ) : null
              }
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => `${item.kind}-${item.id}`}
              maintainVisibleContentPosition={INVERTED_MAINTAIN_VISIBLE_CONTENT_POSITION}
              onMomentumScrollBegin={beginUserMomentum}
              onMomentumScrollEnd={finishUserScroll}
              onScrollBeginDrag={beginUserScroll}
              onScrollEndDrag={deferFinishUserScroll}
              onScroll={({ nativeEvent }) => {
                const atBottom = isNearInvertedTimelineLatest(nativeEvent.contentOffset.y);
                latestAtBottomRef.current = atBottom;
                scrollModeRef.current = nextScrollModeOnPosition(
                  scrollModeRef.current,
                  atBottom,
                  userInteractingRef.current,
                );
                setShowScrollToBottom(
                  !atBottom &&
                    nativeEvent.contentSize.height > nativeEvent.layoutMeasurement.height,
                );
              }}
              scrollEventThrottle={100}
              ref={listRef}
              scrollIndicatorInsets={{ top: MESSAGE_END_GUTTER }}
              style={styles.timeline}
              renderItem={({ item }) => (
                <TimelineRow
                  apiKey={connection.deviceToken}
                  client={client}
                  disabled={busy || !online}
                  item={item}
                  onDecision={decide}
                />
              )}
            />
          )}
          {detail && showScrollToBottom ? (
            <Pressable
              accessibilityLabel="回到底部"
              accessibilityRole="button"
              onPress={() => scrollToLatest(true)}
              style={({ pressed }) => [styles.scrollToBottom, pressed && styles.surfacePressed]}
            >
              <Text style={styles.scrollToBottomText}>↓ 最新消息</Text>
            </Pressable>
          ) : null}
        </View>
        {showCommands ? (
          <View style={styles.commandPanel}>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.commandList}>
              {BUILTIN_COMMANDS.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  key={item.command}
                  onPress={() => insertCommand(item.command)}
                  style={({ pressed }) => [styles.commandRow, pressed && styles.surfacePressed]}
                >
                  <Text style={styles.commandName}>{item.command}</Text>
                  <Text numberOfLines={1} style={styles.commandDesc}>
                    {item.description}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        <View
          style={[
            styles.composer,
            { paddingBottom: keyboardInset ? spacing.sm : Math.max(insets.bottom, spacing.sm) },
          ]}
        >
          <ChatComposer
            attachments={attachmentQueue.items}
            busy={busy}
            draft={draft}
            online={online}
            onAddAttachments={attachmentQueue.add}
            onCancelRunning={() => void cancel()}
            onChangeDraft={updateDraft}
            onError={setError}
            onRemoveAttachment={attachmentQueue.remove}
            onRetryAttachment={attachmentQueue.retry}
            onSend={() => void send()}
            running={running}
            sendDisabled={
              !online ||
              (!draft.trim() && attachmentQueue.items.length === 0) ||
              attachmentQueue.isUploading ||
              attachmentQueue.hasFailed
            }
          />
        </View>
      </KeyboardAvoidingView>
      <Modal
        animationType="fade"
        onRequestClose={() => setInfoDialog(null)}
        transparent
        visible={infoDialog !== null}
      >
        <Pressable onPress={() => setInfoDialog(null)} style={styles.modelPickerBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.modelPickerCard}>
            <Text style={styles.modelPickerTitle}>{infoDialog?.title}</Text>
            <ScrollView style={styles.infoDialogScroll}>
              <Text selectable style={styles.infoDialogBody}>
                {infoDialog?.body}
              </Text>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInfoDialog(null)}
              style={styles.infoDialogClose}
            >
              <Text style={styles.infoDialogCloseText}>关闭</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setShowModelPicker(false)}
        transparent
        visible={showModelPicker}
      >
        <Pressable onPress={() => setShowModelPicker(false)} style={styles.modelPickerBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.modelPickerCard}>
            <Text style={styles.modelPickerTitle}>切换当前会话模型</Text>
            <Text style={styles.modelPickerCopy}>仅影响此会话接下来的回复</Text>
            <ScrollView style={styles.modelPickerList}>
              {models.models.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => void selectSessionModel(item.id, item.model)}
                  style={({ pressed }) => [
                    styles.modelPickerOption,
                    pressed && styles.surfacePressed,
                  ]}
                >
                  <Text style={styles.modelPickerName}>{item.model}</Text>
                  <Text numberOfLines={1} style={styles.modelPickerProvider}>
                    {item.name} · {item.baseUrl}
                  </Text>
                  {detail?.modelId === item.id ? (
                    <Text style={styles.modelPickerCurrent}>当前</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
            {models.models.length === 0 ? (
              <Text style={styles.modelPickerCopy}>请先在模型页添加 API 配置和模型。</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setShowSkillPicker(false)}
        transparent
        visible={showSkillPicker}
      >
        <Pressable onPress={() => setShowSkillPicker(false)} style={styles.modelPickerBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.modelPickerCard}>
            <Text style={styles.modelPickerTitle}>选择 Claude 技能</Text>
            <Text style={styles.modelPickerCopy}>选择后会将技能命令放入输入框</Text>
            <ScrollView style={styles.modelPickerList}>
              {skills.map((skill) => (
                <Pressable
                  accessibilityRole="button"
                  key={`${skill.kind}-${skill.name}`}
                  onPress={() => selectSkill(skill)}
                  style={({ pressed }) => [
                    styles.modelPickerOption,
                    pressed && styles.surfacePressed,
                  ]}
                >
                  <Text style={styles.modelPickerName}>
                    {skill.kind === 'command'
                      ? `/${skill.name.replace(/^\//, '')}`
                      : `/${skill.name}`}
                  </Text>
                  <Text numberOfLines={2} style={styles.modelPickerProvider}>
                    {skill.description}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {skills.length === 0 ? (
              <Text style={styles.modelPickerCopy}>Gateway 暂未发现可用的 Claude 技能。</Text>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

type TimelineRowProps = {
  apiKey: string | null;
  client: GatewayClient | null;
  disabled: boolean;
  item: TimelineItem;
  onDecision: (
    permission: PermissionRequest,
    decision: PermissionDecision,
    answer?: string,
  ) => Promise<void>;
};

const TimelineRow = memo(function TimelineRow({
  apiKey,
  client,
  disabled,
  item,
  onDecision,
}: TimelineRowProps) {
  if (item.kind === 'tool') return <ToolRow tool={item.value} />;
  if (item.kind === 'permission') {
    return <PermissionRow disabled={disabled} onDecision={onDecision} permission={item.value} />;
  }
  const own = item.value.role === 'user';
  return (
    <View style={[styles.messageRow, own && styles.userRow]}>
      <View style={[styles.bubble, own ? styles.userBubble : styles.assistantBubble]}>
        {client && apiKey ? (
          <MessageAttachments
            apiKey={apiKey}
            attachments={item.value.attachments}
            client={client}
          />
        ) : null}
        <MarkdownMessage
          content={item.value.content || ' '}
          streaming={Boolean(item.value.isPartial)}
          tone={own ? 'user' : 'assistant'}
        />
        {item.value.isPartial ? <View style={styles.typingDot} /> : null}
      </View>
    </View>
  );
}, areTimelineRowPropsEqual);

function areTimelineRowPropsEqual(previous: TimelineRowProps, next: TimelineRowProps): boolean {
  return (
    previous.disabled === next.disabled &&
    previous.apiKey === next.apiKey &&
    previous.client === next.client &&
    previous.onDecision === next.onDecision &&
    previous.item.kind === next.item.kind &&
    previous.item.id === next.item.id &&
    previous.item.value === next.item.value
  );
}

function ToolRow({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      onPress={() => setExpanded((value) => !value)}
      style={({ pressed }) => [styles.tool, pressed && styles.surfacePressed]}
    >
      <View style={styles.toolHeader}>
        <View style={styles.toolDot} />
        <Text numberOfLines={1} style={styles.toolName}>
          {tool.toolName}
        </Text>
        <Text style={[styles.toolStatus, tool.status === 'failed' && styles.failed]}>
          {toolStatusText(tool.status)}
        </Text>
      </View>
      {expanded ? (
        <ScrollView nestedScrollEnabled style={styles.toolOutput}>
          <Text selectable style={styles.toolCode}>
            {formatJson({ input: tool.input, output: tool.output })}
          </Text>
        </ScrollView>
      ) : null}
    </Pressable>
  );
}

function PermissionRow({
  disabled,
  onDecision,
  permission,
}: {
  disabled: boolean;
  onDecision: (
    permission: PermissionRequest,
    decision: PermissionDecision,
    answer?: string,
  ) => Promise<void>;
  permission: PermissionRequest;
}) {
  const [answer, setAnswer] = useState('');
  const pending = permission.status === 'pending';
  const questions =
    permission.toolName === 'AskUserQuestion' ? readQuestions(permission.input) : [];
  if (questions.length) {
    return (
      <View style={styles.questionCard}>
        <Text style={styles.permissionLabel}>需要你的回答</Text>
        {questions.map((question, questionIndex) => (
          <View key={`${question.question}-${questionIndex}`} style={styles.questionBlock}>
            <Text style={styles.questionTitle}>{question.question}</Text>
            {question.options.map((option, optionIndex) => (
              <Pressable
                disabled={disabled || !pending}
                key={`${option.label}-${optionIndex}`}
                onPress={() => void onDecision(permission, 'deny', option.label)}
                style={({ pressed }) => [
                  styles.questionOption,
                  (disabled || !pending) && styles.actionDisabled,
                  pressed && styles.surfacePressed,
                ]}
              >
                <Text style={styles.questionOptionLabel}>{option.label}</Text>
                {option.description ? (
                  <Text style={styles.questionOptionCopy}>{option.description}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ))}
        {pending ? (
          <View style={styles.answerRow}>
            <TextInput
              editable={!disabled}
              onChangeText={setAnswer}
              placeholder="输入你的回答"
              placeholderTextColor={colors.muted}
              style={styles.answerInput}
              value={answer}
            />
            <Pressable
              disabled={disabled || !answer.trim()}
              onPress={() => void onDecision(permission, 'deny', answer)}
              style={[styles.answerSend, (disabled || !answer.trim()) && styles.actionDisabled]}
            >
              <Text style={styles.answerSendText}>发送</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.resolved}>已将你的回答发送给 Claude</Text>
        )}
      </View>
    );
  }
  const allow = () => {
    if (!isHighRiskPermission(permission)) {
      void onDecision(permission, 'allow_once');
      return;
    }
    Alert.alert(
      '确认允许高风险操作',
      `${permission.toolName}\n\n${permission.description ?? formatJson(permission.input)}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '允许一次',
          style: 'destructive',
          onPress: () => void onDecision(permission, 'allow_once'),
        },
      ],
    );
  };
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionLabel}>需要权限</Text>
      <Text style={styles.permissionTitle}>{permission.toolName}</Text>
      {permission.description ? (
        <Text style={styles.permissionCopy}>{permission.description}</Text>
      ) : null}
      <Text selectable numberOfLines={6} style={styles.code}>
        {formatJson(permission.input)}
      </Text>
      {pending ? (
        <View style={styles.permissionActions}>
          <Pressable
            disabled={disabled}
            onPress={() => void onDecision(permission, 'deny')}
            style={[styles.permissionButton, styles.denyButton, disabled && styles.actionDisabled]}
          >
            <Text style={styles.denyText}>拒绝</Text>
          </Pressable>
          <Pressable
            disabled={disabled}
            onPress={allow}
            style={[styles.permissionButton, styles.allowButton, disabled && styles.actionDisabled]}
          >
            <Text style={styles.allowText}>允许一次</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.resolved}>
          {permission.decision === 'allow_once' ? '已允许一次' : '已拒绝'}
        </Text>
      )}
    </View>
  );
}

type QuestionOption = { description?: string; label: string };
type UserQuestion = { options: QuestionOption[]; question: string };

function readQuestions(value: unknown): UserQuestion[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { questions?: unknown }).questions)
  ) {
    return [];
  }
  return (value as { questions: unknown[] }).questions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const question = (candidate as { question?: unknown }).question;
    if (typeof question !== 'string' || !question.trim()) return [];
    const options = Array.isArray((candidate as { options?: unknown }).options)
      ? (candidate as { options: unknown[] }).options.flatMap((option) => {
          if (!option || typeof option !== 'object') return [];
          const label = (option as { label?: unknown }).label;
          const description = (option as { description?: unknown }).description;
          return typeof label === 'string' && label.trim()
            ? [{ label: label.trim(), ...(typeof description === 'string' ? { description } : {}) }]
            : [];
        })
      : [];
    return [{ question: question.trim(), options }];
  });
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isHighRiskPermission(permission: PermissionRequest): boolean {
  return /(bash|shell|terminal|write|edit|notebook)/i.test(permission.toolName);
}

function statusText(status: string): string {
  return (
    (
      {
        idle: '空闲',
        running: '处理中',
        waiting_permission: '等待权限',
        interrupted: '已停止',
        error: '出错',
        archived: '已归档',
      } as Record<string, string>
    )[status] ?? status
  );
}

function toolStatusText(status: ToolCall['status']): string {
  return ({ running: '执行中', completed: '已完成', failed: '失败' } as const)[status];
}

const styles = StyleSheet.create({
  page: { backgroundColor: '#FAFAF8', flex: 1, position: 'relative' },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
  },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  streamToggle: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 48,
    justifyContent: 'flex-end',
    paddingRight: spacing.xs,
    width: 82,
  },
  streamLabel: {
    color: colors.muted,
    fontFamily: Platform.select({ android: 'sans-serif', default: undefined }),
    fontSize: 11,
    marginRight: 3,
  },
  back: { color: colors.text, fontSize: 36, lineHeight: 38 },
  heading: { alignItems: 'center', flex: 1, paddingVertical: spacing.xs },
  title: {
    color: colors.text,
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    fontSize: 17,
    fontWeight: '600',
    maxWidth: '100%',
  },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 1 },
  notice: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    flexDirection: 'row',
    minHeight: 40,
    paddingHorizontal: spacing.control,
  },
  noticeText: { color: colors.danger, flex: 1, fontSize: 13, lineHeight: 18 },
  dismiss: { color: colors.danger, fontSize: 22, marginLeft: spacing.sm },
  keyboardViewport: { flex: 1, minHeight: 0 },
  chatArea: { flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  timeline: { flex: 1, minHeight: 0 },
  messages: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  loadEarlier: {
    alignItems: 'center',
    backgroundColor: colors.mutedSurface,
    borderRadius: 6,
    marginBottom: spacing.control,
    paddingVertical: spacing.sm,
  },
  loadEarlierText: { color: colors.brand, fontSize: 13, fontWeight: '600' },
  scrollToBottom: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 2,
    paddingHorizontal: spacing.control,
    paddingVertical: spacing.sm,
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.control,
  },
  scrollToBottomText: { color: colors.brand, fontSize: 12, fontWeight: '600' },
  modelPickerBackdrop: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modelPickerCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    maxHeight: '70%',
    width: '100%',
  },
  modelPickerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  modelPickerCopy: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
    paddingHorizontal: spacing.lg,
  },
  modelPickerList: { marginTop: spacing.md },
  infoDialogScroll: { marginTop: spacing.md, maxHeight: 360, paddingHorizontal: spacing.lg },
  infoDialogBody: { color: colors.text, fontSize: 14, lineHeight: 21 },
  infoDialogClose: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    minHeight: 48,
  },
  infoDialogCloseText: { color: colors.brand, fontSize: 15, fontWeight: '600', marginTop: 14 },
  modelPickerOption: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.control,
  },
  modelPickerName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  modelPickerProvider: { color: colors.muted, fontSize: 12, marginTop: 3, paddingRight: 48 },
  modelPickerCurrent: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '600',
    position: 'absolute',
    right: spacing.control,
    top: spacing.control,
  },
  messageRow: { alignItems: 'flex-start', alignSelf: 'stretch', marginBottom: spacing.md },
  userRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '94%', paddingHorizontal: spacing.control, paddingVertical: 10 },
  assistantBubble: { maxWidth: '100%', paddingHorizontal: 0, width: '100%' },
  userBubble: { backgroundColor: '#EDF4F2', borderRadius: 8, maxWidth: '94%' },
  typingDot: {
    backgroundColor: colors.brand,
    borderRadius: 3,
    height: 6,
    marginTop: spacing.xs,
    width: 6,
  },
  tool: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.control,
    overflow: 'hidden',
  },
  toolHeader: { alignItems: 'center', flexDirection: 'row', minHeight: 40, paddingHorizontal: 10 },
  toolDot: { backgroundColor: colors.brand, borderRadius: 4, height: 8, marginRight: 8, width: 8 },
  toolName: { color: colors.text, flex: 1, fontSize: 12, fontWeight: '600' },
  toolStatus: { color: colors.muted, fontSize: 11, marginLeft: spacing.sm },
  failed: { color: colors.danger },
  toolOutput: {
    backgroundColor: '#FAFCFC',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 176,
  },
  toolCode: {
    color: colors.muted,
    fontFamily: Platform.select({ android: 'monospace', default: undefined }),
    fontSize: 11,
    lineHeight: 17,
    padding: 10,
  },
  code: {
    backgroundColor: colors.mutedSurface,
    color: colors.text,
    fontFamily: Platform.select({ android: 'monospace', default: undefined }),
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  permission: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.warning,
    borderLeftWidth: 3,
    marginBottom: spacing.control,
    padding: spacing.control,
  },
  questionCard: {
    backgroundColor: colors.surface,
    borderColor: '#D3E5E1',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: spacing.control,
    padding: spacing.control,
  },
  questionBlock: { marginTop: spacing.sm },
  questionTitle: { color: colors.text, fontSize: 16, fontWeight: '600', lineHeight: 23 },
  questionOption: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  questionOptionLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  questionOptionCopy: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  answerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.control,
  },
  answerInput: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 14,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  answerSend: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.control,
  },
  answerSendText: { color: colors.textOnBrand, fontSize: 13, fontWeight: '600' },
  permissionLabel: { color: colors.warning, fontSize: 12, fontWeight: '600' },
  permissionTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: spacing.xs },
  permissionCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  permissionActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.control },
  permissionButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    height: 40,
    justifyContent: 'center',
  },
  denyButton: { borderColor: colors.border, borderWidth: 1 },
  allowButton: { backgroundColor: colors.brand },
  denyText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  allowText: { color: colors.textOnBrand, fontSize: 14, fontWeight: '600' },
  resolved: { color: colors.muted, fontSize: 13, marginTop: spacing.control },
  surfacePressed: { backgroundColor: colors.surfacePressed },
  composer: {
    backgroundColor: '#FAFAF8',
    paddingHorizontal: spacing.control,
    paddingTop: spacing.sm,
  },
  actionDisabled: { opacity: 0.4 },
  commandPanel: {
    backgroundColor: '#FFFFFFF5',
    borderTopColor: '#DFEAE6',
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 184,
    paddingHorizontal: spacing.control,
  },
  commandList: { maxHeight: 176 },
  commandRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  commandName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  commandDesc: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  commandClose: { alignItems: 'center', marginTop: spacing.md, paddingVertical: spacing.sm },
  commandCloseText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
});
