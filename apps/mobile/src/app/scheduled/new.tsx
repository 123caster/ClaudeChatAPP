import type { ScheduledTaskDraft } from '@claude-chat/protocol';
import { useLocalSearchParams } from 'expo-router';

import { ScheduledTaskEditorScreen } from '@/screens/ScheduledTaskEditorScreen';

export default function NewScheduledTaskRoute() {
  const params = useLocalSearchParams<{ draft?: string }>();
  let draft: ScheduledTaskDraft | undefined;
  if (params.draft) {
    try {
      draft = JSON.parse(params.draft) as ScheduledTaskDraft;
    } catch {
      draft = undefined;
    }
  }
  return <ScheduledTaskEditorScreen initialDraft={draft} />;
}
