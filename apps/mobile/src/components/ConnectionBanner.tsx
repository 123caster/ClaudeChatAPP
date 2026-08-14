import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type Props = {
  state: 'connecting' | 'offline';
};

export function ConnectionBanner({ state }: Props) {
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <View style={[styles.dot, state === 'offline' && styles.offlineDot]} />
      <Text style={styles.text}>
        {state === 'connecting' ? '正在连接电脑…' : '电脑已离线，正在重新连接'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: colors.mutedSurface,
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  dot: {
    backgroundColor: colors.warning,
    borderRadius: 4,
    height: 8,
    marginRight: spacing.sm,
    width: 8,
  },
  offlineDot: { backgroundColor: colors.danger },
  text: { color: colors.text, flex: 1, fontSize: 13 },
});
