import { PROTOCOL_VERSION } from '@claude-chat/protocol';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function BootstrapScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Claude
        </Text>
      </View>
      <View style={styles.content}>
        <View accessibilityLabel="Gateway status" style={styles.statusRow}>
          <View style={styles.statusDot} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>本机 Gateway 尚未连接</Text>
            <Text style={styles.statusMessage}>连接与配对将在下一阶段启用</Text>
          </View>
        </View>
        <Text style={styles.protocol}>协议版本 {PROTOCOL_VERSION}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  statusDot: {
    backgroundColor: colors.muted,
    borderRadius: 6,
    height: 12,
    marginRight: spacing.md,
    width: 12,
  },
  statusCopy: {
    flexShrink: 1,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  statusMessage: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  protocol: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
