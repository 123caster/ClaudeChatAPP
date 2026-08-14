import type { SessionStatus as Status } from '@claude-chat/protocol';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

const labels: Partial<Record<Status, string>> = {
  running: '执行中',
  waiting_permission: '待审批',
  interrupted: '已中断',
  error: '出错',
};

type Props = { status: Status };

export function SessionStatus({ status }: Props) {
  const label = labels[status];
  if (!label) return null;
  const isDanger = status === 'waiting_permission' || status === 'error';
  return (
    <View style={styles.row}>
      <View style={[styles.dot, isDanger && styles.dangerDot]} />
      <Text style={[styles.label, isDanger && styles.dangerLabel]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row' },
  dot: { backgroundColor: colors.brand, borderRadius: 4, height: 7, marginRight: 4, width: 7 },
  dangerDot: { backgroundColor: colors.danger },
  label: { color: colors.brandPressed, fontSize: 12 },
  dangerLabel: { color: colors.danger },
});
