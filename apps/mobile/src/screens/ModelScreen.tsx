import type { ModelSummary } from '@claude-chat/protocol';
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
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { connectionErrorMessage } from '@/api/gateway-client';
import { useModels } from '@/state/model-store';
import { MODEL_PRESETS } from '@/constants/model-presets';
import { AppTabBar } from '@/components/AppTabBar';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function ModelScreen() {
  const store = useModels();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [supportsImages, setSupportsImages] = useState(false);
  const [supportsDocuments, setSupportsDocuments] = useState(false);
  const [isMultimodalDefault, setIsMultimodalDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [presetProvider, setPresetProvider] = useState<string | null>(null);
  const [variantSource, setVariantSource] = useState<{
    id: string;
    name: string;
    model: string;
  } | null>(null);
  const [variantModels, setVariantModels] = useState('');
  const [showVariantSources, setShowVariantSources] = useState(false);
  const [editing, setEditing] = useState<ModelSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editSupportsImages, setEditSupportsImages] = useState(false);
  const [editSupportsDocuments, setEditSupportsDocuments] = useState(false);
  const [editIsMultimodalDefault, setEditIsMultimodalDefault] = useState(false);

  const openAdd = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setSupportsImages(false);
    setSupportsDocuments(false);
    setIsMultimodalDefault(false);
    setFormError(null);
    setShowPresets(false);
    setPresetProvider(null);
    setAdding(true);
  };

  const applyPreset = (baseUrlValue: string, modelValue: string) => {
    setBaseUrl((current) => (current.trim() ? current : baseUrlValue));
    setModel(modelValue);
    setShowPresets(false);
    setPresetProvider(null);
  };

  const submitAdd = async () => {
    const modelNames = parseModelNames(model);
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim() || modelNames.length === 0 || busy)
      return;
    setBusy(true);
    setFormError(null);
    try {
      const first = await store.createModel(name, baseUrl, apiKey, modelNames[0]!, {
        supportsImages,
        supportsDocuments,
        isMultimodalDefault: supportsImages && isMultimodalDefault,
      });
      if (modelNames.length > 1) {
        await store.createVariants(first.id, modelNames.slice(1));
      }
      setAdding(false);
    } catch {
      setFormError('新增失败，请确认请求地址和密钥有效。');
    } finally {
      setBusy(false);
    }
  };

  const switchModel = (modelId: string) => {
    void store.setActive(modelId).catch(() => Alert.alert('切换失败', '请恢复连接后重试。'));
  };

  const parseModelNames = (value: string): string[] => [
    ...new Set(
      value
        .split(/[\n,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  const openVariant = (id: string, nameValue: string, modelValue: string) => {
    setVariantSource({ id, name: nameValue, model: modelValue });
    setVariantModels('');
    setShowVariantSources(false);
    setFormError(null);
  };

  const openEdit = (item: ModelSummary) => {
    setEditing(item);
    setEditName(item.name);
    setEditBaseUrl(item.baseUrl);
    setEditApiKey('');
    setEditModel(item.model);
    setEditSupportsImages(Boolean(item.supportsImages));
    setEditSupportsDocuments(Boolean(item.supportsDocuments));
    setEditIsMultimodalDefault(Boolean(item.isMultimodalDefault));
    setFormError(null);
  };

  const confirmDelete = (item: ModelSummary) => {
    Alert.alert('模型设置', `管理“${item.name}”`, [
      { text: '取消', style: 'cancel' },
      {
        text: '新增同 API 模型',
        onPress: () => {
          openVariant(item.id, item.name, item.model);
        },
      },
      ...(item.supportsImages && !item.isMultimodalDefault
        ? [
            {
              text: '设为默认图片识别',
              onPress: () => {
                void store
                  .setMultimodalDefault(item.id)
                  .catch((error) => Alert.alert('设置失败', connectionErrorMessage(error)));
              },
            },
          ]
        : []),
      { text: '编辑', onPress: () => openEdit(item) },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void store
            .remove(item.id)
            .catch((error) => Alert.alert('删除失败', connectionErrorMessage(error)));
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
            <Text style={styles.emptyCopy}>{store.error ?? '点击右上角 ＋，添加一个模型'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              accessibilityLabel={`切换模型到 ${item.name}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: item.isActive }}
              onPress={() => switchModel(item.id)}
              style={({ pressed }) => [styles.rowSelect, pressed && styles.rowPressed]}
            >
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.rowName}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={styles.rowModel}>
                  {item.model} · {item.baseUrl}
                </Text>
                {item.supportsImages || item.supportsDocuments || item.isMultimodalDefault ? (
                  <View style={styles.capabilityTags}>
                    {item.supportsImages ? <Text style={styles.capabilityTag}>图片</Text> : null}
                    {item.supportsDocuments ? <Text style={styles.capabilityTag}>文档</Text> : null}
                    {item.isMultimodalDefault ? (
                      <Text style={styles.defaultTag}>默认图片识别</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              {item.isActive ? <Text style={styles.activeTag}>当前</Text> : null}
            </Pressable>
            <Pressable
              accessibilityLabel={`管理 ${item.name}`}
              accessibilityRole="button"
              onPress={() => confirmDelete(item)}
              style={({ pressed }) => [styles.manageButton, pressed && styles.iconPressed]}
            >
              <Text style={styles.manageGlyph}>···</Text>
            </Pressable>
          </View>
        )}
      />
      <AppTabBar active="models" />
      <Modal
        animationType="fade"
        onRequestClose={() => setAdding(false)}
        transparent
        visible={adding}
      >
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
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowPresets((v) => !v)}
              style={({ pressed }) => [styles.presetToggle, pressed && styles.presetTogglePressed]}
            >
              <Text style={styles.presetToggleText}>
                {showPresets ? '收起预设' : '从预设选择（厂商 / 模型）'}
              </Text>
            </Pressable>
            {showPresets ? (
              <View style={styles.presetPanel}>
                {presetProvider === null ? (
                  <>
                    <Text style={styles.presetHint}>选择厂商</Text>
                    {MODEL_PRESETS.map((preset) => (
                      <Pressable
                        accessibilityRole="button"
                        key={preset.provider}
                        onPress={() => setPresetProvider(preset.provider)}
                        style={({ pressed }) => [
                          styles.presetOption,
                          pressed && styles.presetOptionPressed,
                        ]}
                      >
                        <Text style={styles.presetOptionText}>{preset.provider}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setPresetProvider(null)}
                      style={({ pressed }) => [
                        styles.presetBack,
                        pressed && styles.presetOptionPressed,
                      ]}
                    >
                      <Text style={styles.presetBackText}>‹ 返回厂商</Text>
                    </Pressable>
                    {MODEL_PRESETS.find((p) => p.provider === presetProvider)?.models.map((m) => (
                      <Pressable
                        accessibilityRole="button"
                        key={m}
                        onPress={() =>
                          applyPreset(
                            MODEL_PRESETS.find((p) => p.provider === presetProvider)?.baseUrl ?? '',
                            m,
                          )
                        }
                        style={({ pressed }) => [
                          styles.presetOption,
                          pressed && styles.presetOptionPressed,
                        ]}
                      >
                        <Text style={styles.presetOptionText}>{m}</Text>
                      </Pressable>
                    ))}
                  </>
                )}
              </View>
            ) : null}
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
            <Text style={styles.label}>模型名（可一次输入多个）</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              multiline
              onChangeText={setModel}
              placeholder={'deepseek-v4-flash\n每行一个，也可用逗号分隔'}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={model}
            />
            <CapabilityControls
              isDefault={isMultimodalDefault}
              onChangeDefault={setIsMultimodalDefault}
              onChangeDocuments={setSupportsDocuments}
              onChangeImages={(value) => {
                setSupportsImages(value);
                if (!value) setIsMultimodalDefault(false);
              }}
              supportsDocuments={supportsDocuments}
              supportsImages={supportsImages}
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
                disabled={
                  busy ||
                  !name.trim() ||
                  !baseUrl.trim() ||
                  !apiKey.trim() ||
                  parseModelNames(model).length === 0
                }
                onPress={() => void submitAdd()}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (busy ||
                    !name.trim() ||
                    !baseUrl.trim() ||
                    !apiKey.trim() ||
                    parseModelNames(model).length === 0) &&
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
      <Modal
        animationType="fade"
        onRequestClose={() => setVariantSource(null)}
        transparent
        visible={variantSource !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>新增同 API 模型</Text>
            <Text style={styles.variantHint}>
              复用“{variantSource?.name}”的请求地址和 API Key，可一次添加多个模型。
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowVariantSources((value) => !value)}
              style={({ pressed }) => [styles.presetToggle, pressed && styles.presetTogglePressed]}
            >
              <Text style={styles.presetToggleText}>选择已有 API 配置</Text>
            </Pressable>
            {showVariantSources ? (
              <View style={styles.presetPanel}>
                {store.models.map((item) => (
                  <Pressable
                    accessibilityRole="button"
                    key={item.id}
                    onPress={() => {
                      setVariantSource({ id: item.id, name: item.name, model: item.model });
                      setShowVariantSources(false);
                    }}
                    style={({ pressed }) => [
                      styles.presetOption,
                      pressed && styles.presetOptionPressed,
                    ]}
                  >
                    <Text style={styles.presetOptionText}>
                      {item.name} · {item.model}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.label}>模型名</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              multiline
              onChangeText={setVariantModels}
              placeholder={'例如 deepseek-reasoner\n每行一个，也可用逗号分隔'}
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={variantModels}
            />
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setVariantSource(null)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || parseModelNames(variantModels).length === 0 || !variantSource}
                onPress={() => {
                  const names = parseModelNames(variantModels);
                  if (!variantSource || names.length === 0) return;
                  setBusy(true);
                  setFormError(null);
                  void store
                    .createVariants(variantSource.id, names)
                    .then(() => setVariantSource(null))
                    .catch(() => setFormError('新增失败，请恢复连接后重试。'))
                    .finally(() => setBusy(false));
                }}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (busy || parseModelNames(variantModels).length === 0 || !variantSource) &&
                    styles.buttonDisabled,
                ]}
              >
                <Text style={styles.modalConfirmText}>保存</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setEditing(null)}
        transparent
        visible={editing !== null}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>编辑模型</Text>
            <Text style={styles.label}>名称</Text>
            <TextInput
              editable={!busy}
              onChangeText={setEditName}
              style={styles.input}
              value={editName}
            />
            <Text style={styles.label}>请求地址</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              keyboardType="url"
              onChangeText={setEditBaseUrl}
              style={styles.input}
              value={editBaseUrl}
            />
            <Text style={styles.label}>模型名</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setEditModel}
              style={styles.input}
              value={editModel}
            />
            <Text style={styles.label}>API Key（留空则不修改）</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              onChangeText={setEditApiKey}
              placeholder="不显示当前密钥"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={editApiKey}
            />
            <CapabilityControls
              isDefault={editIsMultimodalDefault}
              onChangeDefault={setEditIsMultimodalDefault}
              onChangeDocuments={setEditSupportsDocuments}
              onChangeImages={(value) => {
                setEditSupportsImages(value);
                if (!value) setEditIsMultimodalDefault(false);
              }}
              supportsDocuments={editSupportsDocuments}
              supportsImages={editSupportsImages}
            />
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setEditing(null)}
                style={[styles.modalButton, styles.modalCancel]}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={
                  busy || !editing || !editName.trim() || !editBaseUrl.trim() || !editModel.trim()
                }
                onPress={() => {
                  if (!editing) return;
                  setBusy(true);
                  setFormError(null);
                  void store
                    .update(editing.id, {
                      name: editName.trim(),
                      baseUrl: editBaseUrl.trim(),
                      model: editModel.trim(),
                      ...(editApiKey.trim() ? { apiKey: editApiKey.trim() } : {}),
                      supportsImages: editSupportsImages,
                      supportsDocuments: editSupportsDocuments,
                      isMultimodalDefault: editSupportsImages && editIsMultimodalDefault,
                    })
                    .then(() => setEditing(null))
                    .catch(() => setFormError('保存失败，请检查 Gateway 连接或填写内容。'))
                    .finally(() => setBusy(false));
                }}
                style={[
                  styles.modalButton,
                  styles.modalConfirm,
                  (busy ||
                    !editing ||
                    !editName.trim() ||
                    !editBaseUrl.trim() ||
                    !editModel.trim()) &&
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

function CapabilityControls({
  isDefault,
  onChangeDefault,
  onChangeDocuments,
  onChangeImages,
  supportsDocuments,
  supportsImages,
}: {
  isDefault: boolean;
  onChangeDefault: (value: boolean) => void;
  onChangeDocuments: (value: boolean) => void;
  onChangeImages: (value: boolean) => void;
  supportsDocuments: boolean;
  supportsImages: boolean;
}) {
  return (
    <View style={styles.capabilityGroup}>
      <View style={styles.capabilityRow}>
        <View style={styles.capabilityCopy}>
          <Text style={styles.capabilityTitle}>支持图片</Text>
          <Text style={styles.capabilityHint}>模型本身可直接理解图片</Text>
        </View>
        <Switch
          accessibilityLabel="支持图片"
          onValueChange={onChangeImages}
          trackColor={{ false: colors.border, true: colors.brandPressed }}
          value={supportsImages}
        />
      </View>
      <View style={styles.capabilityRow}>
        <View style={styles.capabilityCopy}>
          <Text style={styles.capabilityTitle}>支持文档</Text>
          <Text style={styles.capabilityHint}>模型可直接读取 PDF 文档</Text>
        </View>
        <Switch
          accessibilityLabel="支持文档"
          onValueChange={onChangeDocuments}
          trackColor={{ false: colors.border, true: colors.brandPressed }}
          value={supportsDocuments}
        />
      </View>
      <View style={styles.capabilityRow}>
        <View style={styles.capabilityCopy}>
          <Text style={styles.capabilityTitle}>默认图片识别模型</Text>
          <Text style={styles.capabilityHint}>原会话模型不支持图片时使用</Text>
        </View>
        <Switch
          accessibilityLabel="默认图片识别模型"
          disabled={!supportsImages}
          onValueChange={onChangeDefault}
          trackColor={{ false: colors.border, true: colors.brandPressed }}
          value={supportsImages && isDefault}
        />
      </View>
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
  rowSelect: { alignItems: 'center', flex: 1, flexDirection: 'row', minHeight: 64 },
  rowText: { flex: 1, marginRight: spacing.sm },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowModel: { color: colors.muted, fontSize: 12, marginTop: 2 },
  capabilityTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 5 },
  capabilityTag: {
    backgroundColor: '#EEF3F4',
    borderRadius: 4,
    color: colors.info,
    fontSize: 10,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  defaultTag: {
    backgroundColor: '#E7F3EF',
    borderRadius: 4,
    color: colors.brand,
    fontSize: 10,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  activeTag: { color: colors.brand, fontSize: 13, fontWeight: '600' },
  manageButton: { alignItems: 'center', height: 48, justifyContent: 'center', width: 42 },
  manageGlyph: { color: colors.muted, fontSize: 20, lineHeight: 20, paddingBottom: 7 },
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
  capabilityGroup: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.control,
    overflow: 'hidden',
  },
  capabilityRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: spacing.control,
  },
  capabilityCopy: { flex: 1, paddingRight: spacing.sm },
  capabilityTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  capabilityHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: spacing.control },
  variantHint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
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
  presetToggle: {
    alignItems: 'center',
    borderRadius: 6,
    borderColor: colors.brand,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    marginTop: spacing.control,
  },
  presetTogglePressed: { backgroundColor: colors.surfacePressed },
  presetToggleText: { color: colors.brand, fontSize: 14, fontWeight: '600' },
  presetPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxHeight: 200,
  },
  presetHint: {
    color: colors.muted,
    fontSize: 12,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.control,
    paddingTop: spacing.sm,
  },
  presetOption: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.control,
  },
  presetOptionPressed: { backgroundColor: colors.surfacePressed },
  presetOptionText: { color: colors.text, fontSize: 14 },
  presetBack: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.control,
  },
  presetBackText: { color: colors.brand, fontSize: 14, fontWeight: '500' },
});
