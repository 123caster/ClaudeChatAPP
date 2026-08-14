import { useEffect, useState } from 'react';
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

import { useConnection } from '@/state/connection-store';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function ConnectionScreen() {
  const connection = useConnection();
  const [gatewayUrl, setGatewayUrl] = useState(connection.gatewayUrl);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const busy = connection.phase === 'pairing';

  useEffect(() => {
    if (connection.gatewayUrl && !gatewayUrl) setGatewayUrl(connection.gatewayUrl);
  }, [connection.gatewayUrl, gatewayUrl]);

  const submit = async () => {
    setFieldError(null);
    try {
      await connection.pair(gatewayUrl, code);
      setCode('');
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
          连接电脑
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Gateway 地址</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          keyboardType="url"
          onChangeText={setGatewayUrl}
          placeholder="http://192.168.1.20:4310"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={gatewayUrl}
        />
        <Text style={styles.label}>配对码</Text>
        <TextInput
          editable={!busy}
          keyboardType="number-pad"
          maxLength={6}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          placeholder="电脑上显示的 6 位数字"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={code}
        />
        {fieldError || connection.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {fieldError ?? connection.error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy || !gatewayUrl.trim() || code.length !== 6}
          onPress={() => void submit()}
          style={({ pressed }) => [
            styles.button,
            (busy || !gatewayUrl.trim() || code.length !== 6) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? <ActivityIndicator color={colors.textOnBrand} size="small" /> : null}
          <Text style={styles.buttonText}>{busy ? '连接中' : '连接'}</Text>
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
});
