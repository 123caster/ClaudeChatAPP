import { useLocalSearchParams } from 'expo-router';

import { ScheduledTaskEditorScreen } from '@/screens/ScheduledTaskEditorScreen';

export default function EditScheduledTaskRoute() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <ScheduledTaskEditorScreen taskId={taskId} />;
}
