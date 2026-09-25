export const INVERTED_LATEST_OFFSET = 0;
export const INVERTED_LATEST_THRESHOLD = 200;
export const INVERTED_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  autoscrollToTopThreshold: INVERTED_LATEST_THRESHOLD,
  minIndexForVisible: 0,
} as const;

export type TimelineScrollMode = 'FOLLOWING' | 'READING_HISTORY' | 'JUMPING_LATEST';

export function nextScrollModeOnPosition(
  mode: TimelineScrollMode,
  atBottom: boolean,
  userInteracting = false,
): TimelineScrollMode {
  if (userInteracting) return 'READING_HISTORY';
  if (atBottom) return 'FOLLOWING';
  return mode === 'JUMPING_LATEST' ? 'JUMPING_LATEST' : 'READING_HISTORY';
}

export function shouldFollowTimeline(mode: TimelineScrollMode): boolean {
  return mode === 'FOLLOWING';
}

export function isNearInvertedTimelineLatest(
  offsetY: number,
  threshold = INVERTED_LATEST_THRESHOLD,
): boolean {
  return Math.max(INVERTED_LATEST_OFFSET, offsetY) <= threshold;
}

export function invertTimelineWindow<T>(timeline: readonly T[], visibleStart: number): T[] {
  return timeline.slice(visibleStart).reverse();
}

export function keyboardAvoidanceInset({
  keyboardHeight,
  safeAreaBottom,
}: {
  keyboardHeight: number;
  safeAreaBottom: number;
}): number {
  return Math.max(0, keyboardHeight - safeAreaBottom);
}

export function stableKeyboardInset(current: number, incoming: number): number {
  if (incoming <= 0) return 0;
  return current <= 0 ? incoming : Math.max(current, incoming);
}
