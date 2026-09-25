import type { PermissionMode } from '@claude-chat/protocol';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useMode } from '@/state/mode-store';
import { AppTabBar } from '@/components/AppTabBar';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

const MODES: { value: PermissionMode; label: string; description: string }[] = [
  {
    value: 'default',
    label: '普通模式',
    description: '每个危险操作都需要手动授权（推荐）',
  },
  {
    value: 'acceptEdits',
    label: '编辑模式',
    description: '自动接受文件编辑，其余操作仍需授权',
  },
  {
    value: 'plan',
    label: '计划模式',
    description: '只做规划，不执行任何工具',
  },
  {
    value: 'bypassPermissions',
    label: '自动模式',
    description: '跳过所有授权，全自动执行（高危）',
  },
];

export function ModeScreen() {
  const store = useMode();
  const [switching, setSwitching] = useState<PermissionMode | null>(null);

  const switchMode = (value: PermissionMode) => {
    setSwitching(value);
    void store
      .setMode(value)
      .catch(() => {})
      .finally(() => setSwitching(null));
  };

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
        <Text accessibilityRole="header" style={styles.title}>
          权限模式
        </Text>
        <View style={styles.iconButton} />
      </View>
      {store.loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>正在加载…</Text>
        </View>
      ) : (
        <FlatList
          data={MODES}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => {
            const selected = item.value === store.mode;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => switchMode(item.value)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioCenter} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{item.label}</Text>
                  <Text style={styles.rowDesc}>{item.description}</Text>
                </View>
                {switching === item.value ? (
                  <ActivityIndicator color={colors.brand} size="small" />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
      {store.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {store.error}
        </Text>
      ) : null}
      <AppTabBar active="mode" />
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
  back: { color: colors.text, fontSize: 36, lineHeight: 38 },
  title: { color: colors.text, flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
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
    minHeight: 64,
    paddingHorizontal: spacing.control,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  radio: {
    alignItems: 'center',
    borderColor: colors.muted,
    borderRadius: 10,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    marginRight: spacing.control,
    width: 20,
  },
  radioSelected: { borderColor: colors.brand },
  radioCenter: { backgroundColor: colors.brand, borderRadius: 5, height: 10, width: 10 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowDesc: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, padding: spacing.md },
});
