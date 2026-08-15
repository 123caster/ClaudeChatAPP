import type { SessionSummary } from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from '@/components/ConnectionBanner';
import { SessionRow } from '@/components/SessionRow';
import { useConnection } from '@/state/connection-store';
import { useSessions } from '@/state/session-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function SessionListScreen() {
  const connection = useConnection();
  const store = useSessions();
  const [archiving, setArchiving] = useState<string | null>(null);
  const online = connection.phase === 'connected';

  const confirmArchive = (session: SessionSummary) => {
    Alert.alert('归档会话', `归档“${session.title}”？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '归档',
        onPress: () => {
          setArchiving(session.id);
          void store
            .archive(session.id)
            .catch(() => Alert.alert('归档失败', '请恢复连接后重试。'))
            .finally(() => setArchiving(null));
        },
      },
    ]);
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="模型管理"
          accessibilityRole="button"
          onPress={() => router.push('/models')}
          style={({ pressed }) => [styles.modelButton, pressed && styles.iconPressed]}
        >
          <Text style={styles.modelButtonText}>模型</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text accessibilityRole="header" style={styles.title}>
            Claude
          </Text>
          <Text style={styles.connectionText}>
            {online ? '在线' : connection.phase === 'offline' ? '离线' : '连接中'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="新建会话"
          accessibilityRole="button"
          disabled={!online}
          onPress={() => router.push('/new-session')}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.iconPressed,
            !online && styles.iconDisabled,
          ]}
        >
          <Text style={styles.plus}>＋</Text>
        </Pressable>
      </View>
      {!online ? (
        <ConnectionBanner state={connection.phase === 'offline' ? 'offline' : 'connecting'} />
      ) : null}
      <FlatList
        data={store.sessions}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{store.error ? '无法加载会话' : '暂无会话'}</Text>
            <Text style={styles.emptyCopy}>
              {store.error ??
                (online ? '点击右上角 +，从一个项目开始' : '确认 Gateway 已启动后重试')}
            </Text>
            {!online || store.error ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void store.refresh()}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>重新连接</Text>
              </Pressable>
            ) : null}
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={store.loading}
            onRefresh={() => void store.refresh()}
            tintColor={colors.brand}
          />
        }
        renderItem={({ item }) => (
          <SessionRow
            onLongPress={() => archiving === null && confirmArchive(item)}
            onPress={() =>
              router.push({ pathname: '/session/[sessionId]', params: { sessionId: item.id } })
            }
            session={item}
          />
        )}
      />
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
    height: 52,
  },
  headerSide: { height: 48, width: 48 },
  modelButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.control,
  },
  modelButtonText: { color: colors.brand, fontSize: 14, fontWeight: '600' },
  titleWrap: { alignItems: 'center', flex: 1 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  connectionText: { color: colors.muted, fontSize: 10, marginTop: 1 },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  iconPressed: { backgroundColor: colors.surfacePressed },
  iconDisabled: { opacity: 0.35 },
  plus: { color: colors.text, fontSize: 27, lineHeight: 30 },
  empty: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: 112 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  retryText: { color: colors.text, fontSize: 14 },
});
