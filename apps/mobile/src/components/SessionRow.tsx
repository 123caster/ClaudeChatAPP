import type { SessionSummary } from '@claude-chat/protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SessionStatus } from '@/components/SessionStatus';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type Props = {
  session: SessionSummary;
  onPress: () => void;
  onLongPress: () => void;
};

function displayTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function SessionRow({ session, onPress, onLongPress }: Props) {
  return (
    <Pressable
      accessibilityHint="长按可归档"
      accessibilityRole="button"
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>C</Text>
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>
          {session.title}
        </Text>
        <Text numberOfLines={1} style={styles.preview}>
          {session.lastMessagePreview ?? session.projectDisplayName}
        </Text>
      </View>
      <View style={styles.meta}>
        <Text style={styles.time}>{displayTime(session.updatedAt)}</Text>
        <SessionStatus status={session.status} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 76,
    paddingHorizontal: spacing.md,
  },
  pressed: { backgroundColor: colors.surfacePressed },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 4,
    height: 44,
    justifyContent: 'center',
    marginRight: spacing.control,
    width: 44,
  },
  avatarText: { color: colors.textOnBrand, fontSize: 21, fontWeight: '700' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: '500' },
  preview: { color: colors.muted, fontSize: 13, marginTop: 5 },
  meta: {
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    justifyContent: 'space-around',
    marginLeft: 8,
    maxWidth: 72,
    paddingVertical: 9,
  },
  time: { color: colors.muted, fontSize: 12 },
});
