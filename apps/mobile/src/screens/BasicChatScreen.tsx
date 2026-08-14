import type {
  EventEnvelope,
  PermissionDecision,
  PermissionRequest,
  ToolCall,
} from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GatewayClient, createRequestId } from '@/api/gateway-client';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { useConnection } from '@/state/connection-store';
import {
  buildTimeline,
  chatReducer,
  initialChatState,
  type TimelineItem,
} from '@/state/chat-state';
import { useSessions } from '@/state/session-store';
import { connectionBannerState } from '@/state/session-list';
import { loadCachedSession, saveCachedSession } from '@/storage/chat-cache';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function BasicChatScreen({ sessionId }: { sessionId: string }) {
  const connection = useConnection();
  const sessions = useSessions();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const loadedRef = useRef(false);
  const pendingEventsRef = useRef<EventEnvelope[]>([]);
  const listRef = useRef<FlatList<TimelineItem>>(null);
  const client = useMemo(
    () => (connection.gatewayUrl ? new GatewayClient(connection.gatewayUrl) : null),
    [connection.gatewayUrl],
  );

  useEffect(() => {
    const show = (event: { endCoordinates: { height: number } }) =>
      setKeyboardHeight(event.endCoordinates.height);
    const hide = () => setKeyboardHeight(0);
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [Keyboard.addListener(showEvent, show), Keyboard.addListener(hideEvent, hide)];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  useEffect(() => {
    loadedRef.current = false;
    pendingEventsRef.current = [];
    const unsubscribe = sessions.subscribe((event) => {
      if (event.sessionId !== sessionId && event.type !== 'server.notice') return;
      if (!loadedRef.current) pendingEventsRef.current.push(event);
      else dispatch({ type: 'event', event });
    });
    void loadCachedSession(sessionId).then((cached) => {
      if (cached && !loadedRef.current) dispatch({ type: 'loaded', detail: cached });
    });
    if (!client || !connection.token) return unsubscribe;
    void client
      .session(connection.token, sessionId)
      .then((detail) => {
        dispatch({ type: 'loaded', detail });
        loadedRef.current = true;
        pendingEventsRef.current.forEach((event) => dispatch({ type: 'event', event }));
        pendingEventsRef.current = [];
      })
      .catch(() => setError('无法加载会话详情。'));
    return unsubscribe;
  }, [client, connection.token, sessionId, sessions.subscribe]);

  useEffect(() => {
    if (!state.detail) return;
    const timer = setTimeout(() => {
      if (state.detail) void saveCachedSession(state.detail);
    }, 250);
    return () => clearTimeout(timer);
  }, [state.detail]);

  const detail = state.detail;
  const timeline = useMemo(() => (detail ? buildTimeline(detail) : []), [detail]);
  const online = connection.phase === 'connected';
  const running = detail?.status === 'running' || detail?.status === 'waiting_permission';
  const bannerState = connectionBannerState(sessions.eventState);

  const send = async () => {
    const message = draft.trim();
    if (!client || !connection.token || !message || busy || running) return;
    setBusy(true);
    setError(null);
    try {
      const response = await client.sendMessage(
        connection.token,
        sessionId,
        message,
        createRequestId(),
      );
      dispatch({ type: 'message', message: response.message });
      dispatch({ type: 'session', session: response.session });
      setDraft('');
    } catch {
      setError('发送失败，任务内容已保留。');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!client || !connection.token || busy || !running) return;
    setBusy(true);
    setError(null);
    try {
      const session = await client.cancelSession(connection.token, sessionId, createRequestId());
      dispatch({ type: 'session', session });
    } catch {
      setError('停止失败，请检查电脑连接。');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (permission: PermissionRequest, decision: PermissionDecision) => {
    if (!client || !connection.token || busy || permission.status !== 'pending') return;
    setBusy(true);
    setError(null);
    try {
      const response = await client.decidePermission(
        connection.token,
        permission.id,
        decision,
        createRequestId(),
      );
      dispatch({ type: 'permission', permission: response.permission });
      dispatch({ type: 'session', session: response.session });
    } catch {
      setError('权限操作失败，可能已在其他设备处理。');
    } finally {
      setBusy(false);
    }
  };

  const composerPadding = Math.max(0, keyboardHeight - insets.bottom);

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
        <View style={styles.iconButton} />
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
      {!detail ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.messages}
          data={timeline}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ref={listRef}
          renderItem={({ item }) => (
            <TimelineRow disabled={busy || !online} item={item} onDecision={decide} />
          )}
        />
      )}
      <View style={[styles.composer, { paddingBottom: composerPadding }]}>
        <TextInput
          editable={!busy && online && !running}
          maxLength={100_000}
          multiline
          onChangeText={setDraft}
          placeholder={online ? (running ? 'Claude 正在处理' : '发送任务') : '电脑离线'}
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={draft}
        />
        <Pressable
          accessibilityLabel={running ? '停止' : '发送'}
          accessibilityRole="button"
          disabled={busy || !online || (!running && !draft.trim())}
          onPress={() => void (running ? cancel() : send())}
          style={({ pressed }) => [
            styles.action,
            running ? styles.stopAction : styles.sendAction,
            (busy || !online || (!running && !draft.trim())) && styles.actionDisabled,
            pressed && styles.actionPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.textOnBrand} size="small" />
          ) : (
            <Text style={styles.actionGlyph}>{running ? '■' : '↑'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function TimelineRow({
  disabled,
  item,
  onDecision,
}: {
  disabled: boolean;
  item: TimelineItem;
  onDecision: (permission: PermissionRequest, decision: PermissionDecision) => Promise<void>;
}) {
  if (item.kind === 'tool') return <ToolRow tool={item.value} />;
  if (item.kind === 'permission') {
    return <PermissionRow disabled={disabled} onDecision={onDecision} permission={item.value} />;
  }
  const own = item.value.role === 'user';
  return (
    <View style={[styles.messageRow, own && styles.userRow]}>
      <View style={[styles.bubble, own ? styles.userBubble : styles.assistantBubble]}>
        <Text selectable style={styles.messageText}>
          {item.value.content || ' '}
        </Text>
        {item.value.isPartial ? <View style={styles.typingDot} /> : null}
      </View>
    </View>
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
        <Text numberOfLines={1} style={styles.toolName}>
          {tool.toolName}
        </Text>
        <Text style={[styles.toolStatus, tool.status === 'failed' && styles.failed]}>
          {toolStatusText(tool.status)}
        </Text>
      </View>
      {expanded ? (
        <Text selectable style={styles.code}>
          {formatJson({ input: tool.input, output: tool.output })}
        </Text>
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
  onDecision: (permission: PermissionRequest, decision: PermissionDecision) => Promise<void>;
  permission: PermissionRequest;
}) {
  const pending = permission.status === 'pending';
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
  page: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 52,
  },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  back: { color: colors.text, fontSize: 36, lineHeight: 38 },
  heading: { alignItems: 'center', flex: 1, paddingVertical: spacing.xs },
  title: { color: colors.text, fontSize: 17, fontWeight: '600', maxWidth: '100%' },
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
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  messages: { padding: spacing.control, paddingBottom: spacing.md },
  messageRow: { alignItems: 'flex-start', marginBottom: spacing.control },
  userRow: { alignItems: 'flex-end' },
  bubble: {
    borderRadius: 6,
    maxWidth: '84%',
    paddingHorizontal: spacing.control,
    paddingVertical: 10,
  },
  assistantBubble: { backgroundColor: colors.surface },
  userBubble: { backgroundColor: '#95EC69' },
  messageText: { color: colors.text, fontSize: 16, lineHeight: 23 },
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
    borderLeftColor: colors.info,
    borderLeftWidth: 3,
    marginBottom: spacing.control,
    padding: spacing.control,
  },
  toolHeader: { alignItems: 'center', flexDirection: 'row' },
  toolName: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600' },
  toolStatus: { color: colors.muted, fontSize: 12, marginLeft: spacing.sm },
  failed: { color: colors.danger },
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
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 6,
    color: colors.text,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 132,
    minHeight: 40,
    paddingHorizontal: spacing.control,
    paddingVertical: 8,
  },
  action: {
    alignItems: 'center',
    borderRadius: 6,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sendAction: { backgroundColor: colors.brand },
  stopAction: { backgroundColor: colors.danger },
  actionDisabled: { opacity: 0.4 },
  actionPressed: { opacity: 0.75 },
  actionGlyph: { color: colors.textOnBrand, fontSize: 20, fontWeight: '700', lineHeight: 23 },
});
