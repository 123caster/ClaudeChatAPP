import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { spacing } from '@/theme/spacing';

type VoiceComposerProps = {
  onCancel: () => void;
  onConfirm: (transcript: string) => void;
  onError: (message: string) => void;
};

export function VoiceComposer({ onCancel, onConfirm, onError }: VoiceComposerProps) {
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState('');

  useSpeechRecognitionEvent('start', () => setRecognizing(true));
  useSpeechRecognitionEvent('end', () => setRecognizing(false));
  useSpeechRecognitionEvent('result', (event) => {
    setTranscript(event.results[0]?.transcript ?? '');
  });
  useSpeechRecognitionEvent('error', (event) => {
    setRecognizing(false);
    if (event.error !== 'aborted') onError('语音识别失败，请检查麦克风和系统语音服务。');
  });

  useEffect(() => {
    let active = true;
    const start = async () => {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        onError('当前手机未启用系统语音识别服务。');
        return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!active) return;
      if (!permission.granted) {
        onError('需要麦克风和语音识别权限才能使用语音输入。');
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN',
        interimResults: true,
        continuous: false,
      });
    };
    void start();
    return () => {
      active = false;
      ExpoSpeechRecognitionModule.abort();
    };
  }, [onError]);

  return (
    <View style={styles.container}>
      <View style={styles.wave}>
        {[12, 22, 30, 18, 26].map((height, index) => (
          <View
            key={index}
            style={[styles.waveBar, { height: recognizing ? height : Math.max(8, height / 2) }]}
          />
        ))}
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={3} style={transcript ? styles.transcript : styles.hint}>
          {transcript || (recognizing ? '正在听，请开始说话…' : '识别结束，可重新开始')}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={recognizing ? '停止识别' : '重新开始识别'}
        accessibilityRole="button"
        onPress={() => {
          if (recognizing) ExpoSpeechRecognitionModule.stop();
          else
            ExpoSpeechRecognitionModule.start({
              lang: 'zh-CN',
              interimResults: true,
              continuous: false,
            });
        }}
        style={styles.roundButton}
      >
        <SymbolView
          fallback={<Text>{recognizing ? '停' : '说'}</Text>}
          name={
            recognizing
              ? { ios: 'stop.fill', android: 'stop' }
              : { ios: 'mic.fill', android: 'mic' }
          }
          size={19}
          tintColor={recognizing ? colors.danger : colors.brand}
        />
      </Pressable>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.textButton}>
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!transcript.trim()}
          onPress={() => onConfirm(transcript)}
          style={[styles.confirmButton, !transcript.trim() && styles.disabled]}
        >
          <Text style={styles.confirmText}>使用文字</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.sm },
  wave: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    height: 34,
    justifyContent: 'center',
  },
  waveBar: { backgroundColor: colors.brand, borderRadius: 2, width: 3 },
  copy: { alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.sm },
  transcript: { color: colors.text, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  hint: { color: colors.muted, fontSize: 14, marginTop: spacing.sm },
  roundButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#EAF4F2',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  textButton: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 40 },
  cancelText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 8,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  confirmText: { color: colors.textOnBrand, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.38 },
});
