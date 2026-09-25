import type { SessionSummary } from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Modal,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppTabBar } from '@/components/AppTabBar';
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
  const [managing, setManaging] = useState<SessionSummary | null>(null);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const online = connection.phase === 'connected';

  const openRename = (session: SessionSummary) => {
    setManaging(null);
    setRenameDraft(session.title);
    setRenameError(null);
    setRenaming(session);
  };

  const archive = (session: SessionSummary) => {
    setManaging(null);
    setArchiving(session.id);
    void store
      .archive(session.id)
      .catch(() => Alert.alert('归档失败', '请恢复连接后重试。'))
      .finally(() => setArchiving(null));
  };

  const confirmDelete = (session: SessionSummary) => {
    setManaging(null);
    Alert.alert('删除会话', `确定永久删除“${session.title}”？此操作不可恢复。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setArchiving(session.id);
          void store
            .remove(session.id)
            .catch(() => Alert.alert('删除失败', '请恢复连接后重试。'))
            .finally(() => setArchiving(null));
        },
      },
    ]);
  };

  const submitRename = () => {
    if (!renaming || !renameDraft.trim() || archiving) return;
    setArchiving(renaming.id);
    setRenameError(null);
    void store
      .rename(renaming.id, renameDraft.trim())
      .then(() => setRenaming(null))
      .catch(() => setRenameError('重命名失败，请恢复连接后重试。'))
      .finally(() => setArchiving(null));
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>C</Text>
          </View>
          <View>
            <Text accessibilityRole="header" style={styles.title}>
              ClaudeChat
            </Text>
            <Text style={[styles.connectionText, online && styles.connectionOnline]}>
              {online
                ? '● Gateway 已连接'
                : connection.phase === 'offline'
                  ? '● Gateway 已离线'
                  : '● 正在连接'}
            </Text>
          </View>
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
            onLongPress={() => archiving === null && setManaging(item)}
            onPress={() =>
              router.push({ pathname: '/session/[sessionId]', params: { sessionId: item.id } })
            }
            session={item}
          />
        )}
      />
      <AppTabBar active="sessions" />
      <Modal
        animationType="fade"
        onRequestClose={() => setManaging(null)}
        transparent
        visible={Boolean(managing)}
      >
        <Pressable onPress={() => setManaging(null)} style={styles.sheetBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.sheetCard}>
            <Text numberOfLines={1} style={styles.sheetTitle}>
              {managing?.title}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={archiving !== null}
              onPress={() => managing && openRename(managing)}
              style={styles.sheetAction}
            >
              <Text style={styles.sheetActionText}>重命名</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={archiving !== null}
              onPress={() => managing && archive(managing)}
              style={styles.sheetAction}
            >
              <Text style={styles.sheetActionText}>归档</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={archiving !== null}
              onPress={() => managing && confirmDelete(managing)}
              style={styles.sheetAction}
            >
              <Text style={[styles.sheetActionText, styles.sheetDestructive]}>删除</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setManaging(null)}
              style={[styles.sheetAction, styles.sheetCancel]}
            >
              <Text style={styles.sheetActionText}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
        transparent
        visible={Boolean(renaming)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>重命名会话</Text>
            <TextInput
              autoFocus
              editable={archiving === null}
              maxLength={200}
              onChangeText={setRenameDraft}
              onSubmitEditing={submitRename}
              placeholder="输入会话名称"
              placeholderTextColor={colors.muted}
              returnKeyType="done"
              style={styles.input}
              value={renameDraft}
            />
            {renameError ? <Text style={styles.error}>{renameError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={archiving !== null}
                onPress={() => setRenaming(null)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!renameDraft.trim() || archiving !== null}
                onPress={submitRename}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (!renameDraft.trim() || archiving !== null) && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    height: 60,
    paddingHorizontal: spacing.control,
  },
  brand: { alignItems: 'center', flex: 1, flexDirection: 'row' },
  logo: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    marginRight: 9,
    width: 30,
  },
  logoText: { color: colors.textOnBrand, fontSize: 16, fontWeight: '700' },
  title: {
    color: colors.text,
    fontFamily: Platform.select({ android: 'sans-serif-medium', default: undefined }),
    fontSize: 16,
    fontWeight: '600',
  },
  connectionText: { color: colors.muted, fontSize: 10, marginTop: 2 },
  connectionOnline: { color: colors.brand },
  iconButton: { alignItems: 'center', height: 42, justifyContent: 'center', width: 42 },
  iconPressed: { backgroundColor: colors.surfacePressed },
  iconDisabled: { opacity: 0.35 },
  plus: {
    color: colors.brand,
    fontFamily: Platform.select({ android: 'sans-serif', default: undefined }),
    fontSize: 26,
    lineHeight: 30,
  },
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
  modalBackdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheetBackdrop: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: spacing.control,
    paddingTop: spacing.md,
  },
  sheetTitle: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm, textAlign: 'center' },
  sheetAction: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 52,
    justifyContent: 'center',
  },
  sheetActionText: { color: colors.text, fontSize: 16, fontWeight: '500' },
  sheetDestructive: { color: colors.danger },
  sheetCancel: { marginTop: spacing.sm },
  modalCard: { backgroundColor: colors.background, borderRadius: 10, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: spacing.control,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  modalCancel: { borderColor: colors.border, borderWidth: 1 },
  modalCancelText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modalConfirm: { backgroundColor: colors.brand },
  modalConfirmText: { color: colors.textOnBrand, fontSize: 15, fontWeight: '600' },
  buttonDisabled: { opacity: 0.45 },
});
