import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { GATEWAY_URL } from '@/config/gateway';
import { useConnection } from '@/state/connection-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function ConnectionScreen() {
  const connection = useConnection();
  const [pairingCode, setPairingCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const busy = connection.phase === 'connecting';

  const submit = async () => {
    setFieldError(null);
    try {
      await connection.connect(pairingCode);
      setPairingCode('');
    } catch (error) {
      if (error instanceof Error && !('code' in error)) setFieldError(error.message);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.page}
    >
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.headerTitle}>
          连接服务器
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>服务器地址</Text>
        <Text selectable style={styles.address}>
          {GATEWAY_URL}
        </Text>
        <Text style={styles.label}>一次性配对码</Text>
        <TextInput
          editable={!busy}
          inputMode="numeric"
          maxLength={6}
          onChangeText={(value) => setPairingCode(value.replace(/\D/g, ''))}
          placeholder="输入服务器显示的 6 位配对码"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={pairingCode}
        />
        <Text style={styles.hint}>配对码 5 分钟内有效。设备令牌会安全保存在本机。</Text>
        {fieldError || connection.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {fieldError ?? connection.error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || pairingCode.length !== 6}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.button,
            (busy || pairingCode.length !== 6) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? <ActivityIndicator color={colors.textOnBrand} size="small" /> : null}
          <Text style={styles.buttonText}>{busy ? '配对中' : '安全配对'}</Text>
        </Pressable>
      </ScrollView>
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
    height: 48,
    justifyContent: 'center',
  },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  content: { padding: spacing.md, paddingBottom: 40 },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.control,
  },
  address: {
    backgroundColor: colors.mutedSurface,
    borderRadius: 6,
    color: colors.text,
    fontSize: 14,
    fontFamily: Platform.select({ android: 'monospace', default: undefined }),
    paddingHorizontal: spacing.control,
    paddingVertical: 12,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: spacing.control },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
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
});
