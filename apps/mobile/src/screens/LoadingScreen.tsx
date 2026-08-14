import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

export function LoadingScreen() {
  return (
    <View style={styles.page}>
      <ActivityIndicator color={colors.brand} size="small" />
      <Text style={styles.text}>正在恢复连接…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  text: { color: colors.muted, fontSize: 14, marginLeft: spacing.sm },
});
