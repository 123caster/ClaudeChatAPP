import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { createRequestId } from '@/api/gateway-client';
import { ProjectPicker } from '@/components/ProjectPicker';
import { useConnection } from '@/state/connection-store';
import { useSessions } from '@/state/session-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function NewSessionScreen() {
  const connection = useConnection();
  const store = useSessions();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderParentId, setFolderParentId] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const requestId = useRef(createRequestId());
  const online = connection.phase === 'connected';

  useEffect(() => {
    if (store.projects.length === 1) setProjectId(store.projects[0]?.id ?? null);
  }, [store.projects]);

  const openFolderModal = () => {
    setFolderName('');
    setFolderParentId(projectId ?? store.projects[0]?.id ?? null);
    setFolderError(null);
    setCreatingProject(true);
  };

  const submitFolder = async () => {
    if (!folderName.trim() || !folderParentId || creatingProject) return;
    setBusy(true);
    setFolderError(null);
    try {
      const project = await store.createProject(
        folderName.trim(),
        folderParentId,
        folderName.trim(),
      );
      setProjectId(project.id);
      setCreatingProject(false);
    } catch {
      setFolderError('新建文件夹失败，请确认名称有效且不重名。');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!projectId || !message.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sessionId = await store.create(projectId, message, requestId.current);
      router.replace({ pathname: '/session/[sessionId]', params: { sessionId } });
    } catch {
      setError('创建失败，已保留你的任务内容。请恢复连接后重试。');
      requestId.current = createRequestId();
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>
          新建会话
        </Text>
        <View style={styles.iconButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!online ? <Text style={styles.warning}>电脑已离线，恢复连接后才能创建会话。</Text> : null}
        <Text style={styles.label}>项目</Text>
        {store.loading && store.projects.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.loadingText}>正在加载项目…</Text>
          </View>
        ) : store.projects.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>没有可用项目</Text>
            <Text style={styles.emptyCopy}>请在电脑上的 Gateway 配置中添加允许访问的项目。</Text>
          </View>
        ) : (
          <ProjectPicker onSelect={setProjectId} projects={store.projects} selectedId={projectId} />
        )}
        {store.projects.length > 0 && online ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={openFolderModal}
            style={({ pressed }) => [styles.folderButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.folderButtonText}>＋ 新建文件夹</Text>
          </Pressable>
        ) : null}
        <Text style={styles.label}>第一条任务</Text>
        <TextInput
          editable={!busy}
          multiline
          onChangeText={setMessage}
          placeholder="描述你想让 Claude 完成的任务"
          placeholderTextColor={colors.muted}
          style={styles.textarea}
          textAlignVertical="top"
          value={message}
        />
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!online || !projectId || !message.trim() || busy}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.button,
            (!online || !projectId || !message.trim() || busy) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? <ActivityIndicator color={colors.textOnBrand} size="small" /> : null}
          <Text style={styles.buttonText}>{busy ? '创建中' : '创建会话'}</Text>
        </Pressable>
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => setCreatingProject(false)}
        transparent
        visible={creatingProject}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>新建文件夹</Text>
            <Text style={styles.label}>文件夹名</Text>
            <TextInput
              autoFocus
              editable={!busy}
              onChangeText={setFolderName}
              placeholder="例如 my-project"
              placeholderTextColor={colors.muted}
              style={styles.textarea}
              value={folderName}
            />
            <Text style={styles.label}>父项目（根目录）</Text>
            <ScrollView style={styles.modalPicker} keyboardShouldPersistTaps="handled">
              {store.projects.map((project) => {
                const selected = project.id === folderParentId;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={project.id}
                    onPress={() => setFolderParentId(project.id)}
                    style={[styles.modalOption, selected && styles.modalOptionSelected]}
                  >
                    <Text style={styles.modalOptionText}>{project.displayName}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {folderError ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {folderError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setCreatingProject(false)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !folderName.trim() || !folderParentId}
                onPress={() => void submitFolder()}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (busy || !folderName.trim() || !folderParentId) && styles.buttonDisabled,
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
    </KeyboardAvoidingView>
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
  iconButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 48 },
  back: { color: colors.text, fontSize: 36, lineHeight: 38 },
  title: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  content: { padding: spacing.md, paddingBottom: 40 },
  warning: {
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.control,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing.sm,
    marginTop: spacing.section,
  },
  loadingRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  loadingText: { color: colors.muted, fontSize: 14, marginLeft: spacing.sm },
  emptyBox: { backgroundColor: colors.surface, padding: spacing.md },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  emptyCopy: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: spacing.xs },
  textarea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 132,
    padding: spacing.control,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: spacing.control },
  button: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { backgroundColor: colors.brandPressed },
  buttonText: {
    color: colors.textOnBrand,
    fontSize: 16,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },
  folderButton: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: 6,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    marginTop: spacing.control,
  },
  folderButtonText: { color: colors.brand, fontSize: 14, fontWeight: '600' },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.sm },
  modalPicker: { maxHeight: 180 },
  modalOption: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.control,
    paddingVertical: spacing.sm,
  },
  modalOptionSelected: { borderColor: colors.brand, borderWidth: 1.5 },
  modalOptionText: { color: colors.text, fontSize: 14 },
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
});
