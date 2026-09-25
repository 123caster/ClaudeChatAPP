import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { GatewayClient } from '@/api/gateway-client';
import { useConnection } from '@/state/connection-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function WorkingDirectoryPicker({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const connection = useConnection();
  const [visible, setVisible] = useState(false);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<Array<{ name: string; relativePath: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextPath: string) => {
    if (!connection.deviceToken) return;
    setLoading(true);
    setError(null);
    try {
      const next = await new GatewayClient(connection.gatewayUrl).listDirectoryAt(
        connection.deviceToken,
        projectId,
        nextPath,
      );
      setPath(nextPath);
      setEntries(next.filter((entry) => entry.isDirectory));
    } catch {
      setError('无法读取当前目录。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setVisible(true);
          void load(value ?? '');
        }}
        style={({ pressed }) => [styles.selector, pressed && styles.pressed]}
      >
        <View style={styles.selectorText}>
          <Text style={styles.selectorLabel}>工作目录</Text>
          <Text numberOfLines={1} style={styles.selectorValue}>
            {value ?? '项目根目录'}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Modal
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        transparent
        visible={visible}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Pressable
                accessibilityLabel="返回上级目录"
                disabled={!path || loading}
                onPress={() => {
                  const parts = path.split('/').filter(Boolean);
                  parts.pop();
                  void load(parts.join('/'));
                }}
                style={styles.iconButton}
              >
                <Text style={styles.icon}>‹</Text>
              </Pressable>
              <View style={styles.heading}>
                <Text style={styles.title}>选择工作目录</Text>
                <Text numberOfLines={1} style={styles.path}>
                  {path || '项目根目录'}
                </Text>
              </View>
              <Pressable onPress={() => setVisible(false)} style={styles.iconButton}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            </View>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <ScrollView style={styles.list}>
                {entries.map((entry) => (
                  <Pressable
                    key={entry.relativePath}
                    onPress={() => void load(entry.relativePath)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Text numberOfLines={1} style={styles.rowText}>
                      {entry.name}
                    </Text>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))}
                {!entries.length && !error ? (
                  <Text style={styles.empty}>当前目录没有子目录。</Text>
                ) : null}
              </ScrollView>
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              disabled={loading}
              onPress={() => {
                onChange(path || null);
                setVisible(false);
              }}
              style={[styles.confirm, loading && styles.disabled]}
            >
              <Text style={styles.confirmText}>{path ? '使用当前目录' : '使用项目根目录'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  selector: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingHorizontal: spacing.md,
  },
  selectorText: { flex: 1 },
  selectorLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  selectorValue: { color: colors.muted, fontSize: 12, marginTop: 3 },
  chevron: { color: colors.muted, fontSize: 24 },
  pressed: { backgroundColor: colors.surfacePressed },
  backdrop: { backgroundColor: colors.overlay, flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    maxHeight: '78%',
    padding: spacing.md,
  },
  header: { alignItems: 'center', flexDirection: 'row' },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  icon: { color: colors.text, fontSize: 34 },
  close: { color: colors.text, fontSize: 26 },
  heading: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  path: { color: colors.muted, fontSize: 12, marginTop: 3, textAlign: 'center' },
  loading: { alignItems: 'center', height: 220, justifyContent: 'center' },
  list: { minHeight: 180 },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: spacing.control,
  },
  rowText: { color: colors.text, flex: 1, fontSize: 15 },
  empty: { color: colors.muted, paddingVertical: spacing.xl, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, marginVertical: spacing.sm },
  confirm: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 6,
    height: 48,
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  confirmText: { color: colors.textOnBrand, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
