import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type Tab = 'sessions' | 'scheduled' | 'workspace' | 'models' | 'mode';

const TABS: ReadonlyArray<{ icon: string; label: string; route: string; value: Tab }> = [
  { icon: '◌', label: '会话', route: '/', value: 'sessions' },
  { icon: '◷', label: '任务', route: '/scheduled', value: 'scheduled' },
  { icon: '⌘', label: '工作区', route: '/workspace', value: 'workspace' },
  { icon: '◇', label: '模型', route: '/models', value: 'models' },
  { icon: '◉', label: '模式', route: '/mode', value: 'mode' },
];

export function AppTabBar({ active }: { active: Tab }) {
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const selected = tab.value === active;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.value}
            onPress={() => !selected && router.replace(tab.route as '/')}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
          >
            <Text style={[styles.icon, selected && styles.selected]}>{tab.icon}</Text>
            <Text style={[styles.label, selected && styles.selected]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 72,
    paddingBottom: 8,
    paddingTop: 7,
  },
  tab: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  pressed: { backgroundColor: colors.surfacePressed },
  icon: { color: colors.muted, fontSize: 18, lineHeight: 21 },
  label: { color: colors.muted, fontSize: 10, marginTop: 2 },
  selected: { color: colors.brand },
});
