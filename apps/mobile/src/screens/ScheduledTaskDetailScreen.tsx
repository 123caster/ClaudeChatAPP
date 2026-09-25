import type { ScheduledRun, ScheduledTask } from '@claude-chat/protocol';
import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GatewayClient } from '@/api/gateway-client';
import { useConnection } from '@/state/connection-store';
import { useScheduledTasks } from '@/state/scheduled-task-store';
import { useSessions } from '@/state/session-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

function runStatus(run: ScheduledRun): string {
  switch (run.status) {
    case 'queued':
      return '等待执行';
    case 'running':
      return '执行中';
    case 'waiting_permission':
      return '等待确认';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'skipped':
      return '已跳过';
    case 'cancelled':
      return '已取消';
  }
}

export function ScheduledTaskDetailScreen({ taskId }: { taskId: string }) {
  const connection = useConnection();
  const store = useScheduledTasks();
  const { subscribe } = useSessions();
  const [task, setTask] = useState<ScheduledTask | null>(
    store.tasks.find(({ id }) => id === taskId) ?? null,
  );
  const [runs, setRuns] = useState<ScheduledRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connection.deviceToken) return;
    try {
      const detail = await new GatewayClient(connection.gatewayUrl).scheduledTask(
        connection.deviceToken,
        taskId,
      );
      setTask(detail.task);
      setRuns(detail.runs);
      setError(null);
    } catch {
      setError('无法加载任务详情。');
    } finally {
      setLoading(false);
    }
  }, [connection.deviceToken, connection.gatewayUrl, taskId]);

  useEffect(() => {
    void refresh();
    void store.markRead(taskId).catch(() => undefined);
  }, [refresh, store.markRead, taskId]);

  useEffect(
    () =>
      subscribe((event) => {
        if (
          (event.type === 'scheduled-run.created' ||
            event.type === 'scheduled-run.updated' ||
            event.type === 'scheduled-run.needs-attention') &&
          event.payload.run.taskId === taskId
        ) {
          void refresh();
        }
        if (
          (event.type === 'scheduled-task.created' || event.type === 'scheduled-task.updated') &&
          event.payload.task.id === taskId
        ) {
          setTask(event.payload.task);
        }
      }),
    [refresh, subscribe, taskId],
  );

  const runNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await store.runNow(taskId);
      await refresh();
    } catch {
      Alert.alert('暂时不能执行', '当前任务可能仍在运行，或 Gateway 已离线。');
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (!task || busy) return;
    setBusy(true);
    try {
      const updated = await store.update(task.id, {
        status: task.status === 'active' ? 'paused' : 'active',
      });
      setTask(updated);
    } catch {
      Alert.alert('修改失败', '请恢复 Gateway 连接后重试。');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!task) return;
    Alert.alert('删除定时任务', `删除“${task.name}”？专属会话记录仍会保留在数据库中。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void store
            .remove(task.id)
            .then(() => router.replace('/scheduled'))
            .catch(() => {
              setBusy(false);
              Alert.alert('删除失败', '请恢复连接后重试。');
            });
        },
      },
    ]);
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <Pressable
            accessibilityLabel="返回"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.headerIconButton}
          >
            <Text style={styles.back}>‹</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {task?.name ?? '任务详情'}
        </Text>
        <View style={[styles.headerSide, styles.headerActions]}>
          <Pressable
            accessibilityLabel="编辑任务"
            accessibilityRole="button"
            disabled={!task}
            onPress={() =>
              task && router.push({ pathname: '/scheduled/edit', params: { taskId: task.id } })
            }
            style={styles.editButton}
          >
            <Text style={styles.edit}>编辑</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="删除定时任务"
            accessibilityRole="button"
            disabled={!task || busy}
            onPress={confirmDelete}
            style={styles.headerIconButton}
          >
            <SymbolView
              name={{ ios: 'trash', android: 'delete' }}
              size={19}
              tintColor={colors.danger}
            />
          </Pressable>
        </View>
      </View>
      {loading && !task ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : !task ? (
        <View style={styles.loading}>
          <Text style={styles.error}>{error ?? '任务不存在。'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {task.needsAttention ? (
            <View style={styles.attentionBox}>
              <Text style={styles.attentionTitle}>需要你的确认</Text>
              <Text style={styles.attentionCopy}>打开专属会话处理工具权限后，任务会继续执行。</Text>
            </View>
          ) : null}
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.key}>状态</Text>
              <Text style={styles.value}>
                {task.status === 'active'
                  ? '运行中'
                  : task.status === 'paused'
                    ? '已暂停'
                    : '已完成'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.key}>下次执行</Text>
              <Text style={styles.value}>
                {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : '无'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.key}>工作目录</Text>
              <Text numberOfLines={2} style={styles.value}>
                {task.workingDirectory ?? '项目根目录'}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.key}>自动写入</Text>
              <Text style={styles.value}>{task.allowAutoWrite ? '已开启' : '已关闭'}</Text>
            </View>
          </View>
          <Text style={styles.sectionTitle}>任务内容</Text>
          <Text style={styles.prompt}>{task.prompt}</Text>
          <View style={styles.actions}>
            <Pressable disabled={busy} onPress={() => void runNow()} style={styles.primaryAction}>
              <Text style={styles.primaryText}>立即运行</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void togglePause()}
              style={styles.secondaryAction}
            >
              <Text style={styles.secondaryText}>{task.status === 'active' ? '暂停' : '恢复'}</Text>
            </Pressable>
          </View>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/session/[sessionId]',
                params: { sessionId: task.sessionId },
              })
            }
            style={styles.conversation}
          >
            <View>
              <Text style={styles.conversationTitle}>专属会话</Text>
              <Text style={styles.conversationCopy}>查看完整回答、工具调用和审批记录</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <Text style={styles.sectionTitle}>最近运行</Text>
          {runs.length ? (
            runs.map((run) => (
              <View key={run.id} style={styles.runRow}>
                <View style={styles.runCopy}>
                  <Text style={styles.runStatus}>{runStatus(run)}</Text>
                  <Text style={styles.runTime}>{new Date(run.scheduledFor).toLocaleString()}</Text>
                  {run.errorMessage ? (
                    <Text numberOfLines={2} style={styles.runError}>
                      {run.errorMessage}
                    </Text>
                  ) : null}
                </View>
                {!run.isRead ? <View style={styles.unreadDot} /> : null}
              </View>
            ))
          ) : (
            <Text style={styles.empty}>还没有运行记录。</Text>
          )}
          <Pressable disabled={busy} onPress={confirmDelete} style={styles.deleteAction}>
            <Text style={styles.deleteText}>删除任务</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 58,
  },
  headerSide: { alignItems: 'center', flexDirection: 'row', height: 58, width: 104 },
  headerActions: { justifyContent: 'flex-end' },
  headerIconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  editButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 52 },
  back: { color: colors.text, fontSize: 36, lineHeight: 40 },
  edit: { color: colors.brand, fontSize: 13, fontWeight: '600' },
  headerTitle: {
    color: colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  content: { paddingBottom: 48 },
  attentionBox: {
    backgroundColor: '#FFF7E8',
    borderBottomColor: '#F0D9AC',
    borderBottomWidth: 1,
    padding: spacing.md,
  },
  attentionTitle: { color: colors.warning, fontSize: 14, fontWeight: '700' },
  attentionCopy: { color: colors.warning, fontSize: 12, lineHeight: 18, marginTop: 4 },
  summary: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: 11,
  },
  key: { color: colors.muted, fontSize: 13, width: 86 },
  value: { color: colors.text, flex: 1, fontSize: 13, textAlign: 'right' },
  sectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginHorizontal: spacing.md,
    marginTop: spacing.section,
  },
  prompt: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  primaryText: { color: colors.textOnBrand, fontSize: 14, fontWeight: '600' },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  conversation: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderTopColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: spacing.section,
    padding: spacing.md,
  },
  conversationTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  conversationCopy: { color: colors.muted, fontSize: 11, marginTop: 3 },
  chevron: { color: colors.muted, flex: 1, fontSize: 24, textAlign: 'right' },
  runRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  runCopy: { flex: 1 },
  runStatus: { color: colors.text, fontSize: 13, fontWeight: '600' },
  runTime: { color: colors.muted, fontSize: 11, marginTop: 4 },
  runError: { color: colors.danger, fontSize: 11, lineHeight: 16, marginTop: 4 },
  unreadDot: { backgroundColor: colors.brand, borderRadius: 4, height: 8, width: 8 },
  empty: { color: colors.muted, fontSize: 13, padding: spacing.md },
  deleteAction: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: 6,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    margin: spacing.md,
    marginTop: spacing.xl,
  },
  deleteText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13 },
});
