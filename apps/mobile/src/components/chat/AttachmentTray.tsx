import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ComposerAttachment } from '@/state/attachment-upload-queue';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type AttachmentTrayProps = {
  items: ComposerAttachment[];
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
};

export function formatAttachmentSize(size: number): string {
  if (size <= 0) return '大小未知';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function AttachmentTray({ items, onRemove, onRetry }: AttachmentTrayProps) {
  if (items.length === 0) return null;
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.tray}
    >
      {items.map((item) => (
        <View key={item.localId} style={item.kind === 'image' ? styles.imageTile : styles.fileTile}>
          {item.kind === 'image' ? (
            <Image contentFit="cover" source={{ uri: item.uri }} style={styles.preview} />
          ) : (
            <>
              <View style={styles.fileGlyph}>
                <SymbolView
                  fallback={<Text>文</Text>}
                  name={{ ios: 'doc.text', android: 'description' }}
                  size={20}
                  tintColor={colors.info}
                />
              </View>
              <View style={styles.fileCopy}>
                <Text numberOfLines={1} style={styles.fileName}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={styles.fileMeta}>
                  {item.status === 'failed'
                    ? '上传失败'
                    : item.status === 'ready'
                      ? formatAttachmentSize(item.size)
                      : `上传 ${Math.round(item.progress * 100)}%`}
                </Text>
              </View>
            </>
          )}
          {item.status === 'uploading' || item.status === 'queued' ? (
            <View style={styles.progressOverlay}>
              <Text style={styles.progressText}>{Math.round(item.progress * 100)}%</Text>
            </View>
          ) : null}
          {item.status === 'failed' ? (
            <Pressable
              accessibilityLabel={`重试上传 ${item.name}`}
              accessibilityRole="button"
              onPress={() => onRetry(item.localId)}
              style={styles.retry}
            >
              <SymbolView
                fallback={<Text style={styles.retryText}>重试</Text>}
                name={{ ios: 'arrow.clockwise', android: 'refresh' }}
                size={19}
                tintColor={colors.danger}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={`移除 ${item.name}`}
            accessibilityRole="button"
            onPress={() => onRemove(item.localId)}
            style={styles.remove}
          >
            <SymbolView
              fallback={<Text style={styles.removeText}>×</Text>}
              name={{ ios: 'xmark', android: 'close' }}
              size={13}
              tintColor={colors.surface}
            />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tray: { marginBottom: spacing.xs, maxHeight: 76 },
  content: { gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.sm },
  imageTile: {
    backgroundColor: colors.mutedSurface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 64,
    overflow: 'hidden',
    width: 64,
  },
  preview: { height: '100%', width: '100%' },
  fileTile: {
    alignItems: 'center',
    backgroundColor: '#F8FAFA',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 64,
    paddingHorizontal: spacing.sm,
    width: 174,
  },
  fileGlyph: {
    alignItems: 'center',
    backgroundColor: '#EAF0F2',
    borderRadius: 6,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  fileCopy: { flex: 1, marginLeft: spacing.sm, paddingRight: spacing.sm },
  fileName: { color: colors.text, fontSize: 12, fontWeight: '600' },
  fileMeta: { color: colors.muted, fontSize: 10, marginTop: 3 },
  progressOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(21, 26, 30, 0.56)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  progressText: { color: colors.surface, fontSize: 11, fontWeight: '600' },
  retry: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  retryText: { color: colors.danger, fontSize: 11, fontWeight: '600' },
  remove: {
    alignItems: 'center',
    backgroundColor: 'rgba(21, 26, 30, 0.78)',
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 3,
    top: 3,
    width: 20,
  },
  removeText: { color: colors.surface, fontSize: 15, lineHeight: 16 },
});
