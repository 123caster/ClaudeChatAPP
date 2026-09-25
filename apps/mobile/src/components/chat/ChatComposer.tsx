import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AttachmentPicker } from '@/components/chat/AttachmentPicker';
import { AttachmentTray } from '@/components/chat/AttachmentTray';
import { VoiceComposer } from '@/components/chat/VoiceComposer';
import type { AttachmentCandidate, ComposerAttachment } from '@/state/attachment-upload-queue';
import { appendVoiceTranscript } from '@/state/voice-input';
import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type ChatComposerProps = {
  attachments: ComposerAttachment[];
  busy: boolean;
  draft: string;
  online: boolean;
  placeholder?: string;
  running: boolean;
  sendDisabled: boolean;
  onAddAttachments: (items: AttachmentCandidate[]) => void;
  onCancelRunning: () => void;
  onChangeDraft: (value: string) => void;
  onError: (message: string) => void;
  onRemoveAttachment: (localId: string) => void;
  onRetryAttachment: (localId: string) => void;
  onSend: () => void;
  onHeightChange?: () => void;
};

export function ChatComposer({
  attachments,
  busy,
  draft,
  online,
  placeholder,
  running,
  sendDisabled,
  onAddAttachments,
  onCancelRunning,
  onChangeDraft,
  onError,
  onRemoveAttachment,
  onRetryAttachment,
  onSend,
  onHeightChange,
}: ChatComposerProps) {
  const [voiceOpen, setVoiceOpen] = useState(false);
  const onLayout = useCallback(() => onHeightChange?.(), [onHeightChange]);
  const disabled = busy || !online || running;

  return (
    <View onLayout={onLayout} style={styles.shell}>
      <AttachmentTray
        items={attachments}
        onRemove={onRemoveAttachment}
        onRetry={onRetryAttachment}
      />
      {voiceOpen ? (
        <VoiceComposer
          onCancel={() => setVoiceOpen(false)}
          onConfirm={(transcript) => {
            onChangeDraft(appendVoiceTranscript(draft, transcript));
            setVoiceOpen(false);
          }}
          onError={onError}
        />
      ) : (
        <View style={styles.inputRow}>
          <AttachmentPicker
            disabled={disabled}
            onError={onError}
            onPicked={onAddAttachments}
            remaining={9 - attachments.length}
          />
          <TextInput
            editable={!disabled}
            maxLength={100_000}
            multiline
            onChangeText={onChangeDraft}
            placeholder={
              online
                ? running
                  ? 'Claude 正在处理'
                  : (placeholder ?? '输入消息，或输入 / 唤醒命令')
                : '电脑离线'
            }
            placeholderTextColor={colors.muted}
            scrollEnabled
            style={styles.input}
            value={draft}
          />
          {!running ? (
            <Pressable
              accessibilityLabel="语音输入"
              accessibilityRole="button"
              disabled={busy || !online}
              onPress={() => setVoiceOpen(true)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
            >
              <SymbolView
                fallback={<Text style={styles.micFallback}>麦</Text>}
                name={{ ios: 'mic', android: 'mic' }}
                size={23}
                tintColor={colors.text}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel={running ? '停止' : '发送'}
            accessibilityRole="button"
            disabled={busy || (!running && sendDisabled)}
            onPress={running ? onCancelRunning : onSend}
            style={({ pressed }) => [
              styles.action,
              running ? styles.stopAction : styles.sendAction,
              (busy || (!running && sendDisabled)) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.textOnBrand} size="small" />
            ) : (
              <SymbolView
                fallback={<Text style={styles.actionFallback}>{running ? '■' : '↑'}</Text>}
                name={
                  running
                    ? { ios: 'stop.fill', android: 'stop' }
                    : { ios: 'arrow.up', android: 'arrow_upward' }
                }
                size={21}
                tintColor={colors.textOnBrand}
              />
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.surface,
    borderColor: '#D5E1DE',
    borderRadius: 18,
    borderWidth: 1,
    elevation: 3,
    minHeight: 62,
    overflow: 'hidden',
    shadowColor: '#283532',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  inputRow: { alignItems: 'flex-end', flexDirection: 'row', minHeight: 60, padding: 7 },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 132,
    minHeight: 46,
    paddingHorizontal: spacing.xs,
    paddingVertical: 11,
  },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 40 },
  micFallback: { color: colors.text, fontSize: 14 },
  action: {
    alignItems: 'center',
    borderRadius: 14,
    height: 44,
    justifyContent: 'center',
    marginLeft: 2,
    width: 44,
  },
  sendAction: { backgroundColor: colors.brand },
  stopAction: { backgroundColor: colors.danger },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.62 },
  actionFallback: { color: colors.textOnBrand, fontSize: 20, fontWeight: '700' },
});
