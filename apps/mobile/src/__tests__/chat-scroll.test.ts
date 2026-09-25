import {
  INVERTED_LATEST_OFFSET,
  INVERTED_MAINTAIN_VISIBLE_CONTENT_POSITION,
  invertTimelineWindow,
  isNearInvertedTimelineLatest,
  keyboardAvoidanceInset,
  nextScrollModeOnPosition,
  stableKeyboardInset,
  shouldFollowTimeline,
} from '@/state/chat-scroll';

describe('inverted timeline positioning', () => {
  it('treats offset zero and the native anchor range as the latest messages', () => {
    expect(isNearInvertedTimelineLatest(0)).toBe(true);
    expect(isNearInvertedTimelineLatest(200)).toBe(true);
    expect(isNearInvertedTimelineLatest(201)).toBe(false);
  });

  it('uses the native origin for a one-shot latest-message jump', () => {
    expect(INVERTED_LATEST_OFFSET).toBe(0);
    expect(INVERTED_MAINTAIN_VISIBLE_CONTENT_POSITION).toEqual({
      autoscrollToTopThreshold: 200,
      minIndexForVisible: 0,
    });
  });

  it('reverses only the visible window and preserves the domain timeline', () => {
    const timeline = ['oldest', 'older', 'newer', 'latest'];

    expect(invertTimelineWindow(timeline, 1)).toEqual(['latest', 'newer', 'older']);
    expect(timeline).toEqual(['oldest', 'older', 'newer', 'latest']);
  });
});

describe('timeline scroll modes', () => {
  it('keeps historical reading locked while streamed content grows', () => {
    expect(nextScrollModeOnPosition('READING_HISTORY', false)).toBe('READING_HISTORY');
    expect(shouldFollowTimeline('READING_HISTORY')).toBe(false);
  });

  it('only resumes follow after the reader reaches the real bottom', () => {
    expect(nextScrollModeOnPosition('READING_HISTORY', true)).toBe('FOLLOWING');
    expect(shouldFollowTimeline('FOLLOWING')).toBe(true);
  });

  it('keeps a latest-message jump pending until the list reaches its end', () => {
    expect(nextScrollModeOnPosition('JUMPING_LATEST', false)).toBe('JUMPING_LATEST');
    expect(nextScrollModeOnPosition('JUMPING_LATEST', true)).toBe('FOLLOWING');
  });

  it('does not resume following while the reader is still dragging near the end', () => {
    expect(nextScrollModeOnPosition('READING_HISTORY', true, true)).toBe('READING_HISTORY');
  });
});

describe('keyboardAvoidanceInset', () => {
  it('keeps the composer above the keyboard without double-counting the safe area', () => {
    expect(keyboardAvoidanceInset({ keyboardHeight: 780, safeAreaBottom: 36 })).toBe(744);
    expect(keyboardAvoidanceInset({ keyboardHeight: 0, safeAreaBottom: 36 })).toBe(0);
  });

  it('does not oscillate while the same keyboard changes its candidate panel height', () => {
    expect(stableKeyboardInset(0, 744)).toBe(744);
    expect(stableKeyboardInset(744, 732)).toBe(744);
    expect(stableKeyboardInset(744, 760)).toBe(760);
    expect(stableKeyboardInset(760, 0)).toBe(0);
  });
});
