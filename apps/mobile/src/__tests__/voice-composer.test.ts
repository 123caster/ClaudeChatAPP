import { appendVoiceTranscript } from '@/state/voice-input';

describe('appendVoiceTranscript', () => {
  it('uses recognized text as a draft that still requires confirmation and sending', () => {
    expect(appendVoiceTranscript('', '  帮我分析这张图片  ')).toBe('帮我分析这张图片');
    expect(appendVoiceTranscript('已有问题', '继续补充')).toBe('已有问题 继续补充');
  });

  it('does not alter the draft for an empty recognition result', () => {
    expect(appendVoiceTranscript('保留内容', '   ')).toBe('保留内容');
  });
});
