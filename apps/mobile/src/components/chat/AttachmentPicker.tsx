import * as DocumentPicker from 'expo-document-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { createEntityId } from '@/api/gateway-client';
import type { AttachmentCandidate } from '@/state/attachment-upload-queue';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type AttachmentPickerProps = {
  disabled: boolean;
  remaining: number;
  onPicked: (items: AttachmentCandidate[]) => void;
  onError: (message: string) => void;
};

const imageMimeByExtension: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const documentMimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  json: 'application/json',
  csv: 'text/csv',
  md: 'text/markdown',
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function AttachmentPicker({
  disabled,
  remaining,
  onPicked,
  onError,
}: AttachmentPickerProps) {
  const [open, setOpen] = useState(false);

  const pickImages = async () => {
    setOpen(false);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onError('需要相册权限才能选择图片。');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, remaining),
        quality: 1,
      });
      if (result.canceled) return;
      const candidates = await Promise.all(
        result.assets.slice(0, remaining).map(async (asset, index) => {
          const originalName = asset.fileName ?? `图片-${Date.now()}-${index + 1}.jpg`;
          const originalExtension = extensionOf(originalName);
          const supportedMime = imageMimeByExtension[originalExtension];
          if (supportedMime) {
            return {
              localId: createEntityId(),
              uri: asset.uri,
              name: originalName,
              mimeType: supportedMime,
              size: asset.fileSize ?? 0,
              kind: 'image' as const,
            };
          }
          const converted = await manipulateAsync(asset.uri, [], {
            compress: 0.92,
            format: SaveFormat.JPEG,
          });
          return {
            localId: createEntityId(),
            uri: converted.uri,
            name: `${withoutExtension(originalName)}.jpg`,
            mimeType: 'image/jpeg',
            size: asset.fileSize ?? 0,
            kind: 'image' as const,
          };
        }),
      );
      onPicked(candidates);
    } catch {
      onError('读取相册失败，请稍后重试。');
    }
  };

  const pickDocuments = async () => {
    setOpen(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      onPicked(
        result.assets.slice(0, remaining).map((asset) => {
          const extension = extensionOf(asset.name);
          return {
            localId: createEntityId(),
            uri: asset.uri,
            name: asset.name,
            mimeType: asset.mimeType ?? documentMimeByExtension[extension] ?? 'text/plain',
            size: asset.size ?? 0,
            kind: 'document' as const,
          };
        }),
      );
    } catch {
      onError('读取文件失败，请稍后重试。');
    }
  };

  return (
    <>
      <Pressable
        accessibilityLabel="添加图片或文件"
        accessibilityRole="button"
        disabled={disabled || remaining <= 0}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.iconButton,
          (disabled || remaining <= 0) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          fallback={<Text style={styles.fallback}>+</Text>}
          name={{ ios: 'plus', android: 'add' }}
          size={24}
          tintColor={colors.text}
        />
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <Pressable onPress={() => setOpen(false)} style={styles.backdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>添加到本次提问</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void pickImages()}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={[styles.optionIcon, styles.imageIcon]}>
                <SymbolView
                  fallback={<Text>图</Text>}
                  name={{ ios: 'photo', android: 'image' }}
                  size={22}
                  tintColor={colors.brand}
                />
              </View>
              <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>从相册选择</Text>
                <Text style={styles.optionHint}>可多选图片，最多共 9 个附件</Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void pickDocuments()}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={[styles.optionIcon, styles.fileIcon]}>
                <SymbolView
                  fallback={<Text>文</Text>}
                  name={{ ios: 'doc', android: 'description' }}
                  size={22}
                  tintColor={colors.info}
                />
              </View>
              <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>选择文件</Text>
                <Text style={styles.optionHint}>文档、表格、演示文稿、代码与文本</Text>
              </View>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.55 },
  fallback: { color: colors.text, fontSize: 28, lineHeight: 30 },
  backdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    marginBottom: spacing.lg,
    width: 38,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '600', marginBottom: spacing.md },
  option: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 74,
  },
  optionPressed: { opacity: 0.62 },
  optionIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
    marginRight: spacing.control,
    width: 42,
  },
  imageIcon: { backgroundColor: '#EAF5F1' },
  fileIcon: { backgroundColor: '#EEF3F6' },
  optionCopy: { flex: 1 },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  optionHint: { color: colors.muted, fontSize: 12, marginTop: 3 },
});
