export function appendVoiceTranscript(current: string, transcript: string): string {
  const clean = transcript.trim();
  if (!clean) return current;
  if (!current.trim()) return clean;
  return `${current.trimEnd()} ${clean}`;
}
