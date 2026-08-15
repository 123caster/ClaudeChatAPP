import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { useModels } from '@/state/model-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function ModelScreen() {
  const store = useModels();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const openAdd = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setFormError(null);
    setAdding(true);
  };

  const submitAdd = async () => {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      await store.createModel(name, baseUrl, apiKey, model);
      setAdding(false);
    } catch {
      setFormError('新增失败，请确认请求地址和密钥有效。');
    } finally {
      setBusy(false);
    }
  };

  const switchModel = (modelId: string) => {
    void store
      .setActive(modelId)
      .catch(() => Alert.alert('切换失败', '请恢复连接后重试。'));
  };

  const confirmDelete = (id: string, nameValue: string) => {
    Alert.alert('删除模型', `删除“${nameValue}”？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void store.remove(id).catch(() => Alert.alert('删除失败', '请恢复连接后重试。'));
        },
      },
    ]);
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
          模型
        </Text>
        <Pressable
          accessibilityLabel="新增模型"
          accessibilityRole="button"
          onPress={openAdd}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
        >
          <Text style={styles.plus}>＋</Text>
        </Pressable>
      </View>
      <FlatList
        data={store.models}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{store.error ? '无法加载模型' : '暂无模型'}</Text>
            <Text style={styles.emptyCopy}>
              {store.error ?? '点击右上角 ＋，添加一个模型'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`切换模型到 ${item.name}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: item.isActive }}
            onLongPress={() => confirmDelete(item.id, item.name)}
            onPress={() => switchModel(item.id)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowName}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={styles.rowModel}>
                {item.model} · {item.baseUrl}
              </Text>
            </View>
            {item.isActive ? <Text style={styles.activeTag}>当前</Text> : null}
          </Pressable>
        )}
      />
      <Modal animationType="fade" onRequestClose={() => setAdding(false)} transparent visible={adding}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>新增模型</Text>
            <Text style={styles.label}>名称</Text>
            <TextInput
              autoFocus
              editable={!busy}
              onChangeText={setName}
              placeholder="例如 DeepSeek"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={name}
            />
            <Text style={styles.label}>请求地址</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              keyboardType="url"
              onChangeText={setBaseUrl}
              placeholder="https://api.deepseek.com/anthropic"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={baseUrl}
            />
            <Text style={styles.label}>API Key</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setApiKey}
              placeholder="sk-..."
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={apiKey}
            />
            <Text style={styles.label}>模型名</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setModel}
              placeholder="deepseek-v4-flash"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={model}
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
                onPress={() => setAdding(false)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim()}
                onPress={() => void submitAdd()}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (busy || !name.trim() || !baseUrl.trim() || !apiKey.trim() || !model.trim()) &&
                    styles.buttonDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.textOnBrand} size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>保存</Text>
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
  iconPressed: { backgroundColor: colors.surfacePressed },
  back: { color: colors.text, fontSize: 36, lineHeight: 38 },
  title: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  plus: { color: colors.text, fontSize: 27, lineHeight: 30 },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.control,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowText: { flex: 1, marginRight: spacing.sm },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowModel: { color: colors.muted, fontSize: 12, marginTop: 2 },
  activeTag: { color: colors.brand, fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: 112 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  emptyCopy: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm, textAlign: 'center' },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
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
});
