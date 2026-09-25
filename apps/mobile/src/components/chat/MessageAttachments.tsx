import type { AttachmentSummary } from '@claude-chat/protocol';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { GatewayClient } from '@/api/gateway-client';
import { formatAttachmentSize } from '@/components/chat/AttachmentTray';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type MessageAttachmentsProps = {
  attachments?: AttachmentSummary[];
  apiKey: string;
  client: GatewayClient;
};

export function MessageAttachments({ attachments, apiKey, client }: MessageAttachmentsProps) {
  const [failedImageIds, setFailedImageIds] = useState<Record<string, boolean>>({});
  const [retryVersions, setRetryVersions] = useState<Record<string, number>>({});
  const [previewImage, setPreviewImage] = useState<AttachmentSummary | null>(null);

  if (!attachments?.length) return null;
  const images = attachments.filter((item) => item.kind === 'image');
  const documents = attachments.filter((item) => item.kind === 'document');

  const retryImage = (attachmentId: string) => {
    setFailedImageIds((current) => ({ ...current, [attachmentId]: false }));
    setRetryVersions((current) => ({
      ...current,
      [attachmentId]: (current[attachmentId] ?? 0) + 1,
    }));
  };

  return (
    <>
      <View style={styles.container}>
        {images.length ? (
          <View style={images.length === 1 ? styles.singleImage : styles.imageGrid}>
            {images.map((item) => {
              const failed = Boolean(failedImageIds[item.id]);
              const canPreview = item.previewAvailable && !failed;
              const canRetry = item.previewAvailable && failed;
              return (
                <Pressable
                  accessibilityLabel={`${canPreview ? '查看图片' : canRetry ? '重新加载图片' : '图片预览不可用'} ${item.name}`}
                  accessibilityRole={item.previewAvailable ? 'button' : undefined}
                  disabled={!item.previewAvailable}
                  key={item.id}
                  onPress={() => {
                    if (canPreview) setPreviewImage(item);
                    else if (canRetry) retryImage(item.id);
                  }}
                  style={({ pressed }) => [styles.imageFrame, pressed && styles.imagePressed]}
                  testID="message-image-frame"
                >
                  {item.previewAvailable && !failed ? (
                    <Image
                      accessibilityLabel={item.name}
                      contentFit="cover"
                      key={`${item.id}-${retryVersions[item.id] ?? 0}`}
                      onError={() =>
                        setFailedImageIds((current) => ({ ...current, [item.id]: true }))
                      }
                      source={client.attachmentPreviewSource(apiKey, item.id)}
                      style={styles.image}
                      testID="message-image-content"
                      transition={120}
                    />
                  ) : (
                    <View style={styles.unavailable}>
                      <Text style={styles.unavailableText}>
                        {failed ? '重新加载' : '图片预览不可用'}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {documents.map((item) => (
          <View key={item.id} style={styles.document}>
            <View style={styles.documentIcon}>
              <SymbolView
                fallback={<Text>文</Text>}
                name={{ ios: 'doc.text', android: 'description' }}
                size={20}
                tintColor={colors.info}
              />
            </View>
            <View style={styles.documentCopy}>
              <Text numberOfLines={2} style={styles.documentName}>
                {item.name}
              </Text>
              <Text style={styles.documentMeta}>{formatAttachmentSize(item.size)}</Text>
            </View>
          </View>
        ))}
      </View>
      {previewImage ? (
        <Modal
          animationType="fade"
          onRequestClose={() => setPreviewImage(null)}
          statusBarTranslucent
          transparent
          visible
        >
          <Pressable
            onPress={() => setPreviewImage(null)}
            style={styles.previewBackdrop}
            testID="image-preview-backdrop"
          >
            <Pressable onPress={(event) => event.stopPropagation()} style={styles.previewCanvas}>
              <Image
                accessibilityLabel={`全屏查看 ${previewImage.name}`}
                contentFit="contain"
                source={client.attachmentPreviewSource(apiKey, previewImage.id)}
                style={styles.previewImage}
                testID="full-screen-image"
              />
            </Pressable>
            <Pressable
              accessibilityLabel="关闭图片预览"
              accessibilityRole="button"
              onPress={() => setPreviewImage(null)}
              style={({ pressed }) => [styles.previewClose, pressed && styles.previewClosePressed]}
            >
              <Text style={styles.previewCloseText}>×</Text>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, marginBottom: spacing.sm },
  singleImage: { alignItems: 'flex-start' },
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  imageFrame: {
    backgroundColor: colors.mutedSurface,
    borderRadius: 8,
    height: 98,
    overflow: 'hidden',
    width: 132,
  },
  imagePressed: { opacity: 0.84 },
  image: { height: '100%', width: '100%' },
  unavailable: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  unavailableText: { color: colors.muted, fontSize: 12 },
  previewBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.control,
  },
  previewCanvas: { height: '100%', width: '100%' },
  previewImage: { height: '100%', width: '100%' },
  previewClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.control,
    top: 48,
    width: 44,
  },
  previewClosePressed: { backgroundColor: 'rgba(255, 255, 255, 0.28)' },
  previewCloseText: { color: colors.surface, fontSize: 30, lineHeight: 32 },
  document: {
    alignItems: 'center',
    backgroundColor: '#F4F7F7',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
    padding: spacing.sm,
  },
  documentIcon: {
    alignItems: 'center',
    backgroundColor: '#E7EEF0',
    borderRadius: 6,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  documentCopy: { flex: 1, marginLeft: spacing.sm },
  documentName: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  documentMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
});
