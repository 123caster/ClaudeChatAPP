import type { DirectoryNode, ProjectSummary } from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GatewayClient, createRequestId } from '@/api/gateway-client';
import { AppTabBar } from '@/components/AppTabBar';
import { MarkdownMessage } from '@/components/MarkdownMessage';
import { useConnection } from '@/state/connection-store';
import { useSessions } from '@/state/session-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type DirectoryLocation = {
  project: ProjectSummary;
  relativePath: string;
  title: string;
};

type FilePreview = {
  name: string;
  content: string | null;
  isMarkdown: boolean;
  reason: 'binary' | 'too_large' | null;
};

export function FileTreeScreen() {
  const connection = useConnection();
  const store = useSessions();
  const [stack, setStack] = useState<DirectoryLocation[]>([]);
  const [entries, setEntries] = useState<DirectoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [creationMenuOpen, setCreationMenuOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);

  const current = stack[stack.length - 1] ?? null;

  const loadTree = async (projectId: string, relativePath = '') => {
    if (!connection.deviceToken) return;
    setLoading(true);
    setError(null);
    try {
      const client = new GatewayClient(connection.gatewayUrl);
      setEntries(await client.listDirectoryAt(connection.deviceToken, projectId, relativePath));
    } catch {
      setError('无法加载目录。');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (current) void loadTree(current.project.id, current.relativePath);
  }, [current?.project.id, current?.relativePath]);

  useEffect(() => {
    void store.refresh();
  }, []);

  const enter = (project: ProjectSummary) => {
    setStack((previous) => [
      ...previous,
      { project, relativePath: '', title: project.displayName },
    ]);
  };

  const enterChild = (node: DirectoryNode) => {
    if (!current || !node.isDirectory) return;
    setStack((previous) => [
      ...previous,
      { project: current.project, relativePath: node.relativePath, title: node.name },
    ]);
  };

  const back = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length === 0) return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, stack.length]);

  const openFile = async (node: DirectoryNode) => {
    if (!current || node.isDirectory || !connection.deviceToken) return;
    setLoading(true);
    try {
      const client = new GatewayClient(connection.gatewayUrl);
      const response = await client.previewFile(
        connection.deviceToken,
        current.project.id,
        node.relativePath,
      );
      setPreview({
        name: node.name,
        content: response.content,
        isMarkdown: isMarkdownFile(node.name),
        reason: response.reason,
      });
    } catch {
      Alert.alert('无法打开文件', '文件可能已移动、不可读或不在工作区范围内。');
    } finally {
      setLoading(false);
    }
  };

  const confirmRemove = (project: ProjectSummary) => {
    if (project.origin === 'config') {
      Alert.alert('无法删除', '这是网关配置的项目根目录，不能从这里移除。');
      return;
    }
    Alert.alert(
      '删除工作区',
      `从列表移除“${project.displayName}”？\n\n仅移除注册记录，不会删除服务器磁盘上的文件。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void store
              .removeProject(project.id)
              .catch(() => Alert.alert('删除失败', '请恢复连接后重试。'));
          },
        },
      ],
    );
  };

  const confirmDelete = (node: DirectoryNode) => {
    if (!current || !connection.deviceToken) return;
    if (node.name.toLowerCase() === 'home') {
      Alert.alert('无法删除', 'home 目录及其内容受到保护，不能删除。');
      return;
    }
    const kind = node.isDirectory ? '文件夹' : '文件';
    Alert.alert(
      '删除' + kind,
      `确定永久删除“${node.name}”？\n\n此操作会删除服务器上的实际${kind}，不可恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void new GatewayClient(connection.gatewayUrl)
              .deleteProjectFile(
                connection.deviceToken!,
                current.project.id,
                node.relativePath,
                createRequestId(),
              )
              .then(async () => {
                if (preview?.name === node.name) setPreview(null);
                await store.refresh();
                await loadTree(current.project.id, current.relativePath);
              })
              .catch((caught: unknown) => {
                const message = caught instanceof Error ? caught.message : '请恢复连接后重试。';
                Alert.alert('删除失败', message);
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  };

  const submitCreate = async () => {
    const parent = current?.project ?? store.projects[0];
    if (!parent || !creating || !folderName.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      if (creating === 'file') {
        const relativePath = current?.relativePath
          ? `${current.relativePath}/${folderName.trim()}`
          : folderName.trim();
        await new GatewayClient(connection.gatewayUrl).createProjectFile(
          connection.deviceToken!,
          parent.id,
          relativePath,
          createRequestId(),
        );
        setCreating(null);
        await loadTree(parent.id, current?.relativePath ?? '');
      } else {
        const created = await store.createProject(folderName.trim(), parent.id, folderName.trim());
        setCreating(null);
        void loadTree(parent.id);
        if (current?.relativePath === '') {
          setEntries((prev) => [
            ...prev,
            {
              name: created.displayName,
              path: created.rootPath,
              relativePath: created.displayName,
              isDirectory: true,
              projectId: created.id,
            },
          ]);
        }
      }
    } catch (caught: unknown) {
      setFormError(caught instanceof Error ? caught.message : '新建失败，请确认名称有效且不重名。');
    } finally {
      setBusy(false);
    }
  };

  const roots = current ? entries : store.projects;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => (stack.length > 0 ? back() : router.back())}
          style={styles.iconButton}
        >
          <Text style={styles.back}>{stack.length > 0 ? '‹' : '←'}</Text>
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {current ? current.title : '工作区'}
        </Text>
        <Pressable
          accessibilityLabel="新建内容"
          accessibilityRole="button"
          onPress={() => {
            setCreationMenuOpen(true);
          }}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
        >
          <Text style={styles.plus}>＋</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>正在加载目录…</Text>
        </View>
      ) : null}

      <FlatList
        data={roots as (ProjectSummary | DirectoryNode)[]}
        keyExtractor={(item) =>
          'rootPath' in item ? item.id : (item.projectId ?? `node-${item.name}`)
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{error ?? '暂无目录'}</Text>
            <Text style={styles.emptyCopy}>
              {error ?? '点击右上角 ＋，新建一个文件夹作为工作区'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isCurrentProject = 'rootPath' in item;
          const name = isCurrentProject ? item.displayName : item.name;
          const path = isCurrentProject ? item.rootPath : item.path;
          const isDirectory = isCurrentProject || item.isDirectory;
          return (
            <Pressable
              accessibilityRole="button"
              disabled={!isDirectory && !current}
              onLongPress={() => {
                if (isCurrentProject) confirmRemove(item as ProjectSummary);
                else confirmDelete(item as DirectoryNode);
              }}
              onPress={() => {
                if (isCurrentProject) enter(item as ProjectSummary);
                else if ((item as DirectoryNode).isDirectory) enterChild(item as DirectoryNode);
                else void openFile(item as DirectoryNode);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.rowIcon}>
                {isCurrentProject ? '▸' : (item as DirectoryNode).isDirectory ? '📁' : '⌘'}
              </Text>
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.rowName}>
                  {name}
                </Text>
                <Text numberOfLines={1} style={styles.rowPath}>
                  {path}
                </Text>
              </View>
              {isDirectory ? <Text style={styles.chevron}>›</Text> : null}
            </Pressable>
          );
        }}
      />
      <AppTabBar active="workspace" />

      <Modal
        animationType="fade"
        onRequestClose={() => setCreationMenuOpen(false)}
        transparent
        visible={creationMenuOpen}
      >
        <Pressable onPress={() => setCreationMenuOpen(false)} style={styles.sheetBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.sheetCard}>
            <Text style={styles.sheetTitle}>新建内容</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCreationMenuOpen(false);
                setFolderName('');
                setFormError(null);
                setCreating('file');
              }}
              style={styles.sheetAction}
            >
              <Text style={styles.sheetActionText}>新建文件</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCreationMenuOpen(false);
                setFolderName('');
                setFormError(null);
                setCreating('folder');
              }}
              style={styles.sheetAction}
            >
              <Text style={styles.sheetActionText}>新建文件夹</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setCreationMenuOpen(false)}
              style={[styles.sheetAction, styles.sheetCancel]}
            >
              <Text style={styles.sheetActionText}>取消</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setCreating(null)}
        transparent
        visible={creating !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{creating === 'file' ? '新建文件' : '新建文件夹'}</Text>
            <Text style={styles.label}>名字</Text>
            <TextInput
              autoFocus
              editable={!busy}
              onChangeText={setFolderName}
              placeholder={creating === 'file' ? '例如 README.md' : '例如 my-feature'}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={folderName}
            />
            {formError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {formError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setCreating(null)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !folderName.trim()}
                onPress={() => void submitCreate()}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (busy || !folderName.trim()) && styles.buttonDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.textOnBrand} size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>创建</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        onRequestClose={() => setPreview(null)}
        visible={Boolean(preview)}
      >
        <View style={styles.previewPage}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="关闭文件预览"
              accessibilityRole="button"
              onPress={() => setPreview(null)}
              style={styles.iconButton}
            >
              <Text style={styles.back}>‹</Text>
            </Pressable>
            <Text numberOfLines={1} style={styles.title}>
              {preview?.name ?? '文件'}
            </Text>
            <View style={styles.iconButton} />
          </View>
          {preview?.content === null ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>无法预览此文件</Text>
              <Text style={styles.emptyCopy}>
                {preview?.reason === 'too_large'
                  ? '文件超过 512 KB，已保留在工作区但不加载内容。'
                  : '这是二进制文件，不能作为文本展示。'}
              </Text>
            </View>
          ) : preview?.isMarkdown ? (
            <ScrollView
              contentContainerStyle={styles.previewMarkdown}
              style={styles.previewVerticalScroll}
            >
              <MarkdownMessage content={preview.content ?? ''} />
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={styles.previewScroll}
              style={styles.previewVerticalScroll}
            >
              <ScrollView horizontal>
                <Text selectable style={styles.previewCode}>
                  {preview?.content}
                </Text>
              </ScrollView>
            </ScrollView>
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name.trim());
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.background, flex: 1 },
  previewPage: { backgroundColor: colors.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 52,
  },
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  iconPressed: { backgroundColor: colors.surfacePressed },
  back: { color: colors.text, fontSize: 28, lineHeight: 32 },
  title: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  plus: { color: colors.text, fontSize: 27, lineHeight: 30 },
  loadingRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    flexDirection: 'row',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  loadingText: { color: colors.muted, fontSize: 14, marginLeft: spacing.sm },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 60,
    paddingHorizontal: spacing.control,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowIcon: { color: colors.text, fontSize: 18, marginRight: spacing.sm, width: 22 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowPath: { color: colors.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 22, marginLeft: spacing.sm },
  empty: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: 112 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
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
  sheetCancel: { marginTop: spacing.sm },
  modalCard: { backgroundColor: colors.background, borderRadius: 10, padding: spacing.lg },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.sm },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing.sm,
    marginTop: spacing.control,
  },
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
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: spacing.control },
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
  previewScroll: { padding: spacing.control },
  previewMarkdown: { padding: spacing.control },
  previewVerticalScroll: { flex: 1 },
  previewCode: {
    color: colors.text,
    fontFamily: Platform.select({ android: 'monospace', default: undefined }),
    fontSize: 13,
    lineHeight: 20,
  },
});
