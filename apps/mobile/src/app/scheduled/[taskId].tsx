import { useLocalSearchParams } from 'expo-router';

import { ScheduledTaskDetailScreen } from '@/screens/ScheduledTaskDetailScreen';

export default function ScheduledTaskDetailRoute() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <ScheduledTaskDetailScreen taskId={taskId} />;
}
