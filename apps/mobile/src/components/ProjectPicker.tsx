import type { ProjectSummary } from '@claude-chat/protocol';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type Props = {
  projects: ProjectSummary[];
  selectedId: string | null;
  onSelect: (projectId: string) => void;
};

export function ProjectPicker({ projects, selectedId, onSelect }: Props) {
  return (
    <View style={styles.list}>
      {projects.map((project) => {
        const selected = project.id === selectedId;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            key={project.id}
            onPress={() => onSelect(project.id)}
            style={({ pressed }) => [styles.option, pressed && styles.pressed]}
          >
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <View style={styles.radioCenter} /> : null}
            </View>
            <View style={styles.copy}>
              <Text numberOfLines={1} style={styles.name}>
                {project.displayName}
              </Text>
              <Text numberOfLines={1} style={styles.path}>
                {project.rootPath}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 64,
    paddingHorizontal: spacing.md,
  },
  pressed: { backgroundColor: colors.surfacePressed },
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
  copy: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 15, fontWeight: '500' },
  path: { color: colors.muted, fontSize: 12, marginTop: 4 },
});
