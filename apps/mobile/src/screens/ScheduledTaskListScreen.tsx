import type { ScheduledTask, ScheduledTaskStatus } from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppTabBar } from '@/components/AppTabBar';
import { expoPushProjectId } from '@/notifications/notification-config';
import { useConnection } from '@/state/connection-store';
import { useScheduledTasks } from '@/state/scheduled-task-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type Filter = 'all' | Exclude<ScheduledTaskStatus, 'deleted'>;

function scheduleLabel(task: ScheduledTask): string {
  const time = `${String(task.schedule.hour).padStart(2, '0')}:${String(task.schedule.minute).padStart(2, '0')}`;
  switch (task.schedule.kind) {
    case 'once':
      return `${task.schedule.localDate} ${time}`;
    case 'daily':
      return `每天 ${time}`;
    case 'weekdays':
      return `工作日 ${time}`;
    case 'weekly':
      return `每周${'一二三四五六日'[task.schedule.weekday - 1]} ${time}`;
    case 'monthly':
      return `每月 ${task.schedule.day} 日 ${time}`;
  }
}

const filters: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '运行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
];

export function ScheduledTaskListScreen() {
  const connection = useConnection();
  const store = useScheduledTasks();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const pushProjectConfigured = Boolean(expoPushProjectId());
  const tasks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return store.tasks.filter(
      (task) =>
        (filter === 'all' || task.status === filter) &&
        (!normalizedQuery ||
          task.name.toLocaleLowerCase().includes(normalizedQuery) ||
          task.prompt.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [filter, query, store.tasks]);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.title}>
            定时任务
          </Text>
          <Text style={styles.subtitle}>按计划唤醒 Claude</Text>
        </View>
        <Pressable
          accessibilityLabel="新建定时任务"
          disabled={connection.phase !== 'connected'}
          onPress={() => router.push('/scheduled/new')}
          style={({ pressed }) => [styles.add, pressed && styles.pressed]}
        >
          <Text style={styles.addText}>＋</Text>
        </Pressable>
      </View>
      <View style={styles.filters}>
        {filters.map((item) => (
          <Pressable
            key={item.value}
            onPress={() => setFilter(item.value)}
            style={[styles.filter, filter === item.value && styles.filterActive]}
          >
            <Text style={[styles.filterText, filter === item.value && styles.filterTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.searchBox}>
        <TextInput
          onChangeText={setQuery}
          placeholder="搜索任务"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
      </View>
      {store.pushStatus && (store.pushStatus !== 'ready' || !pushProjectConfigured) ? (
        <View style={[styles.notice, store.pushStatus === 'error' && styles.noticeError]}>
          <Text style={styles.noticeText}>
            {store.pushStatus === 'error'
              ? '系统通知服务异常，任务记录仍会保留在应用内。'
              : !pushProjectConfigured
                ? '当前 App 未配置推送项目，任务记录仍会保留在应用内。'
                : '系统通知尚未配置，任务记录仍会保留在应用内。'}
          </Text>
        </View>
      ) : null}
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={store.loading}
            onRefresh={() => void store.refresh()}
            tintColor={colors.brand}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{store.error ?? '暂无定时任务'}</Text>
            <Text style={styles.emptyCopy}>创建后，任务会在独立会话中保留完整记录。</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/scheduled/[taskId]', params: { taskId: item.id } })
            }
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowTop}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {item.name}
              </Text>
              {item.unreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unreadCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.schedule}>{scheduleLabel(item)}</Text>
            <Text style={styles.nextRun}>
              下次：{item.nextRunAt ? new Date(item.nextRunAt).toLocaleString() : '无'}
            </Text>
            <View style={styles.meta}>
              <Text style={[styles.status, item.needsAttention && styles.attention]}>
                {item.needsAttention
                  ? '需要处理'
                  : item.status === 'active'
                    ? '运行中'
                    : item.status === 'paused'
                      ? '已暂停'
                      : '已完成'}
              </Text>
              <Text numberOfLines={1} style={styles.project}>
                {item.workingDirectory ?? '项目根目录'}
              </Text>
            </View>
          </Pressable>
        )}
      />
      <AppTabBar active="scheduled" />
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
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  headerCopy: { flex: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 11, marginTop: 2 },
  add: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  addText: { color: colors.brand, fontSize: 27 },
  filters: { backgroundColor: colors.surface, flexDirection: 'row', padding: spacing.sm },
  filter: { alignItems: 'center', borderRadius: 5, flex: 1, paddingVertical: 8 },
  filterActive: { backgroundColor: colors.mutedSurface },
  filterText: { color: colors.muted, fontSize: 12 },
  filterTextActive: { color: colors.brand, fontWeight: '600' },
  searchBox: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.mutedSurface,
    borderRadius: 6,
    color: colors.text,
    fontSize: 13,
    height: 40,
    paddingHorizontal: spacing.control,
  },
  notice: {
    backgroundColor: colors.mutedSurface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeError: { backgroundColor: colors.dangerSurface },
  noticeText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  row: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowTop: { alignItems: 'center', flexDirection: 'row' },
  rowTitle: { color: colors.text, flex: 1, fontSize: 16, fontWeight: '600' },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 9,
    minWidth: 18,
    paddingHorizontal: 5,
  },
  badgeText: { color: colors.textOnBrand, fontSize: 10, lineHeight: 18 },
  schedule: { color: colors.text, fontSize: 13, marginTop: 7 },
  nextRun: { color: colors.muted, fontSize: 11, marginTop: 5 },
  meta: { alignItems: 'center', flexDirection: 'row', marginTop: 7 },
  status: { color: colors.brand, fontSize: 11, marginRight: spacing.md },
  attention: { color: colors.warning },
  project: { color: colors.muted, flex: 1, fontSize: 11 },
  empty: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: 120 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  emptyCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  pressed: { backgroundColor: colors.surfacePressed },
});
